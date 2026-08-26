# 数据中心布局重构 实施计划

**目标**：数据中心顶部下划线导航 + 6 平级面板；任务编辑 Dialog → 页面内二级页（左提示词右参数）；触发器编辑器「摘要行 + 展开」重构；执行历史升一级 tab；窗口内原生 select 全换 shadcn Select。

**架构思路**：页面内状态切换不走子路由（独立窗口无 URL 需求）；workspaces 列表仍由 page.tsx 加载下传，仅筛选状态下沉各 panel；触发器编辑拆「摘要行 + Collapsible 展开态」两层，月日网格等重控件只活在展开区。详见 [design.md](./design.md)。

**涉及模块**：`components/ui/tabs.tsx`、`components/ui/select.tsx`（新增）、`app/data-center/page.tsx`、`digests-panel.tsx`、`usage-panel.tsx`、`memory-section.tsx`、`scheduler/SchedulerPanel.tsx`、`scheduler/TaskEditor.tsx`（→ TaskEditorPage）、`scheduler/BuiltinTaskDetailSection.tsx`、`scheduler/TriggerListEditor.tsx`、`scheduler/HistorySheet.tsx`（→ `history-panel.tsx`）

## 步骤索引

- [x] [Step 1: 基础组件准备](./step1-ui-components.md) — tabs 加 underline 变体 + 新装 shadcn Select
- [x] [Step 2: 页面骨架重构](./step2-page-shell.md) — 删 header、顶部下划线导航 6 tab、工作区筛选下沉四个 panel、执行历史 tab 占位
- [x] [Step 3: 执行历史面板化](./step3-history-panel.md) — HistorySheet 拆壳平铺为 history-panel，筛选换 Select，接 useVisiblePolling
- [x] [Step 4: 任务编辑二级页](./step4-task-editor-page.md) — Dialog 改页面内 TaskEditorPage，左提示词右参数，BuiltinTaskDetailSection 拆分
- [x] [Step 5: 触发器编辑器重构](./step5-trigger-editor.md) — 摘要行 + 展开编辑 + DropdownMenu 分组添加

## 全局决策

- **不动其他窗口**：settings / stocks 等页面的原生 select 与 tabs 用法本次一律不碰；`tabs.tsx` 加 variant 时默认值必须保持现形态（`app/settings/page.tsx`、`components/stock/StockDetail.tsx` 在用）
- **Select 统一**：数据中心窗口内所有 `<select>` 全换 `components/ui/select.tsx`；一处不留
- **workspaces 数据流不变**：page.tsx `client.getAll()` 加载一次，以 props 下传；各 panel 只自持 `workspaceId` 筛选状态（`'all'` 语义保留）
- **草稿丢弃不弹确认**：二级页返回/取消直接丢草稿，与现状 Dialog 关闭一致
- **校验逻辑原样保留**：`validateDraft`、`findTriggerOverlaps`、重叠时 `showConfirm` 流程不改语义
- **不写注释**、单文件超 300 行考虑拆分（TriggerListEditor 重构后若超限拆子组件文件）
- 每步完成后跑 `bun run lint` + `bun run dev:renderer` 目测验证

## 完成总结（2026-08-27）

5 个 step 全部完成，每个 step 独立 commit：step1 `52936ac` → step2 `355f9ee` → step3 `d6027a0` → step4 `84d7178` → step5 `b84dd79`。

**交付内容**：数据中心顶部下划线导航 6 平级面板（组卡/用量/定时计划/执行历史/解析历史/记忆），删页面内重复 header；工作区筛选下沉各 panel（shadcn Select，page.tsx 统一加载下传）；执行历史从二级 Sheet 升一级面板（10s 轮询自动刷新）；任务编辑 Dialog → 页面内二级页（左列大提示词区 + 右列 w-80 参数栏，scheduler tab forceMount 保草稿）；触发器编辑器「摘要行 + 展开」重构（单条展开、DropdownMenu 分组添加）；数据中心窗口内原生 `<select>` 清零。

**计划外修正**（均记录在各 step 实施回填）：MemorySection 空态补筛选入口；history-panel 挂载补 loadTasks；scheduler TabsContent 加 forceMount（否则切 tab 丢草稿）；内置任务编辑页右列保留触发器卡片（原 Dialog 两分支共用，不补则功能回退）；TriggerRow 超 300 行红线多拆 TriggerControls.tsx。

**遗留**：子会话无法做 GUI 验证，dev 肉眼验证清单待用户统一过一遍（见 step4/step5 交付文档）；跨 tab 时 scheduler 轮询照跑（forceMount 副作用，轻量）；on_task_done 上游任务被删时 validateDraft 不拦（原版同语义，未改）。
