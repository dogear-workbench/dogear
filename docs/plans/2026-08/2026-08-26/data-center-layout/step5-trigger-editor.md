---
step: 5
title: 触发器编辑器重构
status: done
---

## 目标
TriggerListEditor 从「一行摊开全部参数」重构为「摘要行 + 展开编辑」：列表态一行一句话，点击展开统一小表单；添加入口改 DropdownMenu 分组菜单。

## 依赖上下文（接力棒输入）
- 前置 step 产出：[step4-task-editor-page.md] TriggerListEditor 已在 TaskEditorPage 右列（`w-80` 窄栏）内使用；shadcn Select 可用
- 当前关键文件状态：`app/data-center/scheduler/TriggerListEditor.tsx`（353 行）：`renderRow` 把类型徽章 + 全部控件（time/number/datetime-local 原生输入、WeekdayChips、月日 32 格网格、任务 select）+ describeTrigger 文字 + 删除按钮全摊一行 `flex flex-wrap`；底部时间/条件两个原生 select + 添加按钮
- 关键决策回顾：摘要行 = 类型图标 + describeTrigger 人话描述 + 删除按钮，点击整行展开（Collapsible，`components/ui/collapsible.tsx` 已有）；展开区统一「标签在上、控件在下」小表单，重控件（月日网格、星期圆点）只活在展开区；添加 = 一个「+ 添加规则」Button + DropdownMenu（`components/ui/dropdown-menu.tsx`）分「时间规则 / 条件事件」两组，每项带图标与一句说明；on_task_done 上游任务选择换 shadcn Select，无候选时该项在菜单里禁用（现状语义）；「时间规则/条件规则」不再分成两个列表区，合成一个摘要行列表（类型差异由图标/描述表达）

## 计划改动
- [x] 重写 `TriggerListEditor.tsx` 主体：
  - 摘要行组件（图标按类型映射 lucide icon，如 Clock / CalendarDays / Repeat / Timer / Zap / MousePointerClick / Link 等 + describeTrigger 描述 + 删除 ghost 按钮）；同一时间只展开一条或允许多条展开（建议单条展开，点另一条自动收起，窄栏更稳）→ 实现为单条展开（expandedId 单值状态）
  - 展开态表单：每类型一块（`label` 行 + 控件行），预设胶囊（每天/工作日/周末、月初/月中/月末）与 WeekdayChips、月日网格控件逻辑从现文件迁移，控件样式类统一（inputCls 全局共用，时间输入仍用原生 `input[type=time]` 但样式类与 shadcn Input 对齐）
  - 添加菜单：DropdownMenu 两组（TIME_TYPES 六项 / COND_TYPES 四项），`add(type)` 工厂函数照搬；选中后新条目以展开态插入
  - `on_task_done` 任务选择换 shadcn Select（taskCandidates / known 逻辑照搬）
- [x] 若单文件超 300 行：拆 `TriggerRow.tsx`（摘要行 + 展开表单）+ `TriggerListEditor.tsx`（列表 + 添加菜单），两文件同目录
- [x] `describeTrigger`、`utils.ts` 不动
- [x] SchedulerPanel 列表行的触发器描述（`describeTrigger` join）不受影响，确认无回归
- [ ] 验证：右列窄栏内逐类型添加/编辑/删除；monthly 展开区 32 格网格不溢出不换行崩坏；on_task_done 无候选时禁用；已有任务数据回显正常；保存后列表摘要与实际规则一致 → 静态验证全过（lint/tsc/build/无原生 select），dev 肉眼验证待主会话

## 实施回填（做完后填）

### 实际改动
- 与计划差异：
  1. 拆分多出一个文件：计划拆两文件（TriggerRow + TriggerListEditor），TriggerRow 首版 328 行超 300 红线，把 inputCls / MONTH_GRID / sameWeekdays / WeekdayChips / PresetChips / Field 共享控件层再拆出 `TriggerControls.tsx`（83 行），最终 TriggerRow 248 / TriggerListEditor 167 / TriggerControls 83，均 <300
  2. 空列表加「暂无规则，从下方添加」占位文案：原版两个分区各带小标题，合并成单一列表后空态没有任何提示
  3. on_app_start / on_session_close 展开态显示「事件规则，无可配置参数」说明行（否则点开是空白区）
  4. on_task_done 无候选时 Select 整体 disabled + placeholder「暂无可选任务」，Content 内再留一个 disabled 的「暂无可选任务」SelectItem 兜底（原版是 disabled option 占位）；known=false 且有候选时 value 传 undefined 显示 placeholder「请选择任务」（radix 不收空串，按接力棒建议）
  5. once 的 fired「已触发」徽章从行内移到展开区（摘要行只保留图标 + describeTrigger + 删除按钮）
  6. TYPE_LABELS、TIME_TRIGGER_TYPES 删除：类型区分改由 TYPE_ICONS 图标表达，合并列表后分区过滤不再需要；添加菜单项带图标 + label + 一句说明（window 说明按调度器实际语义写「窗口开始时触发、结束时自动停止」）
- 改动文件清单：
  - `app/data-center/scheduler/TriggerListEditor.tsx`（重写，167 行）：单一摘要行列表（expandedId 单条展开）+ 底部「+ 添加规则」DropdownMenu（时间规则六项 / 条件事件四项两组，每项 icon + label + 一句 desc；on_task_done 无候选时菜单项 disabled）；add() 工厂逐 case 照搬，添加后新条目以展开态插入
  - `app/data-center/scheduler/TriggerRow.tsx`（新建，248 行）：TYPE_ICONS 九类型图标映射；摘要行（图标 + describeTrigger 截断 + 展开箭头 + 删除 ghost 按钮，删除按钮在 CollapsibleTrigger 之外避免 button 嵌套）；RowForm 按类型渲染「标签在上控件在下」表单，预设胶囊/星期圆点/月日 32 格网格（全宽 grid-cols-7，去掉原 w-48）/时间与 datetime 输入逻辑照搬；on_task_done 用 shadcn Select
  - `app/data-center/scheduler/TriggerControls.tsx`（新建，83 行）：导出 inputCls（对齐 shadcn Input 的 h-7 小尺寸版：border-input/bg-transparent/focus-visible ring-[3px]）、MONTH_GRID、sameWeekdays、WeekdayChips、PresetChips、Field
- 验证：`bun run lint` 0 errors（72 warnings 为 types/ 存量，与 step2/3/4 基线一致）；`bunx tsc --noEmit` 全仓 20 个存量错误不变、无 data-center 相关；`bunx vite build` 构建通过；`grep '<select' app/data-center` 零命中——数据中心窗口已无原生 select；SchedulerPanel 的 describeTrigger join 未动无回归；dev 肉眼验证未做（需主会话过验证清单）

### 给下一步的接力棒
- 关键签名 / 数据结构：`TriggerRow` props：`{ trigger: Trigger; open: boolean; onOpenChange: (open: boolean) => void; patch: (updates: Partial<Trigger>) => void; onRemove: () => void; taskCandidates: { id: string; name: string }[]; taskNameOf: (taskId: string) => string | undefined }`；`TriggerListEditor` props 不变（triggers/onChange/tasks/selfTaskId），TaskEditorPage 零改动
- 下个 step 该从哪里继续：全部 step 完成 → 在 plan.md 写「完成总结」，可顺手触发 /doc-sync 同步 codebase-map
- 待办或已知限制：dev 肉眼验证待主会话（逐类型添加/编辑/删除、monthly 32 格网格窄栏不溢出、on_task_done 无候选禁用、已有任务回显、保存后摘要一致）；on_task_done 上游任务已被删除时（known=false 但 taskId 非空）保存不会被 validateDraft 拦（原版同样语义，照搬未改）
