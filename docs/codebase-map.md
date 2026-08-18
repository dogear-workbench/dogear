# Dogear 代码地图

> 核心文件功能索引。由 `codebase-map` skill 按需 Read，由 `doc-sync` skill 在代码变更后同步。
> 简单的定位/改动建议直接用 Glob/Grep 探索当前代码状态，索引可能滞后于实际文件。

## 入口与路由（src/）

- `src/main.tsx` — Vite 入口，挂载 React 到 `#root`
- `src/App.tsx` — React Router 配置 + 设置 overlay + 全局 ConfirmDialog
- `src/globals.css` — Tailwind CSS 4 全局样式

## 页面（app/）

- `app/page.tsx` — 主工作区页面，三栏布局（对话列表 + AI助手 + 文件树/预览）
- `app/session-window/page.tsx` — 独立会话窗口（路由参数 `conversationId`，可折叠文件树 + 聊天 + 预览，独立渲染进程初始化）
- `app/settings/page.tsx` — 设置页面（全屏 overlay，纵向 Tab + 表单模式 + dirty 检测，含默认系统提示词编辑）
- `app/settings/WorkspaceManagementTab.tsx` — 工作区管理标签页（列表 + 删除 + 孤儿恢复 + 环境依赖检查）
- `app/settings/SubAgentTab.tsx` — 子会话派遣标签页（Profile 列表管理：非 default Profile 行内启用 Switch，停用后 agent 侧不可见不可派遣、行置灰加「已停用」徽标；ProfileEditor 编辑名称/模型/超时/基础工具/能力域/Skill）
- `app/settings/pi-model-row.tsx` — 模型清单行组件 `PiModelRow`：ID 行内编辑（空/与同清单重复回退标红）、窗口徽标点击手填（`parseContextInput` 解析 1M/200K/262144 写法，清空恢复查表，手动角标）、显示名与删除
- `app/settings/SystemPromptPreviewTab.tsx` — 系统提示词只读预览面板，拉后端 getSystemPromptSegments 展示 6 段隐形系统契约（tool-pack-guide / group-context / reference-append / group-append / notes-guidance / sub-agent-contract），按 category 分组 + 类别徽章 + 动态徽章 + 触发条件说明 + 等宽模板正文
- `app/settings/memory/DigestsPanel.tsx` — 组卡查看面板（组卡列表 + 详情视图[概述/想法·注意·决策/关键产出/回溯链接] + 单组「重新提炼」按钮走 triggerGroupDigest；2s 轮询 listGroupDigests 自动刷新列表。模型、提示词、停止与整批重跑入口已收敛到定时计划）
- `app/settings/memory/SmartCategoryPanel.tsx` — 智能分类行为配置（挂在「会话摘要」Tab 末尾，按组分类）：文案强调「分类对象：话题」/ 总开关 / 阈值 / 上限锁死 10 / 当前分类列表（折叠 + 刷新，按 groupIds.length 计数）；模型、提示词与全量重跑 / 整理入口在定时计划
- `app/settings/memory/TopicsPanel.tsx` — 工作区主题记忆面板（列表 + 编辑器，接 memory-service）
- `app/settings/memory/CoreProfilePanel.tsx` — 核心画像面板
- `app/settings/scheduler/` — 定时任务设置组件（「定时计划」Tab 内容，拆分控制单文件体量）：
  - `SchedulerPanel.tsx` — 任务列表（一行一任务：名称 [builtin 行首 Cog 图标] / 启用 Switch / 触发器摘要 / 下次运行相对时间 60s 刷新 / 编辑·运行按钮，删除按钮仅 custom 任务且走 confirm-store）+ 运行中徽章（activity 轮询）+ 「查看执行历史」打开右侧 `HistorySheet`
  - `TaskEditor.tsx` — 任务编辑 Dialog（builtin 分支：名称只读固定 label + 工作区 + 触发器 + 内置详情区；custom 分支：名称 / prompt / ModelSelector / 必选工作区 / 触发器 + 工具包区；保存前客户端预校验 validateDraft 就地显示，其余交后端拒并 toast）
  - `BuiltinTaskDetailSection.tsx` — 内置任务详情区：模型选择行（MODEL_IO 按 builtinId 映射 digest/review/categorize 三组模型 IPC，onChange 即写盘）+ 加载磁盘提示词模板 +「全局模板」影响范围说明，保存提示词 / 恢复默认（confirm 后立即写盘，独立于任务保存按钮）+ 只读工具清单 Badge
  - `CustomToolPacksSection.tsx` — 自定义任务工具包区：基础工具组静态文案 + 可选包 Switch（包清单走 listToolPacks 动态源），生效集 = toolPacksOverride ?? 工作区启用集，拨动以工作区集合起步写 override，「重置为跟随工作区」清回 undefined
  - `TriggerListEditor.tsx` — 触发器编辑（时间规则 / 条件规则两组分区，八种触发器行内编辑含 on_task_done 选其他任务 + 行尾实时摘要预览 + 删除，无链式）
  - `utils.ts` — describeTrigger、formatRelativeFuture、周几 chips、datetime-local 双向转换
  - `history-utils.ts` — 执行历史展示纯函数（时间/耗时/token 格式化、状态元信息）
  - `HistoryEntryCard.tsx` — 历史条目卡片（状态徽章 / 触发原因 / 起止耗时 / token 用量 / 摘要与错误折叠）
  - `HistorySheet.tsx` — 执行历史右侧滑出面板（Sheet）：任务/状态筛选（下拉只列现存任务，旧历史条目靠 planName 冗余字段展示）+ 「正在运行」小节（读面板同源 activity 轮询）+ 条目卡片 + cursor 分页；原独立路由 `/run-history` 已删，旧 hash 由 `*` 兑底回首页
- `app/stocks/page.tsx` — 自选股行情页面，双栏布局（自选股列表 + 个股详情）
- `app/agent-monitor/page.tsx` — Agent Worker 池状态监控仪表板
- `app/debug/page.tsx` — 开发调试窗口，集成 AgentChat 测试

## 业务组件（components/）

- `agent-chat/` — AI 聊天模块（~20 文件）
  - `AgentChat.tsx` — 主组件（~250行），组合 hooks + 布局 + 右侧工具轨道 + Minimap 集成
  - `ChatInputArea.tsx` — 输入区域（引用芯片、图片预览、textarea、工具栏、斜杠命令菜单）
  - `MessageItem.tsx` — 单条消息渲染（用户/助手/isMeta消息、长文本折叠、sticky 冻结、分叉/编辑按钮；解析 `<sender/>` XML 标签在跨会话消息头显示派出者名字徽章）
  - `ContentBlockItem.tsx` — 内容块路由（text/tool_use/thinking/permission/askUser/compact_boundary）
  - `MessageMinimap.tsx` — 消息小地图（按轮次聚合、视口指示、跳转、hover 展开/固定）
  - `SearchBar.tsx` — 搜索浮条（Ctrl+F 快捷键、文本匹配高亮、激活项自动滚动）
  - `ThinkingBlock.tsx` — 思考块（compact/detailed 两种展示模式）
  - `StreamingIndicator.tsx` — 运行状态指示器（基于 pendingState：思考中/执行工具/生成中；flushing 态显示插话队列长度）
  - `AskUserQuestionCard.tsx` — AskUser 问题卡片（单选/多选）
  - `PermissionRequestCard.tsx` — 权限请求卡片（允许/拒绝/始终允许）
  - `CitationBadge.tsx` — 引用徽章
  - `CollapsibleBlock.tsx` — 可折叠块基础组件
  - `SubAgentPanel.tsx` — 子 Agent 面板
  - `SubAgentBlock.tsx` — 子 Agent 块
  - `LineageBar.tsx` — 溯源条：当前对话 contractMetadata 存在（agent 派出）时顶部显示「由 [派出者标题] 派出：[task]」，点击跳转派出者会话；派出者已删除时显示灰色占位
  - `highlight.ts` — 搜索高亮工具（mark 黄底 + active 橙底 ring）
  - `minimap-utils.ts` — 消息预览提取工具函数
  - `transformers.ts` — 消息转换工具（历史回放末尾调 injectTaskSummary 吸附任务汇总块）
  - `task-aggregator.ts` — Task* CRUD 聚合纯函数（aggregateTasks / injectTaskSummary），把分散的 TaskCreate/TaskUpdate 合成单个 task_summary 虚拟块
  - `types.ts` — 类型定义（Message、ContentBlock，含 isMeta/isCompactBoundary/task_summary 等字段）
  - `utils.ts` — 工具函数（getUserMessageSearchableText 等）
  - `hooks/` — 自定义 hooks（12 个）
    - `useAgentSession.ts` — 会话生命周期（创建/resume/fork/关闭）+ 订阅 pendingCountChanged 暴露 pendingCount
    - `useSessionMessages.ts` — 消息流监听与流式更新
    - `useSessionEvents.ts` — 权限/AskUser/通知事件监听
    - `useMessageHistory.ts` — 历史消息加载（含 compact_boundary/isMeta 处理）
    - `useImageAttachment.ts` — 图片附件（base64、粘贴、预览）
    - `useSendMessage.ts` — 消息发送、编辑重发、分叉、权限响应、斜杠命令拦截
    - `useSlashCommands.ts` — 斜杠命令检测、过滤、菜单控制
    - `useChatScroll.ts` — 统一滚动控制（followMode 状态机 auto/manual，wheel/touch/keydown 判定用户介入，ResizeObserver 续滚，scrollToMessage/scrollToElement）
    - `useMessageSearch.ts` — 消息搜索（文本匹配、高亮、激活项追踪）
    - `useSubAgentMessages.ts` — 子 Agent 消息流处理
    - `useTaskListAggregator.ts` — 流式 task_summary 维护（监听 messages，签名比较防抖，把吸附位置随最后一次 Task* 调用迁移）
    - `usePendingState.ts` — 纯函数 derivePendingState({ isRunning, pendingCount }) → 'idle' | 'running' | 'flushing'
  - `tool-renderers/` — 工具块专属渲染器（由 ToolBlock 路由分发）
    - `ToolDetailShell.tsx` — 统一展开容器（ToolSection / KeyValueList / OutputBox），bg-card+border 替代 bg-muted/20，主内容用 text-foreground
    - `ReadRenderer.tsx` — Read 工具：文件路径头 + 等宽内容块
    - `GlobRenderer.tsx` — Glob 工具：pattern 徽章 + 匹配文件路径列表
    - `GrepRenderer.tsx` — Grep 工具：pattern 徽章 + 命中行 + 关键词高亮
    - `SkillRenderer.tsx` — Skill 工具：lucide Zap 琥珀色图标 + Skill 名 + 参数 + 输出
  - `usage-badge/` — 会话 token 用量监控（输入框工具栏徽章 + HoverCard 详情）
    - `UsageBadge.tsx` — 徽章本体：进度条 + token 文字，hover/click 固定展开 HoverCard
    - `UsageHoverCard.tsx` — 详情卡容器（组合下列四块）
    - `UsageSummaryHeader.tsx` — 头部：上下文进度（SDK 真实快照）+ 会话级缓存命中率 + 累计轮数/API用时/首token + token 合计（不显示金额）
    - `UsageByModel.tsx` / `UsageByTool.tsx` — 按模型轮数 / 按工具次数聚合（工具 Top5 折叠）
    - `UsageEntryList.tsx` / `UsageEntryRow.tsx` — 明细列表（默认5条+全部展开，压缩 marker 特殊行）+ 单行 click 展开二级明细（5m/1h缓存、子代理、权限拒绝）
    - `useConversationUsage.ts` — hook：getUsage 拉取 + usageEntryAdded 订阅刷新 + 从 latestContext 派生上下文占用/上限
    - `UsageContextBreakdown.tsx` — 上下文构成细分（SDK categories 按类别 token 占比条）
    - `usage-utils.ts` — 派生纯函数（resolveContext/ContextInfo/formatTokens/cacheHitRate），含单测
- `ToolBlock.tsx` — 工具块路由组件（顶层 components/，按工具名分发到专属 renderer 或 ToolDetailShell；图标走 lucide 简约样式，无边框包裹）
- `WorkspaceExplorer.tsx` — 工作区文件树（@headless-tree/react），拖放/重命名/删除/新建
- `ArticlePreview.tsx` — 网络文章内容预览，选中文字浮动引用按钮
- `ConversationList.tsx` — 对话列表主骨架（单一滚动视图：手动文件夹 → 近期 → 智能分类 + 归档 Popover 浮窗）
- `conversation-list/` — 对话列表子组件（拆分；按组渲染）
  - `ConversationRow.tsx` — 通用会话行（所有 section 共用，含 nodeId 必填 / 双层高亮 useNodeHighlight / 编辑/引用/删除 hover 按钮；agent 派出会话（contractMetadata.createdBy='agent'）显示 Bot 图标 + task tooltip；文件夹相关 ContextMenu 已上移到 GroupCard）
  - `ManualSection.tsx` — 手动文件夹区（无「手动分组」总标题，文件夹平铺；headless-tree 仅在此用；children[__root__] 里的 folderId 节点及其子树，叶子渲染 GroupCard 装 groupId；订阅 section-collapse-store.folderReveal 展开祖先文件夹链）
  - `SmartSection.tsx` — 智能分类视图（默认折叠，展开状态在 section-collapse-store；按 groupIds.length 倒序，空分类隐藏，渲染 GroupCard；useSmartCategoryStore.load 同步）
  - `RecentVirtualGroup.tsx` — ⚡ 近期 < 5 天虚拟分组（默认展开到话题卡，折叠状态在 section-collapse-store），按 group.updatedAt
  - `ArchiveSection.tsx` — 归档段 Popover 浮窗（向上弹出，ScrollArea max-h-80 限高），懒加载 listArchivedConversations
  - `Toolbar.tsx` — 顶部"新建对话"按钮（"新建文件夹"按钮在 ManualSection 内）
  - `AddGroupToFolderMenu.tsx` — 组级：多选 ContextMenuCheckboxItem 子菜单，调 addGroupToFolder
  - `MoveGroupToFolderMenu.tsx` — 组级：单选子菜单，调 moveGroupBetweenFolders
  - `utils.ts` — getRelativeTime / getConversationTitle / RECENT_THRESHOLD_MS / CONV_TREE_ROOT / openOrFocusConversation（统一 selectConversation + openTab 入口，接 nodeId 设 lastFocusedNodeId）/ useNodeHighlight（isOpen 淡色 = 会话已开 tab；isSelected 深色 = 当前活动 tab 的会话，随 switchTab/关 tab 回退自动跟随；独立窗口会话无 tab 退回 lastFocusedNodeId 点击处高亮）
- `group-list/` — 组级 UI 组件
  - `GroupCard.tsx` — 组卡片（组标题 + 展开/收起会话行；agent 派出会话平摊到组内，用 sortConversationsWithDFS 让子会话紧跟派出者；无 folderId 时显 AddGroupToFolderMenu / 有 folderId 时显 MoveGroupToFolderMenu + 从文件夹移除 + 删除组走 confirm-store 二次确认）
  - `utils.ts` — 组 helpers（deriveGroupTitle：group.title 直读，无 title 返回"未命名话题"）
- `WorkspaceSwitcherPopover.tsx` — 顶部导航栏工作区切换器（选择/添加）
- `WelcomeFirstRun.tsx` — 零工作区首次启动引导卡片
- `WorkspaceRuleDialog.tsx` — 工作区规则 Dialog（agent.md 编辑器）
- `EmptyFocusState.tsx` — 无聚焦对话时的占位
- `MarkdownRenderer.tsx` — Markdown 渲染器，GFM + 代码高亮
- `ModelSelector.tsx` — 通用模型选择下拉（按 Profile 分组、按 modelId 去重、可选「不指定」、inline/block 两种触发器）
- `ConfirmDialog.tsx` — 全局确认弹窗（基于 shadcn AlertDialog，由 confirm-store 驱动）
- `StatusPulse.tsx` — 状态脉冲指示器（蓝色=等待确认，橙色=运行中），支持 sm/md 两种尺寸
- `ArticleParseHistoryPanel.tsx` — 网络文章解析历史面板，追踪 script/readability/ai 状态
- `dashboard/` — 首页工作台（固定「首页」tab 内容）
  - `Dashboard.tsx` — 容器（@container 自适应：窄屏堆叠 / 宽屏左报告右速记），按 workspace.id 拉 loadReport + loadNotes
  - `ReportSection.tsx` — 首页报告区（MarkdownRenderer 渲染 `dashboard.md` 正文 + 刷新按钮触发 triggerReview + 相对时间）
  - `ScratchpadSection.tsx` — 速记板（800ms debounce 自动保存）
- `wechat/` — 微信 Bot 模块
  - `WechatDialog.tsx` — 微信认证 Dialog（QR码扫描 / Bot 控制面板）
  - `BotControlPanel.tsx` — Bot 控制面板（名称、轮询状态、连接错误、断开连接）
  - `QRCodeAuth.tsx` — QR码认证组件
- `stock/` — 自选股行情模块
  - `WatchList.tsx` — 自选股列表（右键删除、点击选中）
  - `StockSearch.tsx` — 股票搜索弹窗（东方财富搜索 API，防抖输入）
  - `StockQuote.tsx` — 行情卡片（30+ 字段，含外盘/内盘/涨停/跌停，红涨绿跌）
  - `KLineChart.tsx` — K线图（Lightweight Charts v5，蜡烛图+均线+成交量，支持分钟/日/周/月K）
  - `TimelineChart.tsx` — 分时图（价格线+均价线+成交量）
  - `MoneyFlow.tsx` — 资金流向（主力/散户净流入柱状图）
  - `StockFundamental.tsx` — 基本面数据网格（含52周高低/股本/委差）
  - `DailySnapshotList.tsx` — 历史每日快照表格（外盘/内盘/占比/涨跌幅/换手率/均价）
  - `StockDetail.tsx` — 个股详情容器（行情+K线+Tab切换分时/资金/基本面/历史快照）
  - `shared/PriceText.tsx` — 价格文字（红涨绿跌自动着色）
  - `shared/PercentBadge.tsx` — 涨跌幅徽章

## 状态管理（stores/）

- `workspace-store.ts` — 工作区状态：文件树、选中文件、文件操作（CRUD/移动）
- `article-store.ts` — 文章状态：选中文章、文章解析、URL 输入框
- `conversation-store.ts` — 对话状态：对话列表、选中对话、分叉参数、编辑重发、对话级模型（setConversationModelSelection）、会话重启触发（sessionRestartTrigger）；loadConversations 并行拉 conversations + tree + groups 后一次写完并同步 group-store；focusConversationById（Tab 焦点联动入口）在活跃会话切换时调 revealTopicInList 展开左侧列表定位话题；三个 folder actions 已改名（addGroupToFolder / moveGroupBetweenFolders / removeGroupFromFolder）；导出 CONV_TREE_ROOT 根哨兵；`runningConversationIds` / `pendingActionConversationIds` 两个 Set 唯一订阅源是后端 `sessionStateChanged` / `sessionClosed`（废弃旧 `conversationRunningStateChanged` 前端订阅，删除乐观直写以避免双源 race）
- `group-store.ts` — 会话组状态：groups[] + currentGroupId + expandedGroupIds（默认全折叠）+ syncGroups（conversation-store loadConversations 拉完 groups 后同步写入，不碰展开状态）+ expandGroup（reveal 单向展开）/ createGroup / updateGroup / archiveTopic / restoreTopic / deleteTopic；RECENT_THRESHOLD_MS 常量在此；load 时异步触发 autoArchiveStale，有归档则重新拉取
- `section-collapse-store.ts` — 左侧列表分区折叠状态：recentExpanded（「近期」默认展开）/ expandedSmartCategoryIds（智能分类默认全折叠）/ folderReveal（nonce 供 ManualSection 订阅后逐层 expand 祖先文件夹链）；revealTopic(groupId) 在活跃会话切换时展开话题所在全部分区与话题卡片，数据源动态 import group/smart-category/workspace/conversation 四个 store
- `reference-store.ts` — 引用状态：引用文章列表、引用片段（用户选中文字）
- `slash-command-store.ts` — 斜杠命令状态：SDK + 自定义命令合并、capabilities 更新
- `settings-store.ts` — 应用设置：加载/保存/重启会话（整体 save 模式）
- `ui-store.ts` — UI 状态：设置 overlay 开关、右侧面板折叠（rightPanelOpen）
- `confirm-store.ts` — 全局确认弹窗：confirm() 返回 Promise，showConfirm() 简化版
- `stock-store.ts` — 自选股状态：watchlist/quotes/K线/分时/资金流向/搜索/RateLimiter 状态
- `dashboard-store.ts` — 首页工作台状态：reportMarkdown/reportUpdatedAt（首页报告）+ notesContent（速记板）+ reviewActivity 轮询 + triggerReview/loadReport/loadNotes/flushNotes actions
- `session-store.ts` — 多会话标签页：tabs[] + activeTabId + sessionWindowIds + lastFocusedNodeId（UI 状态：对话列表节点双层高亮区分"被点击的那一处" vs "已打开的同会话其他节点"）；导出 `HOME_TAB_ID` 哨兵（非真实会话）表示首页 tab，activeTabId 初始/关末 tab 后回退到该哨兵；`SessionTab` 无 `isStreaming` 字段运行态一律读 `conversation-store.runningConversationIds`）
- `smart-category-store.ts` — 智能分类前端：categories / activity / load / triggerFullRebuild / cancel / refreshActivity / reset；模块加载时订阅 categoriesUpdated 事件自动 reload（dynamic import @/lib/events 避免 SSR 爆）。UI 消费仅 categories/loading/load（会话列表 SmartSection + 设置页面板），运行入口类 action 已收敛到定时计划
- `scheduler-store.ts` — 定时任务前端：tasks（ScheduledTaskWithNextRun，nextRunAt 现算不落盘）/ activity（refreshActivity + 10s 轮询启停）/ history（倒序分页：loadHistory(historyTaskId?) + loadMoreHistory，cursor=上页末条 ts）+ 任务 RPC 封装（saveTask/deleteTask/stopTask 失败 toast 后端文案）

## 工具函数（lib/）

- `client.ts` — tipc 客户端，window.ipcRenderer 通信入口
- `utils.ts` — cn() 类名合并工具
- `events.ts` — tipc 事件处理入口，监听主进程事件
- `model-selection.ts` — 模型选择纯函数：dedupeProfileTiers（按 Profile 提取去重后的 (tier, modelId) 列表）/ sameSelection（结构相等比较）
- `conversation-sort.ts` — sortConversationsWithDFS：组内会话排序纯函数，手动会话按 updated_at 倒序 + agent 派出会话按 DFS 紧跟派出者（parentSessionId 不在组时回落自然序）
- `sdk/index.ts` + `sdk/query.ts` — Claude Agent SDK 的 query 函数封装

## 类型定义（types/）

- `article.ts` — ArticleMeta / Article / QuoteSnippet
- `ai.ts` — AIInteraction / AIMessage
- `settings.ts` — ModelTier / ModelSelection / ModelProfile / AppSettings（含 defaultModelSelection 与 digest/review/categorizeModelSelection 各自独立；含 `subAgent = { profiles: SubAgentProfile[] }` 子会话派遣 Profile 清单，SubAgentProfile.enabled 仅非 default 有意义——停用后系统提示词索引不列出、startChild 拒绝；根级 `basicToolPermissions` 七工具映射；`ai.permissionMode` 为 `default | autoExecute` 两态；`ai.effort` 控制推理努力程度）/ DEFAULT_SETTINGS
- `agents.ts` — TaskStatus / TaskType / AgentTask / ForkParams
- `electron-api.ts` — Workspace / WorkspaceFileNode / ExtendedSessionMessage / Citation / Conversation（含 modelSelection/contractMetadata — 后者记录 agent 派出溯源：createdBy / parentSessionId / task）
- `delegation.ts` — Agent 协作契约数据模型（ContractMetadata / ChildSessionState / 契约通道消息类型）
- `stock.ts` — WatchlistItem / StockQuote / KLineDataPoint / TimelinePoint / MoneyFlowPoint / StockSearchResult / DailySnapshot / QUOTE_FIELD_MAP / RateLimiterStatus / Announcement / AnnouncementType / ListAnnouncementsOpts / AnnouncementDetail / CachedAnnouncementEntry
- `usage.ts` — 会话用量数据模型（ConversationUsageEntry / CompactMarker / ContextSnapshot / ConversationUsage / UsageJsonlLine），主进程镜像在 `electron/main/types.ts`
- `system-prompt.ts` — SystemPromptSegment（key/label/category/template/triggerDescription/isDynamic），主进程镜像在 `electron/main/types.ts`
- `smart-category.ts` — 智能分类数据模型（DigestTags / SmartCategory { groupIds[] } / CategorizeDecisionLog { groupId } / SmartCategoriesIndex / CategorizeActivity / CategorizeRecentEntry），主进程镜像在 `electron/main/types.ts`
- `scheduler.ts` — 定时任务数据模型（ScheduledTask 两变体 builtin|custom / Trigger 八种含 on_task_done 任务链 / TaskRunState / RunHistoryEntry / SchedulerActivity / ScheduledTaskWithNextRun / HistoryPage），主进程镜像在 `electron/main/services/scheduler/types.ts`
- `electron.d.ts` — window.ipcRenderer 全局类型声明

## IPC 路由（electron/main/tipc/）

- `index.ts` — 路由注册中枢，聚合所有子路由
- `agent.ts` — Agent 会话管理（RPC：创建/发送/关闭会话、权限控制）
- `ai.ts` — 通用 AI 接口（chat / summarize，占位实现）
- `article.ts` — 网络文章管理（抓取解析、列表、详情、删除）
- `conversations.ts` — 对话 CRUD + 分叉（JSON 存储）
- `workspace.ts` — 工作区管理（列表、默认、文件夹选择、文件树）
- `file.ts` — 文件操作（打开文件位置）
- `explorer.ts` — 工作区文件树操作（创建/重命名/移动/复制/删除）
- `stock.ts` — 自选股行情 + 分析（12+RPC：自选股CRUD、批量行情、单股行情+自动快照、K线、分时、资金流向、每日快照查询、搜索、限流状态 + 指标计算、筛选、财务、回测等）
- `usage.ts` — 会话用量查询（getUsage：懒重算 usageSummary 后读 JSONL）
- `digest.ts` — 组卡巡检（listGroupDigests / readGroupDigest / triggerGroupDigestScan 全工作区扫脏 / triggerGroupDigest 单组重跑 / getGroupDigestActivity 活动轮询 / get+setGroupDigestPrompt 提示词读写 / cancelGroupDigest 单任务取消 / cancelAllGroupDigest 一键停（清队列+取消当前）/ get+setDigestModelSelection 沿用旧的 settings.ai.digestModelSelection 配置项）
- `review.ts` — 首页报告（历史代号 review）：getReport 读 `dashboard.md` / triggerReview 触发生成 / getReviewActivity 活动轮询 / get+setReviewPrompt 提示词 / get+setReviewModelSelection 整体模型选择 / cancelReview 取消
- `category.ts` — 智能分类：getCategories（含归档过滤，按 groupIds 存活性过滤）/ triggerCategorize { workspaceId, groupId, groupDigestPath } / triggerFullRebuild / cancelCategorize（无参全局单队列）/ getCategorizeActivity / get+setCategorizePrompt / get+setCategorizeModelSelection 整体模型选择 / get+setSmartCategorySettings（enabled/threshold/maxCategories，后端 clamp）；conversations.ts 也加了 addGroupToFolder / removeGroupFromFolder / moveGroupBetweenFolders 三个 IPC 支持手动文件夹装 groupId + 多引用，以及 setConversationModelSelection 单独写对话级模型
- `agent.ts` — Agent 会话管理，路由统一查 `getPiSessionManager()`（）：setSessionModel（接收 ModelSelection，返回 `{ ok:true; needsRestart? } | { ok:false; error }`；同 profile 换 tier 走 PiSession 快速路径，跨 profile 由前端触发会话重启）；`closeQueryBasedSession` = release 语义（refCount-1，归零即销毁），`forceCloseQueryBasedSession` = 强杀（`/clear` 走这条立刻销毁避免后台弹卡片）；路由名保留旧字样是历史兼容，内部实现已纯 pi
- `system-prompt.ts` — 系统提示词模板查询（getSystemPromptSegments，返回 `{ segments } | { error }`，供设置页只读预览用户看不见的系统级 append 段）
- `scheduler.ts` — 定时任务（listTasks 含现算 nextRunAt / saveTask 全量校验含触发态合并、on_task_done 引用与环检测、toolPacksOverride 清洗，builtin 名称锁定 / deleteTask 拒 builtin「内置任务不能删除」/ setTaskEnabled / runTaskNow 手动直跑不看 enabled / stopTask 整停（清队列+取消当前）/ listRunHistory 倒序分页（planId 过滤=任务 id + before cursor）/ getSchedulerActivity 运行快照 / getBuiltinTaskDetail + saveBuiltinPrompt + resetBuiltinPrompt 内置任务提示词三件套）
- `renderer-handlers.ts` — main→renderer 事件定义（分析更新、会话消息、权限请求、usageEntryAdded、categoriesUpdated、pendingCountChanged、sessionStateChanged / sessionClosed 跑步机状态原子事件 等）

## 业务服务（electron/main/services/）

- `conversation-service.ts` — 对话索引 CRUD + 对话级模型选择（`.dogear/conversations.json`），含 modelSelection 字段；create() 时由 tipc 注入 settings.ai.defaultModelSelection 浅拷贝，createFork() 继承父对话 modelSelection；updateModelSelection 单独维护；listByParent(workspaceId, parentConversationId) 只读查某父会话全部 role='sub' 对话（调度站 getChildrenByParent 持久层补集数据源）；含 usageSummary（applyUsageSummary 增量、recomputeUsageSummaryIfStale 懒重算）
- `usage/` — 会话 token 用量采集与存储
  - `usage-extractor.ts` — 从 SDK result 提取 ConversationUsageEntry 纯函数（contextWindow 查 `pi/model-catalog.ts` 目录表、modelUsage 缺失合成、工具/子代理聚合）
  - `usage-service.ts` — 用量 JSONL 读写删（`.dogear/usage/{conversationId}.jsonl`，appendEntry/appendCompactMarker/appendContext/readUsage/deleteUsage）
- `memory/` — 会话清洗 + 组级提炼闭环（按「组」粒度）
  - `session-paths.ts` — 会话路径解析共享 util（getClaudeConfigDir / getSdkSessionsDir / getSessionJsonlPath）：服务 PARSE_ARTICLE 及 `agent.ts` 的 `getSubAgentHistory`/`getSdkSessions`（子代理历史文件路径），与主会话 pi-session/ 的 Harness 会话路径（`pi-session-repository.ts` 的 `getSessionsRoot`）是两套不同的存储位置
  - `transcript-cleaner.ts` — 会话 JSONL 确定性去噪（cleanTranscriptFromLines 纯函数 + cleanTranscript IO，剥工具结果/系统行/思考块，保留用户+助手文字与一行工具骨架，~20x 压缩）
  - `group-digest-store.ts` — 组卡读写（GroupDigestCard 序列化/解析 + sourcesSeen 合并 + readGroupDigest/saveGroupDigest/listGroupDigests/deleteGroupDigest；落 `<configDir>/workspaces/<wsId>/groups/<groupId>/digest.md`；导出 getGroupDir 供组内其它文件复用）
  - `group-digest-prompt.ts` — 组提炼提示词模板（DEFAULT_GROUP_DIGEST_PROMPT + loadGroupDigestPrompt 播种 `<configDir>/group-digest-prompt.md` + saveGroupDigestPrompt；设置页可编辑）
  - `group-digest-scanner.ts` — 组卡脏判定（isGroupDirty 纯函数按「新会话加入 / 会话 mtime 增长 / 会话被移出」三条件；findDirtyGroups / scanDirtyByGroup / scanDirtyByConversation；子会话 role='sub' 被过滤）。`findDirtyGroup(..., force)` 的 force=true 跳过脏判定并返回全量 main 会话，只给设置页手动「重新提炼」用
  - `source-fidelity.ts` — 组卡引用保真度校验：`buildSessionUuidIndex(workspacePath, sessionIds)` 复用 `cleanMessagesFromLines` 建「sessionId → 去噪后 uuid 集合」索引（每会话只读一次，缺文件映射为 null）；`validateItemSources` 纯函数逐条查，分三种问题——uuid_not_found（编造）/ wrong_session（张冠李戴，回告正确 sessionId）/ session_missing。**校验口径必须与 agent 所见一致**，所以复用同一个去噪函数而非 JSONL 全量 uuid
  - `group-digest-trigger.ts` — 组提炼编排（串行队列并发=1 + in-flight 去重；triggerGroupDigestScan / triggerGroupDigestByGroup / triggerGroupDigestByConversation；提交 GROUP_DIGEST_SESSION 任务）+ 活动采集（current/queueDepth/recent 环形 / lastScan）+ recent/lastScan 持久化到 `<configDir>/digest-activity.json`（sync load + debounce 500ms save）+ cancelAllGroupDigest 一键停 + 成功后 chainCategorize
  - `migration-p3.ts` — 启动幂等迁移（app.whenReady 之后一次跑完）：① 旧 `<sessionId>.md` → `<groupId>.md` 1:1 重命名并落 sourcesSeen；② smart-categories.json 的 conversationIds → groupIds；③ conversation-tree.json 的 children 从 conversationId → groupId + schemaVersion=2；旧产物落 `_archive/`，二次执行检测已迁移即跳过
  - `notes-store.ts` — 组共享区 `_notes/` 目录读写（列出/读取，供组提炼 agent 优先利用 working agent 的阶段总结）
  - `background-store.ts` — 组背景 background.md：结构化 frontmatter（topic / progress / keyDecisions / openQuestions），落 `<wsData>/groups/<groupId>/background.md`，供组内新会话派子会话查阅
  - `migration-gate.ts` — 启动闸门：whenMigrationReady() 阻塞组提炼 / 分类 trigger，直到 markMigrationComplete() 被调用
  - `migration-p4.ts` — 幂等迁移：组卡从 `<wsData>/digests/<groupId>.md` 迁到 `<wsData>/groups/<groupId>/digest.md`，删除 `digests/_cleaned/`（不再留盘干净逐字稿）
  - `dashboard-watcher.ts` — dashboard.md 文件监听（chokidar，变更时向前端广播 dashboardChanged 事件，触发 dashboard-store 重新拉取）
  - `review-store.ts` — 首页报告存储：ReportDoc { updatedAt, markdown } 落 `<configDir>/workspaces/<wsId>/dashboard.md`
  - `review-scanner.ts` — 报告脏检查：isReportStale 纯函数（最新组卡 updatedAt vs 报告 updatedAt）
  - `review-prompt.ts` — 报告提示词模板（引导 agent 分流为「记忆 dogear__SaveMemory + 报告 dogear__WriteReport」，读组卡驱动）
  - `review-skill-service.ts` — `<configDir>/skills/review/SKILL.md` 初始化，供普通会话「聊聊首页」交互式触发
  - `review-trigger.ts` — 报告生成编排（串行队列 + in-flight 去重；triggerReview 提交 REVIEW_SESSION 任务）+ 活动采集
  - `smart-category-store.ts` — 智能分类索引读写（`<configDir>/workspaces/<wsId>/smart-categories.json`）+ 纯函数 helpers（pushGroup / removeGroupEverywhere / appendDecision 环形 20 条 / newCategory）
  - `smart-category-engine.ts` — 决策纯函数：matchByThreshold（Step A 阈值匹配，0 LLM）+ pickRedistributeCandidates（Step C 邻近候选召回）+ normalizeTag/normalizeTags（标签归一化）
  - `categorize-prompt.ts` — 分类提示词模板（DEFAULT_CATEGORIZE_PROMPT + loadCategorizePrompt 播种 `<configDir>/categorize-prompt.md` + saveCategorizePrompt）
  - `category-trigger.ts` — 分类编排（串行队列并发=1 + in-flight 去重；triggerCategorize(workspaceId, groupId, groupDigestPath) 单条 / triggerFullRebuild 工作区全量 / cancelCurrent 取消正在跑的任务）+ 活动采集 + outcome=match/join/new 时广播 categoriesUpdated
  - 注：工作区主题记忆（memory-service / memory-recall / memory-fs / memory-indexer / memory-loader / memory-types）也在此目录
- `scheduler/` — 定时任务系统（一行一任务：builtin 四种常驻可改不可删 + custom 自定义；任务级触发器 OR 语义，分钟级 tick 调度；单例 getSchedulerService 在 index.ts 启动接线 init）：
  - `types.ts` — 数据模型（ScheduledTask[builtin|custom] / Trigger 八种含 on_task_done 任务链 / TaskRunState / RunHistoryEntry / SchedulerActivity / ScheduledTaskWithNextRun），渲染层镜像 `types/scheduler.ts`
  - `builtin-task-meta.ts` — 内置任务元数据：BUILTIN_TASK_IDS / BUILTIN_LABELS 共享常量 + BUILTIN_TASK_META（label / loadPrompt / savePrompt / defaultPrompt / tools，复用四个既有 prompt 模块的磁盘机制）
  - `time-rule-engine.ts` — 时间规则纯函数（validateTrigger / nextDueAt / minNextDueAt / detectMissed / windowOpen / windowCloseAt / describeTrigger 中文摘要）
  - `plan-store.ts` — `.dogear/plans.json` 读写（`{version:2, tasks}` 容器；loadTasks 读时一次性迁移+seed，模块级 readyPromise 防并发可重试；旧数组格式按任务拆条：on_plan_done 过滤 / 空计划丢弃 / builtinId 去重保首条 / runState 丢弃；seed 固定 id `builtin-${builtinId}`；safe-json 原子写 + 变更互斥队列；touchTriggerFired / markOnceFired / updateTaskRunState 细粒度变更）
  - `plan-validate.ts` — 保存校验纯函数（assignTaskIds / mergeFiredState 按 trigger.id 保留旧触发态 / validateTaskForSave（builtin name 必须 === 固定 label、custom prompt 与 workspaceId 必填）/ on_task_done 目标存在性校验 + detectTaskCycle 任务链环检测 / KNOWN_TOOL_PACKS + sanitizeToolPacksOverride 过滤未知包名）
  - `scheduler-service.ts` — 调度核心（60s tick 按任务逐触发器求值；窗口状态机开触发关停机；handleAppStart / handleSessionClose 事件入口；启动错过检测记 missed 不补跑；runTaskManual 直调 runner 不看 enabled；task_done 完成事件触发 on_task_done 下游 fireTaskDoneDownstream；stopTask 整停转 runner.requestStop）
  - `run-history-store.ts` — `.dogear/run-history/YYYY-MM.jsonl` 按月追加 + queryHistory 倒序分页（before 语义 cursor）+ 保留 3 个月自动清理
  - `custom-agent-prompt.ts` / `custom-agent-tools.ts` — CUSTOM_AGENT 自定义任务的提示词模板与工具集组装（基础文件/搜索工具 + 常驻 memory/review 工具 + 可选包：toolPacksOverride 有值时完全替代工作区 enabledToolPacks，workspace 边界校验，不装 Bash）
  - `runtime/plan-runner.ts` — 单任务执行器（单例 getTaskRunner：按 task.id 防重入 / runState.cursorStartedAt 断点补记 interrupted 历史 / task_done 事件 / requestStop 按任务类型分派取消——custom 走 agentTaskId cancelTask、builtin 走各 trigger 层 cancelAll*，stopRequested 标注 summary）
  - `runtime/task-executor.ts` — 任务执行（builtin 四种直调现有 memory trigger 层并等队列空闲；custom 提交 CUSTOM_AGENT 到 agent-manager Worker 池等待回调，payload 携带 toolPacksOverride，hooks.onAgentTaskId 回填 id 供停止取消，模型三级 fallback，token 用量提取入历史）
- `conversation-runtime-service.ts` — 会话运行时管理（多附件绑定 desktop/wechat-bot、会话快照、复用 session）
- `contract-channel-service.ts` — 契约通道校验（hasDirectContractChannel：只认直接派出关系，A 派 B 派 C 时 A 无法直连 C；dogear__SendMessage / dogear__StopSession 工具层前置校验）
- `group-service.ts` — 会话组 CRUD（`.dogear/groups/{workspaceId}.json`）：listGroups / getGroup / createGroup / updateGroup / deleteGroup / archiveGroup / restoreGroup / listActiveGroups / touchGroup（会话活动时刷新 updatedAt）
- `group-shared-service.ts` — 组共享区文件读写（`.dogear/workspaces/{wsId}/groups/{groupId}/shared/`），供 group-tools 和前端 SharedAreaPanel 使用
- `auto-archive-service.ts` — 自动归档：autoArchiveStaleGroups(wsId) 筛选 updatedAt 超 30 天且不在手动文件夹的活跃组，逐个 archiveGroup + removeGroupEverywhere，在 group-store.load 时异步触发
- `conversation-tree-service.ts` — 手动文件夹树（`.dogear/workspaces/{wsId}/conversation-tree.json`）：children 装 groupId（schemaVersion=2）；listFolders / addGroupToFolder / removeGroupFromFolder / moveGroupBetweenFolders / initializeTree
- `workspace-json-service.ts` — 工作区 JSON 存储（`.dogear/workspaces.json`）
- `settings-service.ts` — 应用设置 JSON 存储（`.dogear/settings.json`，含 permissionMode、basicToolPermissions；导出 normalizeSettings 做幂等历史设置迁移与结构修复，清理遗留 SDK 字段）
- `ai-service.ts` — AI 接口占位（chat / summarize）
- `article-service.ts` — 网络文章抓取（V2：平台脚本优先 + Readability 兜底 + AI 失败才介入），微信公众号特殊处理
- `article-parser-skills-service.ts` — 网络文章解析 Skills 和 MCP 工具定义
- `workspace-service.ts` — 获取当前默认工作区（thin wrapper）
- `workspace-fs-service.ts` — 文件树扫描和文件系统操作（安全路径验证）
- `safe-json.ts` — 安全 JSON 存储（原子写入+备份+互斥锁），防止数据丢失
- `stock/` — 自选股行情服务模块
  - `rate-limiter.ts` — 请求防御体系（令牌桶 + 滑动窗口 + 断路器 + 请求合并 + 内存缓存）
  - `stock-service.ts` — 三数据源 API 封装（腾讯行情/分时 + 东方财富K线/搜索 + 新浪K线备用，7个方法）
  - `stock-watchlist-service.ts` — 自选股 JSON 存储（`.dogear/stocks/watchlist.json`）
  - `stock-data-service.ts` — K线 + 每日快照 JSONL 增量存储（`.dogear/stocks/kline/` + `.dogear/stocks/daily/`）
  - `python-bridge.ts` — Python 守护进程通信（JSON-RPC，stdin/stdout）
  - `formula-service.ts` — 公式 CRUD 存储（`.dogear/stocks/formulas.json`）
  - `announcement-service.ts` — 公司公告服务（巨潮资讯网）：`listAnnouncements(code, market?, opts?)` 走 orgId 映射 + `hisAnnouncement/query`；`readAnnouncement(url, code, market, meta?)` 命中 `<hash>.md` 直读 / 未命中下载 PDF → python-bridge `parseAnnouncementPdf` 解析 → 写盘 + index.json；PDF 30MB 双层拦截（content-length + 流式计数），只放行 `static.cninfo.com.cn` 防 SSRF；`clearAnnouncementCache(market, code)` 手动清缓存；共享 rateLimiter 令牌桶
  - `index.ts` — barrel export

## Agent 框架（electron/main/agents/）

- `agent-manager.ts` — Worker 线程池管理器，任务队列调度，空闲 Worker 60s 自动回收
- `agent-worker.ts` — Worker 线程执行器。**两个运行时并存**：五条后台一次性任务（GROUP_DIGEST / REVIEW / CATEGORIZE / CATEGORIZE_ORGANIZE 走调度器内置任务；CUSTOM_AGENT 为定时计划自定义任务，工具集按 `services/scheduler/custom-agent-tools.ts` 组装）都走 pi（`pi/run-once.ts`）；`PARSE_ARTICLE` 仍走 Claude Agent SDK——依赖 SDK 的 plugins skill 发现机制，pi 无对应物；主会话已完整迁移到下方 `pi-session/`，不再经过 agent-worker
- `pi/provider.ts` — pi 运行时的 provider 层：`resolvePiModel(appSettings, selection, subAgentFallback, fallback)` 按 profileId 解析出 `{ model, profile }`（`Model.id` 必须是真实模型 id，不是 profile/tier 组合）；`buildPiModels(profile)` 按 profile.piWireApi 造 anthropic-messages / openai-responses 客户端
- `pi/model-catalog.ts` — pi-ai 十个厂商目录（anthropic/openai/deepseek/zai/moonshotai/minimax/qwen-token-plan/xai/google/kimi-coding）合并的上下文窗口查表：`lookupContextWindow(modelId)` / `lookupCatalogEntry` / `FALLBACK_CONTEXT_WINDOW=200_000`；渲染层同源副本 `lib/pi-model-catalog.ts`（tsconfig 隔离无法共享，另有 `resolveModelWindow(entry)` 手填优先解析与 `parseContextInput` K/M 输入解析）；piModels 条目可带 `contextWindow` 手填窗口（主进程 provider 构造/usage 提取均按「手填 > 目录 > 200K」解析）
- `pi/run-once.ts` — pi 的一次性任务执行器：`runOnce({ systemPrompt, prompt, tools, model, profile, signal, maxTurns=30, onLog })`。**不抛出**，失败以 `{ ok:false, error, cancelled? }` 返回。pi 的 loop 故意没有轮次上限，这里在 `subscribe` 里数 `turn_start` 超限调 `agent.abort()`；`tool_execution_end` 带 `isError` 时以 `[tool-error]` 前缀走 onLog（四个 handler 都按该前缀落 WARN 级日志）
- `pi/tool-adapter.ts` — 运行时中立的工具定义层：`defineTool` / `ToolDef` / `toSdkServer`（给 SDK）/ `toPiTools`（给 pi，走 `z.toJSONSchema()`）。工具 handler 一律沿用 `isError: true` 约定，`toPiTools` 负责在 pi 侧翻转成 `throw`。自定义工具名自带 `dogear__` 前缀（与基础工具隔离名字空间），pi 侧不带 `mcp__server__` 前缀
- `pi-session/` — **主会话（及其派遣的子会话）运行时门面**，基于 pi-agent-core 的 AgentHarness：
  - `pi-session.ts` — `PiSession`（EventEmitter）：唯一门面类，`start()` 组装 systemPrompt/工具集/权限映射并创建 `PiHarnessAdapter`，`sendMessage`/`steer`/`interrupt`/`close`/`setPermissionMode`/`respondPermissionRequest` 覆盖完整生命周期、插话、权限确认、usage 采集；非 steer 发消息前按 `contextWindow×autoCompactPercent%` 阈值自动压缩（emit 'compacting'/'compact_boundary'，失败仅提示不阻断）
  - `pi-session-manager.ts` — `PiSessionManager`（单例 `getPiSessionManager()`）：conversation-runtime-service 唯一入口，引用计数式生命周期（`retain`/`release` 归零即销毁，无跑步机保活），`bindConversation` 维护 conversationId↔sessionId 映射，订阅 PiSession 事件转发到渲染层
  - `pi-session-repository.ts` — `PiSessionRepository`（单例）：按 workspaceId 缓存 `JsonlSessionRepo` 实例，封装 `create`/`open`/`delete`/`fork`/`getSessionPath`，session 根目录固定 `<configDir>/workspaces/<workspaceId>/sessions/`
  - `pi-harness-adapter.ts` — `PiHarnessAdapter`：构造 `AgentHarness` 并做事件订阅分发，暴露 `prompt`/`steer`/`compact`/`abort`，是 pi-session.ts 与 Harness 裸类型之间的唯一隔离层（Harness 类型不得外泄）
  - `message-converter.ts` — `convertPiEvent(event)`：把 pi `AgentEvent` 转成前端 `ExtendedSessionMessage`，供 PiSession 实时消息流使用
  - `history-adapter.ts` — `buildSessionHistory(workspaceId, sessionId)`：把 Harness branch entries 转成前端 `HistoryMessage[]`，唯一数据源是 session-history-reader.ts
  - `transcript-adapter.ts` — Harness 版逐字稿清洗：`cleanMessagesFromEntries` 去噪 + 工具骨架化，`readCleanTranscript` 提供 tail/range/uuid 三种切片读取，`buildSessionUuidIndex` 供组卡引用保真度校验，对齐旧 SDK transcript-cleaner 语义
  - `session-history-reader.ts` — `readSessionBranchEntries(workspaceId, sessionId)`：读取 Harness session 当前 branch 的唯一入口，其他模块不得直接解析 JSONL 或触碰 Harness 内部对象
  - `permission-mode.ts` — `PiPermissionMode` 类型定义（`default | autoExecute`）
  - `permission-rules.ts` — 基础工具权限判定纯函数：`isBasicToolName`、`getBasicToolPermission`、`decideToolPermission`（autoExecute 放行 / 工具包放行 / 基础工具按快照映射 / 其余 ask）
  - `skill-loader.ts` — 薄封装 pi-agent-core 的 `loadSkills`/`formatSkillInvocation`：`loadSkillIndex` 扫描目录产出 `SkillEntry[]`，拼 `<available_skills>` 索引文本，`createSkillTool` 提供懒加载 Skill 工具
  - `builtin-tools.ts` — `createBuiltinFileTools()`：复用 pi-agent-core 官方工厂函数返回 Read/Write/Edit/Bash 四个 harness 原生工具
  - `search-tools.ts` — `createSearchToolDefs(workspacePath)`：手写 Glob/Grep 工具，路径边界委托 workspace-boundary.ts
  - `usage-extractor.ts` — pi usage 采集：`accumulatePiUsage`/`extractPiUsageEntry`/`extractPiContextSnapshot`，字段映射对齐旧 SDK 口径供前端 usage 徽章零改动复用
  - `workspace-boundary.ts` — `resolveWithinWorkspace(workspacePath, candidatePath)`：路径边界校验（含符号链接逃逸拦截），供内建/搜索工具与 workspace-execution-env.ts 共用
  - `workspace-execution-env.ts` — `WorkspaceExecutionEnv`（实现 `ExecutionEnv`）：委托官方 `NodeExecutionEnv` 做实际文件 IO/子进程执行，每个带路径参数的方法前加边界校验
- `delegation-bridge.ts` — **子会话调度站核心状态机**（单例，所有 child 会话的检测/重调/降级/持久化都经此）：检测（wireSession 挂子会话 message 流 + createIdleWatch 滑动无进展计时 + timeout 双计时器，10 分钟无流事件判 hang）；重调（settleTerminal 终态统一结算：transient 在 MAX_RETRY 内自动 resumeChild 复活原会话，quota 错误 findFallbackModel 跨供应商降级）；降级（不重调的终态 notifyTerminalToWaiters 带结构化通知 {errorClass, attempts, modelTried} 秒级唤醒父会话的 dogear__WaitForMessage）；持久化（touchPersist 状态变化全量覆写 delegation-state.json，loadChildStates 启动恢复 running→interrupted）；另导出 startChild / stopChild / markChildDelivered / getChildrenByParent（async：内存为主 + conversation-service listByParent 持久层补集合并）/ waitForMessage / deliverMessage / abortWaitsForParent（前端「中断等待」按钮：取消该父会话全部等待并终止其运行中子会话）
- `delegation-idle.ts` / `delegation-terminal.ts` / `delegation-resume.ts` / `delegation-persist.ts` / `delegation-lifecycle.ts` — 调度站纯逻辑层：滑动 idle 计时（createIdleWatch，超时可注入）/ 错误分类（classifyDelegationError：quota 关键词表 + MAX_RETRY + isNotifiableTerminal + buildTerminalNotice 通知文案）/ 重调决策（decideResumeOnError + findFallbackModel 异供应商降级 + buildResumePrompt 续跑提示词）/ 持久化读写（persistDelegationState 锁内全量写 + loadRestorableChildren 恢复过滤 + conversationToSnapshot 持久层补集条目转换）/ 完成事件分类（classifyChildCompletion → no_delivery/failed/cancelled）
- `session-append-templates.ts` — 系统级 append 段模板集中处（REFERENCE_APPEND / groupAppendFor / NOTES_GUIDANCE_APPEND / subAgentContractFor），buildSystemPrompt 直接引用；末尾 getSystemPromptSegments() 收集 6 段模板 + 触发条件说明供设置页只读预览
- `agent-query-config.ts` — 共享的 SDK `query()` 配置构建器 + 设置读取入口（无 electron 依赖，Worker 线程内安全导入）：两类调用方共用——`PARSE_ARTICLE` 用它构建真正的 SDK query() 配置（主会话已迁移到 pi-session/，不再依赖本文件）；`GROUP_DIGEST`/`REVIEW`/`CATEGORIZE`/`CATEGORIZE_ORGANIZE` 四条 pi 后台任务只借用 `buildQueryBaseConfig` 读取 `appSettings`，再喂给 `pi/provider.ts` 的 `resolvePiModel`，本身不发起 SDK query()
- `task-types.ts` — 任务类型（SUMMARIZE/PARSE_ARTICLE/GROUP_DIGEST_SESSION/REVIEW_SESSION/CATEGORIZE_SESSION）和消息定义（含 ExtendedSessionMessage、各 Payload 源定义；GroupDigest/Review/CategorizeSessionPayload 用统一 modelSelection?: ModelSelection 字段；GroupDigestSessionPayload 携带 groupId + dirtyConversations[] + hasExistingCard）
- `logger.ts` — 日志工具（mainLogger / workerLogger / createTaskLogger）
- `tools/tool-registry.ts` — 工具注册表（SDK 内置工具 + 自定义工具注册，IPC 查询供设置页/代理编辑页动态加载）
- `tools/article-tools.ts` — 文章阅读工具（dogear__ReadArticle / dogear__ListArticles）
- `tools/stock-tools.ts` — 自选股工具（dogear__SearchStock / dogear__GetStockQuote / dogear__GetKLineData / dogear__GetTimeline / dogear__GetWatchlist / dogear__ModifyWatchlist）
- `tools/stock-analysis-tools.ts` — 股票分析工具（8个）
  - dogear__CalcIndicators：计算技术指标（MA/EMA/MACD/RSI/KDJ/BOLL/ATR 等）
  - dogear__ScreenStocks：全市场条件筛选（基本面/技术指标/公式，industry 需精确等值匹配东财板块名）
  - dogear__ListIndustries：列东方财富行业板块（keyword 过滤，返回 name 可直接喂给 dogear__ScreenStocks 的 industry）
  - dogear__GetFinancials：财务数据查询（营收/净利润/ROE 等）
  - dogear__CompareIndustry：行业内对比分析
  - dogear__DetectSignals：技术信号检测（MACD金叉/RSI超卖 等）
  - dogear__EvalFormula：执行用户自定义公式（screener/signal/score）
  - dogear__SimpleBacktest：简单策略回测
- `tools/stock-announcement-tools.ts` — 公司公告工具（dogear-stock-announcement server，需在设置页开启同名工具包）：dogear__ListAnnouncements 拉列表（返回 markdown，含 url/date/type/title）/ dogear__ReadAnnouncement 读全文（透传 url+code+market，命中缓存直返 markdown）；description 强调 URL 必须原样从 dogear__ListAnnouncements 结果里粘，超长公告 agent 自行判断分段
- `tools/digest-tools.ts` — 会话逐字稿清洗 MCP 工具（dogear-memory-digest server：只保留 dogear__CleanTranscript）
- `tools/group-digest-tools.ts` — 组卡 MCP 工具（dogear-group-digest server：dogear__ReadGroupDigest / dogear__SaveGroupDigest；dogear__SaveGroupDigest 自动用 dirtyConversations 合并 sourcesSeen，groupId 校验与任务 payload 一致，供 GROUP_DIGEST_SESSION agent 独占）
- `tools/group-tools.ts` — 会话组共享区 MCP 工具（dogear-group server：dogear__ListGroupFiles（列出+返回内容）/ dogear__SaveSharedNote；供 working agent 主动写 `_notes/` 阶段总结）
- `tools/reference-tools.ts` — 引用会话 / 组背景 MCP 工具（dogear-reference server，**只装到子会话**）：dogear__ReadReferenceSession 读任意 sessionId 的去噪原文（可尾切 / 区间切）/ dogear__ReadGroupBackground 读本组 background.md 结构化字段 / dogear__ListSiblingSessions 列组内兄弟会话；主 agent 靠 dogear__CreateSession 派子会话消化后回摘要，避免污染主上下文
- `tools/delegation-tools.ts` — Agent 协作 MCP 工具（dogear-delegation server）：
  - 主会话工具集：`dogear__CreateSession` / `dogear__CreateSessionBatch` / `dogear__SendMessage` / `dogear__WaitForMessage` / `dogear__ListLinkedSessions` / `dogear__ResumeSession` / `dogear__StopSession`
  - 子会话工具集：`dogear__SendMessage` / `dogear__WaitForMessage` / `dogear__ListLinkedSessions`（无 Create*/Resume/Stop，不能派孙子）
  - `dogear__SendMessage(toSessionId, message, options?)` — options.delivery=true 标记交付；工具层先过 `hasDirectContractChannel` 校验（仅直接派出关系）
  - `dogear__WaitForMessage(fromSessionIds[], timeoutMs?)` — 不按 delivery 过滤，取第一条到达消息返回；等待中子会话终态时会先收到结构化终态通知（死因 + 重试次数 + 降级轨迹）而非干等超时
  - `dogear__ResumeSession(sessionId)` — 调起中断/失败的子会话续跑（复用原会话消息历史不新建副本，走 bridge.resumeChild；重启后靠 loadChildStates 恢复的条目才能调起）；重试/quota 耗尽的终态通知文案会引导用它
  - 子会话交付 = `dogear__SendMessage(父sessionId, summary, { delivery: true })`，内部触发 bridge.markChildDelivered 同步 childStates 状态机与 UI 事件

- `tools/review-tools.ts` — 首页报告 MCP 工具（dogear-memory-review server：dogear__ListDigests / dogear__ReadDigest / dogear__TraceSource / dogear__ReadReport / dogear__WriteReport）；零分析逻辑，分流靠提示词。配合 dogear-memory 的 dogear__RecallMemory/dogear__SaveMemory/dogear__ForgetMemory 实现「记忆 + 报告」双层写入
- `tools/category-tools.ts` — 智能分类 MCP 工具（dogear-smart-category server：dogear__ListCategories 含样例组标题 / dogear__SaveCategoryJoin { categoryId, addAnchorTags? | replaceAnchorTags? } / dogear__SaveCategoryNew { name, anchorTags, redistribute? } 校验上限 / dogear__SaveCategoryMerge { fromIds (length=2), name, anchorTags } / dogear__PruneCategoryTags；三个 Save* 拆开是因为 GLM 等国内 Anthropic 兼容层不吃 discriminatedUnion 的 oneOf 和 tuple 的 prefixItems，全平台通吃；**单引用语义**：dogear__SaveCategoryJoin/dogear__SaveCategoryNew 先 removeGroupEverywhere 再加入，一个组只在一个分类；append 决策日志，入参和落库全用 groupId）

> 组提炼链路：触发已迁移到调度器（内置任务 group_digest / review 的默认触发器：03:00–05:00 窗口 / 应用启动 / 会话窗口关闭三触发点，见 `services/scheduler/`；停止 / 立即运行 / 整批重跑入口已收敛到定时计划，tipc digest.ts 路由保留供单组重跑与调度器复用）→ 内置任务 group_digest 调 group-digest-scanner 扫脏 → group-digest-trigger 串行起 GROUP_DIGEST_SESSION 任务，payload 携带 groupId + dirtyConversations[]（每条含 conversationId/sessionId/mtime）+ hasExistingCard（活动状态采集含 taskId，供整停链路取消当前任务；「会话摘要」设置 Tab 只 2s 轮询组卡列表）→ agent-worker.handleGroupDigestTask 走 pi `runOnce`（按 payload.modelSelection ?? settings.digestModelSelection ?? settings.defaultModelSelection 走 resolvePiModel，方案不完整即返回明确 error；接 AbortController，cancelGroupDigest → agent.abort() 真正中断）→ agent 自调 dogear__CleanTranscript（对 dirty 会话逐个去噪）+ dogear__ReadGroupDigest（拿上次组卡 summary/items/keyOutputs 增量参考）+ dogear__ListGroupFiles（拉 `_notes/` 阶段总结、子会话 dogear__SendMessage delivery 产出）+ dogear__SaveGroupDigest（新组卡覆写，工具自动合并 sourcesSeen）→ 组卡落 `<configDir>/workspaces/<wsId>/groups/<groupId>/digest.md`。**dogear__SaveGroupDigest 落盘前过 source-fidelity 校验**：items 里每个 `sessionId#uuid` 必须真实存在于去噪逐字稿，否则拒绝落盘并回告 agent 哪条错、错在哪（wrong_session 直接给出正确 sessionId）。子会话（role='sub'）不进 sourcesSeen，其贡献通过 dogear__SendMessage delivery 汇入父会话产出。

> 首页报告链路（历史代号 review）：脏检查（review-scanner.isReportStale：最新组卡 updatedAt > 报告 updatedAt）→ review-trigger 串行起 REVIEW_SESSION 任务 → agent-worker.handleReviewSessionTask 走 pi `runOnce`（同样按 reviewModelSelection 三级 fallback 走 resolvePiModel，可取消）→ agent 自调 review-tools（dogear__ListDigests/dogear__ReadDigest/dogear__TraceSource）+ memory-tools（dogear__RecallMemory/dogear__SaveMemory/dogear__ForgetMemory）做**分流**：沉淀/有价值结论/注意事项进**记忆**（详细全集），需用户主动处理的待办/中断/搁置的简述进**报告**；最终 dogear__WriteReport 落 `dashboard.md`。首页 Dashboard 用 MarkdownRenderer 渲染 dashboard.md 给用户看；dashboard-watcher 监听文件变化推事件到前端；普通会话里说"聊聊首页"也能触发同一 skill。

> 智能分类链路（按组）：group-digest-trigger 任务成功保存组卡后 → chainCategorize 检查 smartCategory.enabled + 组卡 tags 存在 → category-trigger.triggerCategorize(workspaceId, groupId, groupDigestPath) 串行起 CATEGORIZE_SESSION 任务 → agent-worker.handleCategorizeSessionTask：Step A 跑 matchByThreshold 阈值匹配（0 LLM），命中即 push 到对应分类记 'match'；无匹配则上 LLM（走 pi `runOnce`，按 categorizeModelSelection 三级 fallback 走 resolvePiModel，可取消）→ agent 自调 category-tools（dogear__ListCategories 看现有分类 + 样例组标题 / SaveCategory 决策 JOIN_EXISTING 或 NEW_CATEGORY，新建时附带 redistribute 候选迁移；入参用 groupId）→ smart-categories.json 落 `<configDir>/workspaces/<wsId>/`（category.groupIds[]）。outcome=match/join/new 时 broadcast categoriesUpdated，前端 useSmartCategoryStore 自动 reload。手动文件夹装 groupId（tree children 从 conversationId 改为 groupId），通过 conversations.ts 的 addGroupToFolder/removeGroupFromFolder/moveGroupBetweenFolders IPC 支持多引用。

> 模型选择链路：对话创建时 tipc 把 settings.ai.defaultModelSelection 浅拷贝到 conversation.modelSelection（fork 则继承父对话）→ ChatInputArea 输入框工具栏的 ModelSelector（按 Profile 分组、按 modelId 去重、空选时红字「请先选择模型」+ textarea/send 全 disable）→ 用户切换时 conversation-store.setConversationModelSelection 写库 + 同步顶层镜像 → useSendMessage 发送前 reconcile：null 拦截 toast、有变更则 client.setSessionModel(selection)；同 profile 换 tier 走 PiSession 快速路径，跨 profile 后端返回 needsRestart → triggerSessionRestart + 让用户重发；插话路径（pendingState!='idle'）跳过 reconcile 沿用会话原模型。usePendingState 派生 idle/running/flushing；StreamingIndicator flushing 态显示「队列还有 N 条插话待回复…」。

## 数据存储（`.dogear/` 目录）

- `settings.json` — 应用设置（ModelProfile、Thinking、permissionMode 等）
- `workspaces.json` — 工作区索引（id、名称、路径、默认标记）
- `conversations.json` — 对话索引（id、标题、`sessionId: string | null`——Harness 会话稳定标识、`workspaceId`、`groupId`/`role`、分叉信息、modelSelection、usageSummary）
- `delegation-state.json` — 子会话调度站状态持久化（全局单文件不分 workspace，`{version, children}` 每 child 一条：task/outputPath/status/sessionId/retryCount/modelTried 等；delegation-persist 锁内全量覆写；应用启动 loadChildStates 恢复——conversation 已删条目过滤、running 转 interrupted；done/终态条目长期保留不自动清理，条目数与子会话数一一对应不会重复增长）
- `plans.json` — 定时任务存储（`{version:2, tasks}` 容器，一行一任务：触发器含 lastFiredAt/once.fired，runState 仅 cursorStartedAt 断点；首次缺失 seed 内置四任务；读到旧数组格式自动按任务拆条迁移；scheduler/plan-store.ts 经 safe-json 原子写）
- `run-history/YYYY-MM.jsonl` — 计划运行历史（任务级条目 + missed 错过条目，按月分文件，保留 3 个月自动清理；scheduler/run-history-store.ts）
- `conversations/` — 旧 SDK 主会话历史（迁移归档后的只读备份，不再回放/恢复，仅归档说明引用；新会话历史见下方 `workspaces/{workspaceId}/sessions/`）
- `usage/{conversationId}.jsonl` — 会话 token 用量明细（每行一条 entry 或 compact marker，删除对话/工作区时联动清理）
- `workspaces/{workspaceId}/sessions/` — 主会话（及子会话）的 Harness JSONL 会话文件，`pi-session-repository.ts` 的 `JsonlSessionRepo` 按其 cwd 编码子目录 + 时间戳文件名布局管理；`conversations.json` 的 `sessionId` 字段指向这里，不保存绝对路径
- `workspaces/{workspaceId}/groups/{groupId}/digest.md` — 组级摘要卡（frontmatter 含 groupId/title/createdAt/updatedAt/sourcesSeen[] + 概述 + 想法/注意/决策条目带回溯 sessionId#uuid + keyOutputs + tags）
- `workspaces/{workspaceId}/groups/{groupId}/background.md` — 组背景（结构化 frontmatter：topic / progress / keyDecisions / openQuestions）
- `workspaces/{workspaceId}/digests/_archive/{sessionId}.md` — 迁移前旧的会话级摘要卡备份（旧 `digests/` 仅剩 _archive）
- `workspaces/{workspaceId}/dashboard.md` — 首页报告（frontmatter 仅 updatedAt + 给用户看的纯净 markdown 正文；记忆详细版另落 `<workspacePath>/.dogear/memory/`）
- `group-digest-prompt.md` — 组提炼提示词模板（全局单份，首次缺失自动播种，可编辑）
- `review-prompt.md` — 首页报告提示词模板（全局单份，首次缺失自动播种，可编辑）
- `categorize-prompt.md` — 智能分类提示词模板（全局单份，首次缺失自动播种，可编辑）
- `workspaces/{workspaceId}/smart-categories.json` — 智能分类索引（categories 列表，category.groupIds[]；recentDecisions 环形 20 条；schemaVersion=2 表示已迁移）
- `workspaces/{workspaceId}/groups/{groupId}/shared/` — 组共享区（working agent 用 group-tools 读写；`_notes/` 子目录放阶段总结供组提炼参考）
- `stocks/watchlist.json` — 自选股列表
- `stocks/formulas.json` — 用户公式存储（screener/signal/score 三种类型）
- `stocks/kline/{market}.{code}.jsonl` — K线历史数据（JSONL，每行一条 KLineDataPoint）
- `stocks/daily/{market}.{code}.jsonl` — 每日快照数据（JSONL，getQuote 时自动采集，按 tradeDate 去重）
- `stocks/announcements/{market}{code}/` — 公司公告懒缓存目录：`<hash>.pdf` 原始 PDF + `<hash>.md` 解析后 markdown + `index.json` 元数据（`[{url, title, type, date, hash, cachedAt}]`）；hash = `sha256(url).slice(0,16)`；只增不淘，需清理调 `clearAnnouncementCache(market, code)`
- `stocks/cninfo-org-map.json` — 巨潮 orgId 映射（首次调用批量抓 sse/szse/bj 三市股票映射表，之后离线查表；新上市股票找不到时懒重抓）

## 关键数据流

- **IPC 通信**：Renderer → tipc.invoke() → Main tipc handler → service（JSON 文件读写） → renderer events 回传
- **Agent 执行（主会话）**：Renderer → tipc.attachConversationRuntime → conversationRuntimeService → getPiSessionManager().createSession/retain → PiSession.start() → PiHarnessAdapter 驱动 AgentHarness → 工具调用（内建/MCP 工具包）→ message-converter 转 ExtendedSessionMessage → sessionMessage 等事件广播 → Renderer；`PARSE_ARTICLE` 后台任务仍走 Renderer → tipc.submitTask → agent-worker → query() SDK → MCP Tools → agentTaskUpdate → Renderer
- **工作区文件树**：workspace/getFiles → articleService.listArticleTree + workspaceFsService.scan → 合并返回
- **自选股行情**：Renderer → stock-store → tipc/stock → stockService（通过 RateLimiter 防护）→ 腾讯/东方财富/新浪 API → 返回解析后数据（getQuote 同时 fire-and-forget 写入每日快照 JSONL）
- **股票分析**：AI 调用分析工具 → TypeScript handler → Python Bridge → Python 计算层（指标/筛选/公式/回测）→ 返回结果给 AI
- **公司公告抓取**：Agent 调 dogear__ListAnnouncements → announcement-service 查/懒抓 orgId 映射 → POST 巨潮 `hisAnnouncement/query` → 返回列表 markdown；Agent 选一条调 dogear__ReadAnnouncement → 命中 `<hash>.md` 直返 / 未命中下载 PDF → python-bridge `parseAnnouncementPdf` (pdfplumber) → 组装 markdown → 写 `<hash>.md` + 追加 index.json → 返回 markdown
