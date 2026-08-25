---
step: 1
title: 模型与调度引擎
status: done
---

## 目标

Trigger 联合类型扩展（`monthly_at` 新增、`interval.weekdays` 可选字段）+ `time-rule-engine.ts` 全部分支 + `scheduler-service.ts` 接入，引擎层行为完整可验证。

## 依赖上下文（接力棒输入）

- 设计文档：`docs/plans/2026-08/2026-08-25/scheduler-time-triggers-design.md`
- 现有实现参考：`electron/main/services/scheduler/time-rule-engine.ts`（`nextDailyOccurrence` 的 anchor 扫描模式、`missedDailyAt` 的回扫模式直接套用到 monthly）
- 关键现状：`nextDueAt` 返回 anchor 后第一个时刻（可为过去值），调度器用 `due <= now && due > lastFiredAt` 判定；`minNextDueAt` 供 UI 用（anchor=null 视角）

## 计划改动

- [x] `types/scheduler.ts` + `electron/main/services/scheduler/types.ts`（同步）：Trigger 联合加 `{ type: 'monthly_at'; at: string; daysOfMonth: (number | 'last')[] }`；`interval` 变体加 `weekdays?: number[]`
- [x] `electron/main/services/scheduler/time-rule-engine.ts`：
  - 新增 `isLastDayOfMonth(ts)` 与 `monthlyDayOk(daysOfMonth, date)`（date 的当月几号 ∈ days 或（含 `'last'` 且是当月最后一天））
  - 新增 `nextMonthlyOccurrence(minutes, daysOfMonth, now, anchor)`：扫描 dayOffset，anchor=null 时 `-0..+62` 找 `>= now` 首个、有 anchor 时 `-62..+62` 找 `> anchor` 首个（对齐 `nextDailyOccurrence` 写法）
  - `nextDueAt`：`monthly_at` case 调上面；`interval` case 加平移——`max(anchor + N, aligned)` 落点若非限定日（`weekdayOk` 判定），按天 +1 平移至下一限定日同 HH:mm
  - `missedMonthlyAt(daysOfMonth, at, anchor, bootAt)`：回扫 `0..-62`，对齐 `missedDailyAt`；`missedIntervalAt`：算出 `anchor + k*N` 后若为非限定日，平移后 `> bootAt` 则不算 missed
  - `detectMissed` / `minNextDueAt` / `describeTrigger` / `validateTrigger` 各加 monthly_at 分支；interval 分支 describe 显示 `工作日每 N 分钟`（weekdays 非全选时）、validate 复用 `validWeekdays`
- [x] `electron/main/services/scheduler/scheduler-service.ts:202` 附近：到点触发 case（现 `daily_at | interval | once`）归入 `monthly_at`
- [x] `plan-validate.ts` 若对类型有白名单/透传逻辑则确认 monthly_at 通过（先 grep 确认）
- [x] 临时脚本验证后删除：每月 31 号跨小月跳过、`'last'` 跨闰年 2 月、monthly 锚定 missed 回扫、interval 周五→周一平移、无 weekdays 行为不变
- [x] `bun run build:electron` 通过

## 实施回填（做完后填）

### 实际改动
- 与计划差异：
  - `nextDueAt` / `minNextDueAt` 的 interval 在 anchor=null（未触发过）分支也应用 weekday 平移（落在非限定日时首个触发顺延到下一限定日同 HH:mm），避免新建限星期 interval 在非限定日立即触发；无 weekdays 时恒等变换，与现状完全一致
  - `missedIntervalAt` 按计划只检查最后一个理论格点 `anchor+k*N`，若该格点落在周末而更早的限定日格点已错过，会少报一次（计划指定的启发式，与无 weekdays 版只报最后一个点的行为对齐）
  - `plan-validate.ts` 零改动：透传 `validateTrigger`，无类型白名单
  - 渲染层 `types/scheduler.ts` 已加 monthly_at / interval.weekdays，但 `TriggerListEditor.tsx`（TYPE_LABELS/add switch）与 `utils.ts` describeTrigger 尚无 monthly_at 分支——lint（eslint 非类型感知）与 build:electron（仅编译 electron/**）均不受阻，vite 构建不做类型检查，待 Step 2 补齐
- 改动文件清单：
  - `types/scheduler.ts`：Trigger 联合加 `monthly_at`，`interval` 加 `weekdays?`
  - `electron/main/services/scheduler/types.ts`：同上（双处同步）
  - `electron/main/services/scheduler/time-rule-engine.ts`：新增 `isLastDayOfMonth` / `monthlyDayOk` / `nextMonthlyOccurrence`（-62..+62 扫描）/ `missedMonthlyAt`（回扫 0..-62）/ `shiftIntervalToWeekday`（interval 平移，最多 7 天）/ `daysOfMonthLabel`；`nextDueAt` / `minNextDueAt` / `detectMissed` / `describeTrigger` / `validateTrigger` 加 monthly_at 分支，interval 分支接 weekdays
  - `electron/main/services/scheduler/scheduler-service.ts`：`evaluateTrigger` 到点触发 case 组加 `monthly_at`

### 给下一步的接力棒
- 关键签名 / 数据结构：
  - `{ type: 'monthly_at'; at: 'HH:mm'; daysOfMonth: (number | 'last')[] }`；`interval` 增 `weekdays?: number[]`（0=周日..6=周六，全选建议存 undefined）
  - 主进程 `describeTrigger` 文案：monthly → `每月 1/15 号 08:00` / `每月末 08:00` / 混合 `每月 1/末 号 08:00`；interval 非全选 → `工作日每 120 分钟`、`周末每 120 分钟`，无 weekdays/全选 → `每 120 分钟`（渲染层 utils.ts 需同步同文案）
  - `validateTrigger` monthly 错误文案：`daysOfMonth 不能为空` / `daysOfMonth 取值须为 1-31 或 last` / `daysOfMonth 不能重复`；interval weekdays 复用 `weekdays 不能为空` / `weekdays 取值须为 0-6`
- 下个 step 该从哪里继续：`app/settings/scheduler/TriggerListEditor.tsx` 六入口 + `utils.ts` describeTrigger 同步（补 monthly_at case，否则渲染层 TS exhaustive switch 缺分支）
- 待办或已知限制：见「与计划差异」三条
