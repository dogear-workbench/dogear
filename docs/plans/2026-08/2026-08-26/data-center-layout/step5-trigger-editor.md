---
step: 5
title: 触发器编辑器重构
status: pending
---

## 目标
TriggerListEditor 从「一行摊开全部参数」重构为「摘要行 + 展开编辑」：列表态一行一句话，点击展开统一小表单；添加入口改 DropdownMenu 分组菜单。

## 依赖上下文（接力棒输入）
- 前置 step 产出：[step4-task-editor-page.md] TriggerListEditor 已在 TaskEditorPage 右列（`w-80` 窄栏）内使用；shadcn Select 可用
- 当前关键文件状态：`app/data-center/scheduler/TriggerListEditor.tsx`（353 行）：`renderRow` 把类型徽章 + 全部控件（time/number/datetime-local 原生输入、WeekdayChips、月日 32 格网格、任务 select）+ describeTrigger 文字 + 删除按钮全摊一行 `flex flex-wrap`；底部时间/条件两个原生 select + 添加按钮
- 关键决策回顾：摘要行 = 类型图标 + describeTrigger 人话描述 + 删除按钮，点击整行展开（Collapsible，`components/ui/collapsible.tsx` 已有）；展开区统一「标签在上、控件在下」小表单，重控件（月日网格、星期圆点）只活在展开区；添加 = 一个「+ 添加规则」Button + DropdownMenu（`components/ui/dropdown-menu.tsx`）分「时间规则 / 条件事件」两组，每项带图标与一句说明；on_task_done 上游任务选择换 shadcn Select，无候选时该项在菜单里禁用（现状语义）；「时间规则/条件规则」不再分成两个列表区，合成一个摘要行列表（类型差异由图标/描述表达）

## 计划改动
- [ ] 重写 `TriggerListEditor.tsx` 主体：
  - 摘要行组件（图标按类型映射 lucide icon，如 Clock / CalendarDays / Repeat / Timer / Zap / MousePointerClick / Link 等 + describeTrigger 描述 + 删除 ghost 按钮）；同一时间只展开一条或允许多条展开（建议单条展开，点另一条自动收起，窄栏更稳）
  - 展开态表单：每类型一块（`label` 行 + 控件行），预设胶囊（每天/工作日/周末、月初/月中/月末）与 WeekdayChips、月日网格控件逻辑从现文件迁移，控件样式类统一（inputCls 全局共用，时间输入仍用原生 `input[type=time]` 但样式类与 shadcn Input 对齐）
  - 添加菜单：DropdownMenu 两组（TIME_TYPES 六项 / COND_TYPES 四项），`add(type)` 工厂函数照搬；选中后新条目以展开态插入
  - `on_task_done` 任务选择换 shadcn Select（taskCandidates / known 逻辑照搬）
- [ ] 若单文件超 300 行：拆 `TriggerRow.tsx`（摘要行 + 展开表单）+ `TriggerListEditor.tsx`（列表 + 添加菜单），两文件同目录
- [ ] `describeTrigger`、`utils.ts` 不动
- [ ] SchedulerPanel 列表行的触发器描述（`describeTrigger` join）不受影响，确认无回归
- [ ] 验证：右列窄栏内逐类型添加/编辑/删除；monthly 展开区 32 格网格不溢出不换行崩坏；on_task_done 无候选时禁用；已有任务数据回显正常；保存后列表摘要与实际规则一致

## 实施回填（做完后填）

### 实际改动
- 与计划差异：
- 改动文件清单：

### 给下一步的接力棒
- 关键签名 / 数据结构：
- 下个 step 该从哪里继续：全部 step 完成 → 在 plan.md 写「完成总结」，可顺手触发 /doc-sync 同步 codebase-map
- 待办或已知限制：
