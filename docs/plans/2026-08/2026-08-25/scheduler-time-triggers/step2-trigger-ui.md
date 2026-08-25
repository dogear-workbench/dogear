---
step: 2
title: 触发器编辑 UI
status: done
---

## 目标

`TriggerListEditor` 时间规则入口改为六项（每天/每周/每月定点 + 间隔 + 窗口 + 单次，后两项不动），三档定点行内控件 + 间隔周几圆点，两处 `describeTrigger` 文案同步。

## 依赖上下文（接力棒输入）

- 前置 step 产出：Trigger 类型已扩展（`monthly_at` / `interval.weekdays`），主进程校验已就绪
- 关键文件现状：`app/settings/scheduler/TriggerListEditor.tsx`（`TIME_TYPES` 下拉 + `add()` 默认值 + `renderRow` switch + 已有 `WeekdayChips` 组件直接复用）、`app/settings/scheduler/utils.ts`（渲染层 `describeTrigger`）
- 关键决策回顾：每天/每周数据同构（都是 `daily_at + weekdays`），区别只在入口默认值与控件形态；旧数据自定义 weekdays 在「每天」行 chips 不亮、摘要照常显示

## 计划改动

- [ ] `TriggerListEditor.tsx` 的 `TIME_TYPES` 改六项：`daily_at`（每天定点）、`weekly_at_entry`→实际存 `daily_at` weekdays `[1]`（每周定点）、`monthly_at`（每月定点）、`interval`、`window`、`once`——注意「每周定点」是 UI 入口概念，落库仍是 `{ type: 'daily_at', weekdays: [1] }`，类型联合不新增 weekly_at
- [ ] `add()` 默认值：每天定点 `at: '08:00'` 无 weekdays；每周定点 `weekdays: [1]`；每月定点 `daysOfMonth: [1], at: '08:00'`
- [ ] `renderRow`：
  - `daily_at` 行区分入口语义：现有周几圆点保留在「每周」形态；「每天」形态显示预设 chips（每天/工作日/周末），点击设 `weekdays` 为 `undefined` / `[1,2,3,4,5]` / `[0,6]`；当前 weekdays 非三预设之一时全不亮。实现建议：单行内预设 chips 与周几圆点并排（预设点了可再微调圆点），或以「当前是否含自定义组合」切换显示——实施时取更顺的一种，保持旧数据可编辑
  - `monthly_at` 行：预设 chips（月初 `[1]` / 月中 `[15]` / 月末 `['last']`，点击覆盖 daysOfMonth 为单元素）+ 几号网格（1–31 + 「末」小方块，7 列 flex-wrap，多选 toggle，与预设联动：手动点网格后预设取消高亮）+ time input
  - `interval` 行：分钟 input 后追加 `WeekdayChips`（默认全选 = undefined）
- [ ] `TYPE_LABELS` 补 `monthly_at: '每月时刻'`
- [ ] `timeTriggers/condTriggers` 的类型过滤数组补 `monthly_at`
- [ ] `app/settings/scheduler/utils.ts` 的 `describeTrigger`：monthly 分支（`每月 1/15 号 08:00`、`'last'` → `每月末`）、interval 带 weekdays 前缀——与主进程 `time-rule-engine.ts` 文案逐字一致
- [ ] `bun run dev` 实测：六入口添加/编辑/删除、预设与网格联动、旧 daily_at 自定义数据展示、行尾摘要实时更新、保存后重启数据不丢

## 实施回填（做完后填）

### 实际改动
- 与计划差异：① daily_at 行 time input 放最前（与 window 行「时间在前日期在后」模式一致），预设 chips 与周几圆点并排（计划建议的第一种形态）；② timeTriggers/condTriggers 两处内联数组提取为 `TIME_TRIGGER_TYPES` 常量；③ TaskEditor validateDraft 未加 monthly 分支（UI 控件形状保证 + 主进程兜底，与 daily_at 现状口径一致）；④ GUI 无法启动，改为代码级 walkthrough（详见共享区 step2-delivery.md）
- 改动文件清单：`app/settings/scheduler/TriggerListEditor.tsx`（TIME_TYPES 六项 + PresetChips 组件 + MONTH_GRID 网格 + add/renderRow 各 case）、`app/settings/scheduler/utils.ts`（daysOfMonthLabel + describeTrigger monthly/interval 分支）

### 给下一步的接力棒
- 关键签名 / 数据结构：见共享区 step2-delivery.md「给 Step 3 的接力棒」段（保存入口 TaskEditor.handleSave、describeTrigger 可直接用于警告文案、weekdays 归一化 undefined→[0..6]）
- 下个 step 该从哪里继续：`app/settings/scheduler/` 新增 findTriggerOverlaps + TaskEditor.handleSave 插入 showConfirm
- 待办或已知限制：每周入口落库后 Badge 显示「每天时刻」（数据同构，预期）；GUI 实测点待用户验证（清单在 step2-delivery.md）
