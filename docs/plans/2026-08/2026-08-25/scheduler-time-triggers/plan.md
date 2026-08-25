# 定时任务时间触发器升级 实施计划

**目标**：时间规则支持每天/每周/每月定点（含常用预设）、间隔限定星期、保存时重叠软警告；设计详见 [../scheduler-time-triggers-design.md](../scheduler-time-triggers-design.md)。

**架构思路**：零迁移——每天/每周复用 `daily_at + weekdays`，`interval` 加可选 `weekdays?`，仅新增 `monthly_at`（`daysOfMonth: (number|'last')[]`）。排除独立 `weekly_at` 类型、每 N 周/月间隔、运行时去重。

**涉及模块**：`types/scheduler.ts`、`electron/main/services/scheduler/{types,time-rule-engine,scheduler-service}.ts`、`app/settings/scheduler/{TriggerListEditor,utils}.tsx`、TaskEditor 保存路径。

## 步骤索引

- [x] [Step 1: 模型与调度引擎](./step1-model-engine.md) — Trigger 类型扩展 + time-rule-engine 的 monthly 计算/校验/missed + interval 平移 + service 接入
- [x] [Step 2: 触发器编辑 UI](./step2-trigger-ui.md) — TriggerListEditor 六入口、三档定点控件、间隔周几圆点、describeTrigger 同步
- [x] [Step 3: 重叠软警告](./step3-overlap-warning.md) — 保存时检测定点类规则同刻交集，showConfirm 确认

## 全局决策

- `monthly_at`：`{ type: 'monthly_at'; at: 'HH:mm'; daysOfMonth: (number|'last')[] }`；`'last'` = 当月最后一天；不存在的日期（2/30、小月 31）跳过该月；`daysOfMonth` 非空、number ∈ 1–31、去重
- interval 平移：`anchor + minutes` 落在非限定日 → 平移到下一限定日同 HH:mm（最多 7 天）；无 weekdays 行为与现状完全一致
- types 双处同步：`types/scheduler.ts`（渲染层）与 `electron/main/services/scheduler/types.ts`（主进程）保持一致
- `describeTrigger` 双处实现（`time-rule-engine.ts` / `app/settings/scheduler/utils.ts`）文案保持一致：monthly → 「每月 1/15 号 08:00」「每月末 08:00」；interval 带非全选 weekdays → 「工作日每 120 分钟」
- weekdays 复用现有 `validWeekdays` 校验（0–6、非空）；weekdaysLabel 的 每天/工作日/周末 归纳逻辑复用
- 主进程改动需 `bun run build:electron` 后生效；不写单测，临时验证脚本跑完即删（沿用 2026-08-15 scheduler 计划的做法）
- 警告一律走 `stores/confirm-store.ts` 的 `showConfirm`，禁用 window.confirm

## 完成总结（2026-08-25）

三步全部完成，四个 commit：

1. **Step 1 模型与调度引擎**（08fd8e5）：Trigger 联合双处加 `monthly_at`、interval 加可选 `weekdays`；time-rule-engine 新增 monthly 62 天扫描 / missed 回扫 / interval 限星期按日平移，nextDueAt / minNextDueAt / detectMissed / validateTrigger / describeTrigger 全分支接入；scheduler-service 到点判定归入 monthly_at。临时脚本 45 case 验证后即删。
2. **Step 2 触发器编辑 UI**（84c7600）：时间规则入口扩为六项（每周定点落库 daily_at + weekdays[1]）；daily 行预设 chips（每天/工作日/周末）与周几圆点并排；monthly 行月初/月中/月末预设与 1–31+末 多选网格双向联动、永非空去重；interval 行加周几圆点（全选存 undefined）；渲染层 describeTrigger 与主进程逐字一致，SchedulerPanel 摘要零改动自动生效。
3. **Step 3 重叠软警告**（8503f1e）：`utils.ts` 的 `findTriggerOverlaps`（daily×daily 按 weekdays 归一化交集、monthly×monthly 按 daysOfMonth 交集、daily×monthly 同 at 即报、interval 仅完全重复）；TaskEditor 保存前 `showConfirm` 软警告，取消则中止。临时脚本 19 case 验证后即删。

**落地效果**：零迁移，旧 daily_at / interval 数据行为不变；每月定点支持多选几号与月末（小月/闰年自适应跳过或命中）；间隔可限星期（落非限定日顺延到下一限定日同 HH:mm）；保存时重叠规则软提示。lint 0 errors、build:electron / tsc 均通过。

**已知限制（设计内）**：重叠时刻任务会执行两次（软警告不阻断）；interval / window 与定点的碰巧同分钟不检测；每次保存重叠任务都会弹警告。

**建议实测**：六入口添加/编辑/保存重启数据不丢、预设↔网格/圆点联动、重叠警告三组场景的取消/确认路径（详见共享区 step2/step3 交付文档）。
