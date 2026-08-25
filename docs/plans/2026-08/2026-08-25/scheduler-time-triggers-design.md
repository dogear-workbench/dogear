# 定时任务时间触发器升级（每周 / 每月 / 间隔限星期）设计

**背景**：现有时间规则 4 种（每天固定时刻 / 固定间隔 / 时间窗口 / 单次）。三个缺口：①「每周」能力其实已存在（`daily_at` + weekdays），但藏在「每天固定时刻」入口后面，可发现性差；②「每月 N 号」完全缺失；③间隔规则无法限定星期（如「工作日每 2 小时」做不到）。

**目标**：

1. 时间规则入口显性化：每天定点 / 每周定点 / 每月定点 / 固定间隔（可限星期）
2. 常用预设一键选择：每天、工作日、周末、月初、月中、月末；其余自定义（勾周几 / 勾几号）
3. 保存时对「规则重叠导致同刻双跑」给出软警告

**架构**（核心做法 + 排除的选项及原因）：

- **零迁移**：每天/每周定点复用 `daily_at + weekdays`（不新增 `weekly_at` 类型——与现有 weekdays 能力语义冗余）；`interval` 加可选 `weekdays?`；仅新增 `monthly_at`。
- 数据形状：

```
{ type: 'daily_at';   at: 'HH:mm'; weekdays?: number[] }              // 不变
{ type: 'monthly_at'; at: 'HH:mm'; daysOfMonth: (number|'last')[] }   // 新增
{ type: 'interval';   minutes: number; weekdays?: number[] }          // 加 weekdays
```

- **间隔平移语义**：下次理论触发点 = anchor + minutes；若落在非限定日，平移到下一个限定日的同一 HH:mm（最多 7 天内必命中）。例：工作日每 2h，周五 22:00 触发后 → 周六 00:00 非限定 → 周一 00:00 恢复，周末静默、不爆发式补触发。
- **不做**：每 N 周 / 每 N 月级别间隔（月内多选几号可近似表达，需求不成立）；「某时段内才间隔」（window × interval 组合，YAGNI，后续真需要再加）；运行时同分钟去重（行为不可预期，triggerDesc / lastFiredAt 归属说不清）。
- **重叠检测（软警告，不阻断）**：保存时检测——①两条规则完全相同；②定点类规则之间时刻相同且日期集合有交集（`daily_at`×`daily_at`：同 at 且 weekdays 交集；`daily_at`×`monthly_at`：同 at（每月 N 号必落某天，保守全报）；`monthly_at`×`monthly_at`：同 at 且 daysOfMonth 交集含 'last'）。发现即 `showConfirm` 让用户选「仍要保存 / 回去修改」。interval / window 与定点规则的碰巧同分钟不检测。
- 时间窗口、单次规则**完全不动**；window 关闭停运行的作用域隔离（只停该 window 触发的运行）维持现状，无冲突。

**模块边界**：

| 文件 | 改动 |
|------|------|
| `types/scheduler.ts` + `electron/main/services/scheduler/types.ts` | Trigger 联合类型加 `monthly_at`；`interval` 加 `weekdays?`（两处同步） |
| `electron/main/services/scheduler/time-rule-engine.ts` | `nextDueAt` / `minNextDueAt` / `detectMissed` / `validateTrigger` / `describeTrigger` 加 monthly 分支；interval 分支加平移逻辑 |
| `electron/main/services/scheduler/scheduler-service.ts` | `evaluateTrigger` 的到点触发 case 归入 `monthly_at` |
| `app/settings/scheduler/TriggerListEditor.tsx` | 添加下拉 6 项；每天/每周/每月行内控件；interval 行加周几圆点 |
| `app/settings/scheduler/utils.ts` | 渲染层 `describeTrigger` 同步（monthly / interval 带星期文案） |
| 保存校验路径（TaskEditor / plan-validate） | 重叠软警告检测 |

**数据流**（UI → 存储 → 调度）：

1. `TriggerListEditor` 按入口生成对应 Trigger 对象（默认值：每天定点 = `daily_at` + 无 weekdays；每周定点 = 周一；每月定点 = `[1]` 08:00；间隔 = 60 分钟全选）
2. 保存时主进程 `validateTrigger` 严格校验（monthly：`daysOfMonth` 非空、元素为 1–31 整数或 `'last'`、去重；interval 的 weekdays 复用 `validWeekdays`），通过后写 plan-store
3. 调度 tick：`evaluateTrigger` 对 `daily_at` / `monthly_at` / `interval` / `once` 统一走 `nextDueAt <= now && > lastFiredAt` 到点触发；`monthly_at` 的 nextDueAt 由 `nextMonthlyOccurrence` 计算——扫描 dayOffset −62..+62，命中「当月第 N 天 ∈ daysOfMonth」或「含 `'last'` 且当天是当月最后一天」；missed 检测同规则回扫，对齐现有补报行为

**UI 形态**：

```
[每天定点]  (每天)(工作日)(周末)              [08:00]   → 工作日 08:00
[每周定点]  (日)(一)(二)(三)(四)(五)(六)      [08:00]   → 周一 08:00
[每月定点]  (月初)(月中)(月末) 1..31[末] 网格  [08:00]   → 每月 1 号 08:00 / 每月末 08:00
[固定间隔]  [120] 分钟  (日)…(六) 圆点                  → 工作日每 120 分钟
```

- 每月预设 chips 与几号网格联动：点「月初」= 网格只亮 1，「月末」= 只亮「末」；手动点网格 = 预设取消高亮（自定义）。网格 7 列紧凑小方块，行内 flex-wrap。
- 每天定点三个预设 chips 一键切 weekdays；旧数据自定义组合（如周一三五）时 chips 不亮、摘要照常显示，点预设即覆盖。
- 间隔的周几圆点默认全选 = 不限星期。

**错误处理 / 边界情况**：

- 不存在的日期（2 月 30、小月 31）→ 该月直接跳过不触发（cron 惯例），不顺延；选 31 号的规则一年仅 7 个月触发，属预期行为
- `'last'` 自适应当月最后一天（28/29/30/31，含闰年）
- 间隔平移最多 7 天内必命中（weekdays 经校验非空保证）
- 旧数据零迁移：无 weekdays 的 interval / daily_at 行为与现在完全一致
- 重叠双跑：警告后仍保存的，重叠时刻任务执行两次（与现有系统语义一致），missed 各记一条

**未决问题**：无。
