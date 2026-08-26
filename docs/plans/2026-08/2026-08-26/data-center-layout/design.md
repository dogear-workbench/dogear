# 数据中心布局重构 设计

**背景**：数据中心是独立 Electron 窗口（系统标题栏已显示「数据中心」），页面内 header 的 h1 纯属重复；左侧竖排 tab 想换到顶部；任务编辑用 Dialog 浮窗对复杂编辑太小（提示词 textarea 仅 140px、触发器编辑挤在一行）；触发器编辑器形态杂乱（32 格月日网格摊在行内、原生 select/time input 混搭风格割裂）；执行历史藏在定时计划的二级 Sheet 里层级太深。

**目标**：
1. 顶部一行下划线式导航，6 个平级面板（组卡 / 用量 / 定时计划 / 执行历史 / 解析历史 / 记忆）
2. 任务编辑从 Dialog 改为页面内二级页：左列大提示词编辑区、右列参数栏
3. 触发器编辑器重构为「摘要行 + 展开编辑」
4. 数据中心窗口内原生 `<select>` 全部替换为 shadcn `Select`

**架构**（核心做法 + 排除的选项）：
- 导航形态选**下划线式 Tabs**（`tabs.tsx` 加 `variant="underline"`，默认形态不动）。排除：水平胶囊（视觉偏重）、SegmentedControl（需新装组件，收益低）。
- 编辑二级页选**页面内状态切换**（SchedulerPanel 内部编辑态，不走子路由）。排除子路由：独立窗口无 URL 直达/分享需求，页面内切换实现简单且草稿天然保活（切 tab 再切回不丢）。刷新/重开窗口回到列表页，与现状 Dialog 行为一致，不算倒退。
- 触发器编辑选**摘要行 + 展开编辑**（A 方案）：列表态每条规则一行「图标 + describeTrigger 人话描述 + 删除」，点击展开统一「标签在上、控件在下」的小表单；添加用 DropdownMenu 按「时间规则 / 条件规则」分组。排除：卡片全摊开式（monthly 卡片高度突出、视觉密度高）。排除 shadcn cron 组件（触发器模型非 cron，硬套丢信息）。
- 执行历史**升级为一级 tab**：Sheet 外壳拆掉、内容平铺为 panel，语义上运行日志本不隶属定时计划管理。

**模块边界**：
- `components/ui/tabs.tsx`：加 underline 变体（其他引用方默认形态不变）
- `components/ui/select.tsx`：新增（shadcn Select，需 `bun add @radix-ui/react-select`）
- `app/data-center/page.tsx`：删 header、顶部下划线导航 6 tab、工作区筛选下沉
- `app/data-center/digests-panel.tsx` / `usage-panel.tsx` / `memory-section.tsx` / `scheduler/SchedulerPanel.tsx`：各自内置工作区筛选（shadcn Select），`workspaces` 列表仍由 page.tsx 加载后下传（避免重复请求）
- `app/data-center/scheduler/TaskEditor.tsx` → `TaskEditorPage.tsx`：Dialog 改页面内二级页
- `app/data-center/scheduler/BuiltinTaskDetailSection.tsx`：拆分——提示词部分归编辑页左列，模型/工具清单归右列
- `app/data-center/scheduler/TriggerListEditor.tsx`：摘要行 + 展开重构
- `app/data-center/scheduler/HistorySheet.tsx` → `app/data-center/history-panel.tsx`：Sheet 改平铺 panel，接 `useVisiblePolling` 让「正在运行」区块自动刷新

**数据流**：无新增 IPC。workspaces 由 page.tsx `client.getAll()` 加载一次传各 panel；各 panel 自持 `workspaceId` 筛选状态。执行历史数据流照搬现 HistorySheet（loadHistory/loadMoreHistory/refreshActivity）。

**编辑页布局**：
- 顶部工具栏：面包屑「← 定时计划 / 编辑任务|新建任务」+ 右侧「取消 + 保存」；点返回直接丢弃草稿不弹确认（与现状 Dialog 一致）
- 左列 `flex-1`：任务名称 + 提示词 textarea 占满剩余高度（内置任务为 BuiltinTaskDetailSection 提示词部分，其「保存提示词/恢复默认」按钮仍独立于页面级「保存」）
- 右列约 `w-80`、独立滚动、参数卡片纵向堆叠：模型、工作区、工具包（自定义）/ 工具清单（内置）、触发器
- SchedulerPanel 的轮询（useVisiblePolling、分钟 tick）编辑态照常运行

**错误处理 / 边界情况**：
- 触发器重叠校验（findTriggerOverlaps）、validateDraft 校验逻辑原样保留
- 内置任务提示词保存独立语义不变（全局模板，立即写盘）
- on_task_done 无候选任务时 DropdownMenu 该项禁用（现状行为）
- TabsContent 高度模式差异：列表态整页滚动 vs 编辑态满高度布局，由 SchedulerPanel 内部条件处理

**未决问题**：
- 执行历史的「会话过程渲染」明确不做（自定义任务是 headless runOnce，无会话落盘；要做得先把工具调用序列收集进 RunHistoryEntry，留待未来）
- 其他窗口（设置页等）的原生 select 替换不在本次范围
