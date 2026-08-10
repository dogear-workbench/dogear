---
name: codebase-map
description: 当你不清楚某个文件/模块在哪、要做什么时主动调用。包含 Dogear 项目的入口/页面/组件/Store/IPC 路由/服务层/Agent 框架/数据存储 的完整文件功能索引。
---

# Dogear 代码地图

> 核心文件功能索引。**不自动加载**——当 Agent 不清楚某个文件/模块在哪、要做什么时主动 Read。
> 项目 CLAUDE.md 末尾的「代码地图」章节会指向此文件。
> 简单的定位/改动建议直接用 Glob/Grep 探索当前代码状态，索引可能滞后于实际文件。

## 入口与路由（src/）

- `src/main.tsx` — Vite 入口，挂载 React 到 `#root`
- `src/App.tsx` — React Router 配置 + 设置 overlay + 全局 ConfirmDialog
- `src/globals.css` — Tailwind CSS 4 全局样式

## 页面（app/）

- `app/page.tsx` — 主工作区页面，三栏布局（对话列表 + AI助手 + 文件树/预览）
- `app/session-window/page.tsx` — 独立会话窗口（路由参数 `conversationId`，可折叠文件树 + 聊天 + 预览，独立渲染进程初始化）
- `app/settings/page.tsx` — 设置页面（全屏 overlay，纵向 Tab + 表单模式 + dirty 检测，含默认系统提示词编辑）
- `app/settings/PersonaTab.tsx` — 人设管理标签页（CRUD：左侧列表 + 右侧编辑表单，name/description/prompt）
- `app/settings/WorkspaceConfigTab.tsx` — 工作区配置标签页（只读展示 .claude 目录状态，CLAUDE.md 编辑器已迁移到 WorkspaceRuleDialog）
- `app/settings/WorkspaceManagementTab.tsx` — 工作区管理标签页（列表 + 删除 + 孤儿恢复 + 环境依赖检查，里程碑 1.5 Step A2.7）
- `app/settings/SubAgentTab.tsx` — 子会话派遣标签页（默认模型 / 权限模式 / 超时分钟数；写 `settings.subAgent`，单次派遣不可覆盖）
- `app/settings/SystemPromptPreviewTab.tsx` — 系统提示词只读预览面板，拉后端 getSystemPromptSegments 展示 6 段隐形系统契约（tool-pack-guide / group-context / reference-append / group-append / notes-guidance / sub-agent-contract），按 category 分组 + 类别徽章 + 动态徽章 + 触发条件说明 + 等宽模板正文
- `app/settings/memory/DigestsPanel.tsx` — 组卡设置面板（列组卡 + 详情视图 + 「组级提炼提示词」折叠编辑器接 group-digest-prompt / 活动状态 + 停止 / 单组「重新提炼」按钮走 triggerGroupDigest）
- `app/settings/memory/ReviewPanel.tsx` — 首页报告设置面板（提示词编辑 + 模型选择 + 触发/取消 + 活动状态）
- `app/settings/memory/SmartCategoryPanel.tsx` — 智能分类设置面板（挂在「会话摘要」Tab 末尾，Phase 3 已改按组）：文案强调「分类对象：会话组」/ 总开关 / 阈值 / 上限锁死 10 / 模型方案 + 档位 / 提示词折叠编辑器 / 立即重跑全部分类（confirm-store 二次确认）/ 活动状态 + 停止 / 当前分类列表（按 groupIds.length 计数）
- `app/settings/memory/TopicsPanel.tsx` — 工作区主题记忆面板（列表 + 编辑器，接 memory-service）
- `app/settings/memory/CoreProfilePanel.tsx` — 核心画像面板
- `app/stocks/page.tsx` — 自选股行情页面，双栏布局（自选股列表 + 个股详情）
- `app/agent-monitor/page.tsx` — Agent Worker 池状态监控仪表板
- `app/debug/page.tsx` — 开发调试窗口，集成 AgentChat 测试

## 业务组件（components/）

- `agent-chat/` — AI 聊天模块（从原 AgentChat.tsx 拆分，~20 文件）
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
  - `LineageBar.tsx` — 溯源条：当前对话 contractMetadata 存在（agent 派出）时顶部显示「由 [派出者标题] 派出：[task]」，点击跳转派出者会话；派出者已删除时显示灰色占位（替代旧的 SubAgentBanner）
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
- `PromptSidebar.tsx` — 对话人设选择面板（人设列表单选、临时提示词、保存并重启会话、链接到设置页人设管理）
- `ConversationList.tsx` — 对话列表主骨架（Phase 3 改：三态 Tab 手动|智能|时间 + 归档段）
- `conversation-list/` — 对话列表子组件（Phase 14 拆分；Phase 3 全面按组渲染）
  - `ConversationRow.tsx` — 通用会话行（所有 section 共用，含 nodeId 必填 / 双层高亮 useNodeHighlight / 编辑/引用/删除 hover 按钮；agent 派出会话（contractMetadata.createdBy='agent'）显示 Bot 图标 + task tooltip；文件夹相关 ContextMenu 已上移到 GroupCard）
  - `ManualSection.tsx` — 手动文件夹区（headless-tree 仅在此用；children[__root__] 里的 folderId 节点及其子树，叶子渲染 GroupCard 装 groupId）
  - `SmartSection.tsx` — 智能分类视图（按 groupIds.length 倒序，空分类隐藏，渲染 GroupCard；useSmartCategoryStore.load 同步）
  - `TimeSection.tsx` — 时间视图（按 group.updatedAt 分桶，30 天内 + 更早；< 5 天扣到 RecentVirtualGroup 不重复）
  - `RecentVirtualGroup.tsx` — ⚡ 近期 < 5 天虚拟分组，按 group.updatedAt，smart/time 都显示
  - `ArchiveSection.tsx` — 内联可折叠归档段，懒加载 listArchivedConversations（仍按 conversation 归档）
  - `ViewTabs.tsx` — 三态切换（manual|smart|time），local state 不持久化
  - `Toolbar.tsx` — 顶部"新建对话"按钮（"新建文件夹"按钮在 ManualSection 内）
  - `AppearanceBadge.tsx` — ⟂N 角标（count≥5 变橙；用于组标题）
  - `AddGroupToFolderMenu.tsx` — 组级：多选 ContextMenuCheckboxItem 子菜单，调 addGroupToFolder
  - `MoveGroupToFolderMenu.tsx` — 组级：单选子菜单，调 moveGroupBetweenFolders
  - `utils.ts` — getRelativeTime / getConversationTitle / RECENT_THRESHOLD_MS / TIME_BUCKET_THRESHOLD_MS / CONV_TREE_ROOT / openOrFocusConversation（统一 selectConversation + openTab 入口，接 nodeId 设 lastFocusedNodeId）/ useNodeHighlight（isOpen 淡色 + isSelected 深色）/ useAppearanceCount（按 groupId 计数手动文件夹数 + 智能分类数）
- `group-list/` — 组级 UI 组件（Phase 3）
  - `GroupCard.tsx` — 组卡片（组标题 + AppearanceBadge + 展开/收起会话行；agent 派出会话平摊到组内，用 sortConversationsWithDFS 让子会话紧跟派出者；无 folderId 时显 AddGroupToFolderMenu / 有 folderId 时显 MoveGroupToFolderMenu + 从文件夹移除 + 删除组走 confirm-store 二次确认）
  - `utils.ts` — 组 helpers（deriveGroupTitle 等）
- `WorkspaceSwitcherPopover.tsx` — 顶部导航栏工作区切换器（选择/添加，里程碑 1.5 Step A2.4）
- `WelcomeFirstRun.tsx` — 零工作区首次启动引导卡片（里程碑 1.5 Step A2.4）
- `WorkspaceRuleDialog.tsx` — 工作区规则 Dialog（.claude/CLAUDE.md 编辑器，里程碑 1.5 Step A2.6）
- `EmptyFocusState.tsx` — 无聚焦对话时的占位（里程碑 1.5 Step A2.5）
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
- `conversation-store.ts` — 对话状态：对话列表、选中对话、分叉参数、编辑重发、人设关联（updateConversationPersona）、对话级模型（setConversationModelSelection）、会话重启触发（sessionRestartTrigger）；loadConversations 并行拉 conversations + tree + groups 后一次写完并同步 group-store；三个 folder actions 已改名（addGroupToFolder / moveGroupBetweenFolders / removeGroupFromFolder）；`runningConversationIds` / `pendingActionConversationIds` 两个 Set 唯一订阅源是后端 `sessionStateChanged` / `sessionClosed`（Step 3 起废弃旧 `conversationRunningStateChanged` 前端订阅，删除所有乐观直写以避免双源 race）
- `group-store.ts` — 会话组状态：groups[] + selectedGroupId + loadGroups / createGroup / updateGroup / deleteGroup / setSelectedGroupId
- `reference-store.ts` — 引用状态：引用文章列表、引用片段（用户选中文字）
- `slash-command-store.ts` — 斜杠命令状态：SDK + 自定义命令合并、capabilities 更新
- `settings-store.ts` — 应用设置：加载/保存/重启会话（整体 save 模式）
- `ui-store.ts` — UI 状态：设置 overlay 开关、右侧面板折叠（rightPanelOpen）
- `confirm-store.ts` — 全局确认弹窗：confirm() 返回 Promise，showConfirm() 简化版
- `stock-store.ts` — 自选股状态：watchlist/quotes/K线/分时/资金流向/搜索/RateLimiter 状态
- `dashboard-store.ts` — 首页工作台状态：reportMarkdown/reportUpdatedAt（首页报告）+ notesContent（速记板）+ reviewActivity 轮询 + triggerReview/loadReport/loadNotes/flushNotes actions
- `session-store.ts` — 多会话标签页：tabs[] + activeTabId + sessionWindowIds + lastFocusedNodeId（UI 状态：对话列表节点双层高亮区分"被点击的那一处" vs "已打开的同会话其他节点"）；导出 `HOME_TAB_ID` 哨兵（非真实会话）表示首页 tab，activeTabId 初始/关末 tab 后回退到该哨兵；`SessionTab` 无 `isStreaming` 字段（Step 3 删除，运行态一律读 `conversation-store.runningConversationIds`）
- `smart-category-store.ts` — 智能分类前端：categories / activity / load / triggerFullRebuild / cancel / refreshActivity / reset；模块加载时订阅 categoriesUpdated 事件自动 reload（dynamic import @/lib/events 避免 SSR 爆）

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
- `settings.ts` — ModelTier / ModelSelection / Persona / ModelProfile / AppSettings（含 defaultModelSelection 与 digest/review/categorizeModelSelection 各自独立；含 `subAgent = { modelSelection?, timeoutMinutes, cachePolicy?, loadCoreProfile?, loadSkills?, loadArticleParse? }` 子会话派遣默认配置；根级 `basicToolPermissions` 七工具映射；`ai.permissionMode` 为 `default | autoExecute` 两态；`ai.effort` 控制推理努力程度）/ DEFAULT_SETTINGS
- `agents.ts` — TaskStatus / TaskType / AgentTask / ForkParams
- `electron-api.ts` — Workspace / WorkspaceFileNode / ExtendedSessionMessage / Citation / Conversation（含 persona_id/temp_prompt/modelSelection/contractMetadata — 后者记录 agent 派出溯源：createdBy / parentSessionId / task）
- `delegation.ts` — Agent 协作契约数据模型（ContractMetadata / ChildSessionState / 契约通道消息类型）
- `stock.ts` — WatchlistItem / StockQuote / KLineDataPoint / TimelinePoint / MoneyFlowPoint / StockSearchResult / DailySnapshot / QUOTE_FIELD_MAP / RateLimiterStatus / Announcement / AnnouncementType / ListAnnouncementsOpts / AnnouncementDetail / CachedAnnouncementEntry
- `usage.ts` — 会话用量数据模型（ConversationUsageEntry / CompactMarker / ContextSnapshot / ConversationUsage / UsageJsonlLine），主进程镜像在 `electron/main/types.ts`
- `system-prompt.ts` — SystemPromptSegment（key/label/category/template/triggerDescription/isDynamic），主进程镜像在 `electron/main/types.ts`
- `smart-category.ts` — 智能分类数据模型（DigestTags / SmartCategory { groupIds[] } / CategorizeDecisionLog { groupId } / SmartCategoriesIndex / CategorizeActivity / CategorizeRecentEntry），主进程镜像在 `electron/main/types.ts`
- `electron.d.ts` — window.ipcRenderer 全局类型声明

## IPC 路由（electron/main/tipc/）

- `index.ts` — 路由注册中枢，聚合所有子路由
- `agent.ts` — Agent 会话管理（RPC：创建/发送/关闭会话、权限控制）
- `ai.ts` — 通用 AI 接口（chat / summarize，占位实现）
- `article.ts` — 网络文章管理（抓取解析、列表、详情、删除）
- `conversations.ts` — 对话 CRUD + 分叉 + 人设关联（JSON 存储）
- `workspace.ts` — 工作区管理（列表、默认、文件夹选择、文件树）
- `file.ts` — 文件操作（打开文件位置）
- `explorer.ts` — 工作区文件树操作（创建/重命名/移动/复制/删除）
- `stock.ts` — 自选股行情 + 分析（12+RPC：自选股CRUD、批量行情、单股行情+自动快照、K线、分时、资金流向、每日快照查询、搜索、限流状态 + 指标计算、筛选、财务、回测等）
- `usage.ts` — 会话用量查询（getUsage：懒重算 usageSummary 后读 JSONL）
- `digest.ts` — 组卡巡检（listGroupDigests / readGroupDigest / triggerGroupDigestScan 全工作区扫脏 / triggerGroupDigest 单组重跑 / getGroupDigestActivity 活动轮询 / get+setGroupDigestPrompt 提示词读写 / cancelGroupDigest 单任务取消 / cancelAllGroupDigest 一键停（清队列+取消当前）/ get+setDigestModelSelection 沿用旧的 settings.ai.digestModelSelection 配置项）
- `review.ts` — 首页报告（历史代号 review）：getReport 读 `dashboard.md` / triggerReview 触发生成 / getReviewActivity 活动轮询 / get+setReviewPrompt 提示词 / get+setReviewModelSelection 整体模型选择 / cancelReview 取消
- `category.ts` — 智能分类：getCategories（含归档过滤，按 groupIds 存活性过滤）/ triggerCategorize { workspaceId, groupId, groupDigestPath } / triggerFullRebuild / cancelCategorize（无参全局单队列）/ getCategorizeActivity / get+setCategorizePrompt / get+setCategorizeModelSelection 整体模型选择 / get+setSmartCategorySettings（enabled/threshold/maxCategories，后端 clamp）；conversations.ts 也加了 addGroupToFolder / removeGroupFromFolder / moveGroupBetweenFolders 三个 IPC 支持手动文件夹装 groupId + 多引用，以及 setConversationModelSelection 单独写对话级模型
- `agent.ts` — Agent 会话管理，路由统一查 `getPiSessionManager()`（Step 6 移除 SDK 主会话分流后）：setSessionModel（接收 ModelSelection，返回 `{ ok:true; needsRestart? } | { ok:false; error }`；同 profile 换 tier 走 PiSession 快速路径，跨 profile 由前端触发会话重启）；`closeQueryBasedSession` = release 语义（refCount-1，归零即销毁），`forceCloseQueryBasedSession` = 强杀（`/clear` 走这条立刻销毁避免后台弹卡片）；路由名保留旧字样是历史兼容，内部实现已纯 pi
- `system-prompt.ts` — 系统提示词模板查询（getSystemPromptSegments，返回 `{ segments } | { error }`，供设置页只读预览用户看不见的系统级 append 段）
- `renderer-handlers.ts` — main→renderer 事件定义（分析更新、会话消息、权限请求、usageEntryAdded、categoriesUpdated、pendingCountChanged、sessionStateChanged / sessionClosed 跑步机状态原子事件 等）

## 业务服务（electron/main/services/）

- `conversation-service.ts` — 对话索引 CRUD + 人设关联 + 对话级模型选择（`.dogear/conversations.json`），含 personaId/tempPrompt/modelSelection 字段；create() 时由 tipc 注入 settings.ai.defaultModelSelection 浅拷贝，createFork() 继承父对话 modelSelection；updateModelSelection 单独维护；含 usageSummary（applyUsageSummary 增量、recomputeUsageSummaryIfStale 懒重算）
- `usage/` — 会话 token 用量采集与存储
  - `usage-extractor.ts` — 从 SDK result 提取 ConversationUsageEntry 纯函数（含 MODEL_CONTEXT_WINDOWS 兜底表、modelUsage 缺失合成、工具/子代理聚合）
  - `usage-service.ts` — 用量 JSONL 读写删（`.dogear/usage/{conversationId}.jsonl`，appendEntry/appendCompactMarker/appendContext/readUsage/deleteUsage）
- `memory/` — 会话清洗 + 组级提炼闭环（Phase 3 已改为「组」粒度）
  - `session-paths.ts` — 会话路径解析共享 util（getClaudeConfigDir / getSdkSessionsDir / getSessionJsonlPath）：服务 PARSE_ARTICLE 及 `agent.ts` 的 `getSubAgentHistory`/`getSdkSessions`（子代理历史文件路径），与主会话 pi-session/ 的 Harness 会话路径（`pi-session-repository.ts` 的 `getSessionsRoot`）是两套不同的存储位置
  - `transcript-cleaner.ts` — 会话 JSONL 确定性去噪（cleanTranscriptFromLines 纯函数 + cleanTranscript IO，剥工具结果/系统行/思考块，保留用户+助手文字与一行工具骨架，~20x 压缩）
  - `group-digest-store.ts` — 组卡读写（GroupDigestCard 序列化/解析 + sourcesSeen 合并 + readGroupDigest/saveGroupDigest/listGroupDigests/deleteGroupDigest；Phase 4 起落 `<configDir>/workspaces/<wsId>/groups/<groupId>/digest.md`；导出 getGroupDir 供组内其它文件复用）
  - `group-digest-prompt.ts` — 组提炼提示词模板（DEFAULT_GROUP_DIGEST_PROMPT + loadGroupDigestPrompt 播种 `<configDir>/group-digest-prompt.md` + saveGroupDigestPrompt；设置页可编辑）
  - `group-digest-scanner.ts` — 组卡脏判定（isGroupDirty 纯函数按「新会话加入 / 会话 mtime 增长 / 会话被移出」三条件；findDirtyGroups / scanDirtyByGroup / scanDirtyByConversation；子会话 role='sub' 被过滤）。`findDirtyGroup(..., force)` 的 force=true 跳过脏判定并返回全量 main 会话，只给设置页手动「重新提炼」用
  - `source-fidelity.ts` — 组卡引用保真度校验：`buildSessionUuidIndex(workspacePath, sessionIds)` 复用 `cleanMessagesFromLines` 建「sessionId → 去噪后 uuid 集合」索引（每会话只读一次，缺文件映射为 null）；`validateItemSources` 纯函数逐条查，分三种问题——uuid_not_found（编造）/ wrong_session（张冠李戴，回告正确 sessionId）/ session_missing。**校验口径必须与 agent 所见一致**，所以复用同一个去噪函数而非 JSONL 全量 uuid
  - `group-digest-trigger.ts` — 组提炼编排（串行队列并发=1 + in-flight 去重；triggerGroupDigestScan / triggerGroupDigestByGroup / triggerGroupDigestByConversation；提交 GROUP_DIGEST_SESSION 任务）+ 活动采集（current/queueDepth/recent 环形 / lastScan）+ recent/lastScan 持久化到 `<configDir>/digest-activity.json`（sync load + debounce 500ms save）+ cancelAllGroupDigest 一键停 + 成功后 chainCategorize
  - `migration-p3.ts` — 启动幂等迁移（app.whenReady 之后一次跑完）：① 旧 `<sessionId>.md` → `<groupId>.md` 1:1 重命名并落 sourcesSeen；② smart-categories.json 的 conversationIds → groupIds；③ conversation-tree.json 的 children 从 conversationId → groupId + schemaVersion=2；旧产物落 `_archive/`，二次执行检测已迁移即跳过
  - `notes-store.ts` — 组共享区 `_notes/` 目录读写（列出/读取，供组提炼 agent 优先利用 working agent 的阶段总结）
  - `background-store.ts` — 组背景 background.md（Phase 4）：结构化 frontmatter（topic / progress / keyDecisions / openQuestions），落 `<wsData>/groups/<groupId>/background.md`，供组内新会话派子会话查阅
  - `migration-gate.ts` — 启动闸门（Phase 4）：whenMigrationReady() 阻塞组提炼 / 分类 trigger，直到 markMigrationComplete() 被调用
  - `migration-p4.ts` — Phase 4 幂等迁移：组卡从 `<wsData>/digests/<groupId>.md` 迁到 `<wsData>/groups/<groupId>/digest.md`，删除 `digests/_cleaned/`（不再留盘干净逐字稿）
  - `dashboard-watcher.ts` — dashboard.md 文件监听（chokidar，变更时向前端广播 dashboardChanged 事件，触发 dashboard-store 重新拉取）
  - `review-store.ts` — 首页报告存储：ReportDoc { updatedAt, markdown } 落 `<configDir>/workspaces/<wsId>/dashboard.md`
  - `review-scanner.ts` — 报告脏检查：isReportStale 纯函数（最新组卡 updatedAt vs 报告 updatedAt）
  - `review-prompt.ts` — 报告提示词模板（引导 agent 分流为「记忆 SaveMemory + 报告 WriteReport」，读组卡驱动）
  - `review-skill-service.ts` — `<configDir>/skills/review/SKILL.md` 初始化，供普通会话「聊聊首页」交互式触发
  - `review-trigger.ts` — 报告生成编排（串行队列 + in-flight 去重；triggerReview 提交 REVIEW_SESSION 任务）+ 活动采集
  - `smart-category-store.ts` — 智能分类索引读写（`<configDir>/workspaces/<wsId>/smart-categories.json`）+ 纯函数 helpers（pushGroup / removeGroupEverywhere / appendDecision 环形 20 条 / newCategory）
  - `smart-category-engine.ts` — 决策纯函数：matchByThreshold（Step A 阈值匹配，0 LLM）+ pickRedistributeCandidates（Step C 邻近候选召回）+ normalizeTag/normalizeTags（标签归一化）
  - `categorize-prompt.ts` — 分类提示词模板（DEFAULT_CATEGORIZE_PROMPT + loadCategorizePrompt 播种 `<configDir>/categorize-prompt.md` + saveCategorizePrompt）
  - `category-trigger.ts` — 分类编排（串行队列并发=1 + in-flight 去重；triggerCategorize(workspaceId, groupId, groupDigestPath) 单条 / triggerFullRebuild 工作区全量 / cancelCurrent 取消正在跑的任务）+ 活动采集 + outcome=match/join/new 时广播 categoriesUpdated
  - 注：里程碑1 的工作区主题记忆（memory-service / memory-recall / memory-fs / memory-indexer / memory-loader / memory-types）也在此目录
- `conversation-runtime-service.ts` — 会话运行时管理（多附件绑定 desktop/wechat-bot、会话快照、复用 session）
- `contract-channel-service.ts` — 契约通道校验（hasDirectContractChannel：只认直接派出关系，A 派 B 派 C 时 A 无法直连 C；SendMessage / StopSession 工具层前置校验）
- `group-service.ts` — 会话组 CRUD（`.dogear/groups/{workspaceId}.json`）：listGroups / getGroup / createGroup / updateGroup / deleteGroup
- `group-shared-service.ts` — 组共享区文件读写（`.dogear/workspaces/{wsId}/groups/{groupId}/shared/`），供 group-tools 和前端 SharedAreaPanel 使用
- `conversation-tree-service.ts` — 手动文件夹树（`.dogear/workspaces/{wsId}/conversation-tree.json`）：Phase 3 起 children 装 groupId（schemaVersion=2）；listFolders / addGroupToFolder / removeGroupFromFolder / moveGroupBetweenFolders / initializeTree
- `workspace-json-service.ts` — 工作区 JSON 存储（`.dogear/workspaces.json`）
- `settings-service.ts` — 应用设置 JSON 存储（`.dogear/settings.json`，含 permissionMode、personas、basicToolPermissions；导出 normalizeSettings 做幂等历史设置迁移与结构修复，清理遗留 SDK 字段）
- `ai-service.ts` — AI 接口占位（chat / summarize）
- `article-service.ts` — 网络文章抓取（V2：平台脚本优先 + Readability 兜底 + AI 失败才介入），微信公众号特殊处理
- `article-parser-skills-service.ts` — 网络文章解析 Skills 和 MCP 工具定义（新增）
- `workspace-service.ts` — 获取当前默认工作区（thin wrapper）
- `workspace-fs-service.ts` — 文件树扫描和文件系统操作（安全路径验证）
- `safe-json.ts` — 安全 JSON 存储（原子写入+备份+互斥锁），防止数据丢失
- `stock/` — 自选股行情服务模块
  - `rate-limiter.ts` — 请求防御体系（令牌桶 + 滑动窗口 + 断路器 + 请求合并 + 内存缓存）
  - `stock-service.ts` — 三数据源 API 封装（腾讯行情/分时 + 东方财富K线/搜索 + 新浪K线备用，7个方法）
  - `stock-watchlist-service.ts` — 自选股 JSON 存储（`.dogear/stocks/watchlist.json`）
  - `stock-data-service.ts` — K线 + 每日快照 JSONL 增量存储（`.dogear/stocks/kline/` + `.dogear/stocks/daily/`）
  - `python-bridge.ts` — Python 守护进程通信（JSON-RPC，stdin/stdout）（新增）
  - `formula-service.ts` — 公式 CRUD 存储（`.dogear/stocks/formulas.json`）（新增）
  - `announcement-service.ts` — 公司公告服务（巨潮资讯网）：`listAnnouncements(code, market?, opts?)` 走 orgId 映射 + `hisAnnouncement/query`；`readAnnouncement(url, code, market, meta?)` 命中 `<hash>.md` 直读 / 未命中下载 PDF → python-bridge `parseAnnouncementPdf` 解析 → 写盘 + index.json；PDF 30MB 双层拦截（content-length + 流式计数），只放行 `static.cninfo.com.cn` 防 SSRF；`clearAnnouncementCache(market, code)` 手动清缓存；共享 rateLimiter 令牌桶
  - `index.ts` — barrel export

## Agent 框架（electron/main/agents/）

- `agent-manager.ts` — Worker 线程池管理器，任务队列调度，空闲 Worker 60s 自动回收
- `agent-worker.ts` — Worker 线程执行器。**两个运行时并存**：四条后台一次性任务（GROUP_DIGEST / REVIEW / CATEGORIZE / CATEGORIZE_ORGANIZE）走 pi（`pi/run-once.ts`）；`PARSE_ARTICLE`（`:395`）仍走 Claude Agent SDK——依赖 SDK 的 plugins skill 发现机制，pi 无对应物；主会话已完整迁移到下方 `pi-session/`，不再经过 agent-worker
- `pi/provider.ts` — pi 运行时的 provider 层：`resolvePiModel(appSettings, selection, subAgentFallback, fallback)` 按 profileId 解析出 `{ model, profile }`（`Model.id` 必须是真实模型 id，不是 profile/tier 组合）；`buildPiModels(profile)` 造 anthropic-messages 客户端。目前只跑 anthropic 格式，`apiFormat` 是二期的纯增量
- `pi/run-once.ts` — pi 的一次性任务执行器：`runOnce({ systemPrompt, prompt, tools, model, profile, signal, maxTurns=30, onLog })`。**不抛出**，失败以 `{ ok:false, error, cancelled? }` 返回。pi 的 loop 故意没有轮次上限，这里在 `subscribe` 里数 `turn_start` 超限调 `agent.abort()`；`tool_execution_end` 带 `isError` 时以 `[tool-error]` 前缀走 onLog（四个 handler 都按该前缀落 WARN 级日志）
- `pi/tool-adapter.ts` — 运行时中立的工具定义层：`defineTool` / `ToolDef` / `toSdkServer`（给 SDK）/ `toPiTools`（给 pi，走 `z.toJSONSchema()`）。工具 handler 一律沿用 `isError: true` 约定，`toPiTools` 负责在 pi 侧翻转成 `throw`。pi 侧工具名是裸名，不带 `mcp__server__` 前缀
- `pi-session/` — **主会话（及其派遣的子会话）运行时门面**，基于 pi-agent-core 的 AgentHarness，旧 SDK 主会话实现（`query-based-session.ts`）已随迁移完成整体移除：
  - `pi-session.ts` — `PiSession`（EventEmitter）：唯一门面类，`start()` 组装 systemPrompt/工具集/权限映射并创建 `PiHarnessAdapter`，`sendMessage`/`steer`/`interrupt`/`close`/`setPermissionMode`/`respondPermissionRequest` 覆盖完整生命周期、插话、权限确认、usage 采集
  - `pi-session-manager.ts` — `PiSessionManager`（单例 `getPiSessionManager()`）：conversation-runtime-service 唯一入口，引用计数式生命周期（`retain`/`release` 归零即销毁，无跑步机保活），`bindConversation` 维护 conversationId↔sessionId 映射，订阅 PiSession 事件转发到渲染层
  - `pi-session-repository.ts` — `PiSessionRepository`（单例）：按 workspaceId 缓存 `JsonlSessionRepo` 实例，封装 `create`/`open`/`delete`/`fork`/`getSessionPath`，session 根目录固定 `<configDir>/workspaces/<workspaceId>/sessions/`
  - `pi-harness-adapter.ts` — `PiHarnessAdapter`：构造 `AgentHarness` 并做事件订阅分发，暴露 `prompt`/`steer`/`abort`，是 pi-session.ts 与 Harness 裸类型之间的唯一隔离层（Harness 类型不得外泄）
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
- `session-append-templates.ts` — 系统级 append 段模板集中处（REFERENCE_APPEND / groupAppendFor / NOTES_GUIDANCE_APPEND / subAgentContractFor），buildSystemPrompt 直接引用；末尾 getSystemPromptSegments() 收集 6 段模板 + 触发条件说明供设置页只读预览
- `agent-query-config.ts` — 共享的 SDK `query()` 配置构建器 + 设置读取入口（无 electron 依赖，Worker 线程内安全导入）：两类调用方共用——`PARSE_ARTICLE` 用它构建真正的 SDK query() 配置（主会话已迁移到 pi-session/，不再依赖本文件）；`GROUP_DIGEST`/`REVIEW`/`CATEGORIZE`/`CATEGORIZE_ORGANIZE` 四条 pi 后台任务只借用 `buildQueryBaseConfig` 读取 `appSettings`，再喂给 `pi/provider.ts` 的 `resolvePiModel`，本身不发起 SDK query()
- `task-types.ts` — 任务类型（SUMMARIZE/PARSE_ARTICLE/GROUP_DIGEST_SESSION/REVIEW_SESSION/CATEGORIZE_SESSION）和消息定义（含 ExtendedSessionMessage、各 Payload 源定义；GroupDigest/Review/CategorizeSessionPayload 用统一 modelSelection?: ModelSelection 字段；GroupDigestSessionPayload 携带 groupId + dirtyConversations[] + hasExistingCard）
- `logger.ts` — 日志工具（mainLogger / workerLogger / createTaskLogger）
- `tools/tool-registry.ts` — 工具注册表（SDK 内置工具 + 自定义工具注册，IPC 查询供设置页/代理编辑页动态加载）
- `tools/article-tools.ts` — 文章阅读工具（ReadArticle / ListArticles）
- `tools/stock-tools.ts` — 自选股工具（SearchStock / GetStockQuote / GetKLineData / GetTimeline / GetWatchlist / ModifyWatchlist）
- `tools/stock-analysis-tools.ts` — 股票分析工具（8个）
  - CalcIndicators：计算技术指标（MA/EMA/MACD/RSI/KDJ/BOLL/ATR 等）
  - ScreenStocks：全市场条件筛选（基本面/技术指标/公式，industry 需精确等值匹配东财板块名）
  - ListIndustries：列东方财富行业板块（keyword 过滤，返回 name 可直接喂给 ScreenStocks 的 industry）
  - GetFinancials：财务数据查询（营收/净利润/ROE 等）
  - CompareIndustry：行业内对比分析
  - DetectSignals：技术信号检测（MACD金叉/RSI超卖 等）
  - EvalFormula：执行用户自定义公式（screener/signal/score）
  - SimpleBacktest：简单策略回测
- `tools/stock-announcement-tools.ts` — 公司公告工具（dogear-stock-announcement server，需在设置页开启同名工具包）：ListAnnouncements 拉列表（返回 markdown，含 url/date/type/title）/ ReadAnnouncement 读全文（透传 url+code+market，命中缓存直返 markdown）；description 强调 URL 必须原样从 ListAnnouncements 结果里粘，超长公告 agent 自行判断分段
- `tools/digest-tools.ts` — 会话逐字稿清洗 MCP 工具（dogear-memory-digest server：只保留 CleanTranscript；旧 ReadExistingDigest/SaveDigest 已被 group-digest-tools 替代）
- `tools/group-digest-tools.ts` — 组卡 MCP 工具（dogear-group-digest server：ReadGroupDigest / SaveGroupDigest；SaveGroupDigest 自动用 dirtyConversations 合并 sourcesSeen，groupId 校验与任务 payload 一致，供 GROUP_DIGEST_SESSION agent 独占）
- `tools/group-tools.ts` — 会话组共享区 MCP 工具（dogear-group server：ListGroupFiles / ReadGroupFile / WriteGroupFile；供 working agent 主动写 `_notes/` 阶段总结）
- `tools/reference-tools.ts` — 引用会话 / 组背景 MCP 工具（dogear-reference server，**只装到子会话**）：ReadReferenceSession 读任意 sessionId 的去噪原文（可尾切 / 区间切）/ ReadGroupBackground 读本组 background.md 结构化字段 / ListSiblingSessions 列组内兄弟会话；主 agent 靠 CreateSession 派子会话消化后回摘要，避免污染主上下文
- `tools/delegation-tools.ts` — Agent 协作 MCP 工具（dogear-delegation server，Step 2 重构，方案 A 单 server + 工具子集控制防孙子）：
  - 主会话工具集：`CreateSession` / `CreateSessionBatch` / `SendMessage` / `WaitForMessage` / `ListLinkedSessions` / `StopSession`
  - 子会话工具集：`SendMessage` / `WaitForMessage` / `ListLinkedSessions`（无 Create*/Stop，不能派孙子）
  - `SendMessage(toSessionId, message, options?)` — options.delivery=true 标记交付；工具层先过 `hasDirectContractChannel` 校验（仅直接派出关系）
  - `WaitForMessage(fromSessionIds[], timeoutMs?)` — 不按 delivery 过滤，取第一条到达消息返回
  - 子会话交付 = `SendMessage(父sessionId, summary, { delivery: true })`，内部触发 bridge.markChildDelivered 同步 childStates 状态机与 UI 事件
  - 原 `dogear-sub-agent` server 已删除（SubmitDelivery/AskParent 语义合并进 SendMessage）
- `tools/review-tools.ts` — 首页报告 MCP 工具（dogear-memory-review server：ListDigests / ReadDigest / TraceSource / ReadReport / WriteReport）；零分析逻辑，分流靠提示词。配合 dogear-memory 的 RecallMemory/SaveMemory/ForgetMemory 实现「记忆 + 报告」双层写入
- `tools/category-tools.ts` — 智能分类 MCP 工具（dogear-smart-category server：ListCategories 含样例组标题 / SaveCategoryJoin { categoryId, addAnchorTags? | replaceAnchorTags? } / SaveCategoryNew { name, anchorTags, redistribute? } 校验上限 / SaveCategoryMerge { fromIds (length=2), name, anchorTags } / PruneCategoryTags；三个 Save* 拆开是因为 GLM 等国内 Anthropic 兼容层不吃 discriminatedUnion 的 oneOf 和 tuple 的 prefixItems，全平台通吃；append 决策日志，入参和落库全用 groupId）

> 组提炼链路（Phase 3）：脏检查（group-digest-scanner）三触发点（启动扫/夜间03点/关会话）→ group-digest-trigger 串行起 GROUP_DIGEST_SESSION 任务，payload 携带 groupId + dirtyConversations[]（每条含 conversationId/sessionId/mtime）+ hasExistingCard（采集活动状态含 taskId 供「会话摘要」设置 Tab 轮询 + 停止）→ agent-worker.handleGroupDigestTask 走 pi `runOnce`（按 payload.modelSelection ?? settings.digestModelSelection ?? settings.defaultModelSelection 走 resolvePiModel，方案不完整即返回明确 error；接 AbortController，cancelGroupDigest → agent.abort() 真正中断）→ agent 自调 CleanTranscript（对 dirty 会话逐个去噪）+ ReadGroupDigest（拿上次组卡 summary/items/keyOutputs 增量参考）+ ListGroupFiles/ReadGroupFile（拉 `_notes/` 阶段总结、子会话 SendMessage delivery 产出）+ SaveGroupDigest（新组卡覆写，工具自动合并 sourcesSeen）→ 组卡落 `<configDir>/workspaces/<wsId>/groups/<groupId>/digest.md`（Phase 4 路径）。**SaveGroupDigest 落盘前过 source-fidelity 校验**：items 里每个 `sessionId#uuid` 必须真实存在于去噪逐字稿，否则拒绝落盘并回告 agent 哪条错、错在哪（wrong_session 直接给出正确 sessionId）。子会话（role='sub'）不进 sourcesSeen，其贡献通过 SendMessage delivery 汇入父会话产出。

> 首页报告链路（历史代号 review）：脏检查（review-scanner.isReportStale：最新组卡 updatedAt > 报告 updatedAt）→ review-trigger 串行起 REVIEW_SESSION 任务 → agent-worker.handleReviewSessionTask 走 pi `runOnce`（同样按 reviewModelSelection 三级 fallback 走 resolvePiModel，可取消）→ agent 自调 review-tools（ListDigests/ReadDigest/TraceSource）+ memory-tools（RecallMemory/SaveMemory/ForgetMemory）做**分流**：沉淀/有价值结论/注意事项进**记忆**（详细全集），需用户主动处理的待办/中断/搁置的简述进**报告**；最终 WriteReport 落 `dashboard.md`。首页 Dashboard 用 MarkdownRenderer 渲染 dashboard.md 给用户看；dashboard-watcher 监听文件变化推事件到前端；普通会话里说"聊聊首页"也能触发同一 skill。

> 智能分类链路（Phase 3 改按组）：group-digest-trigger 任务成功保存组卡后 → chainCategorize 检查 smartCategory.enabled + 组卡 tags 存在 → category-trigger.triggerCategorize(workspaceId, groupId, groupDigestPath) 串行起 CATEGORIZE_SESSION 任务 → agent-worker.handleCategorizeSessionTask：Step A 跑 matchByThreshold 阈值匹配（0 LLM），命中即 push 到对应分类记 'match'；无匹配则上 LLM（走 pi `runOnce`，按 categorizeModelSelection 三级 fallback 走 resolvePiModel，可取消）→ agent 自调 category-tools（ListCategories 看现有分类 + 样例组标题 / SaveCategory 决策 JOIN_EXISTING 或 NEW_CATEGORY，新建时附带 redistribute 候选迁移；入参用 groupId）→ smart-categories.json 落 `<configDir>/workspaces/<wsId>/`（category.groupIds[]）。outcome=match/join/new 时 broadcast categoriesUpdated，前端 useSmartCategoryStore 自动 reload。手动文件夹装 groupId（Phase 3 迁移后 tree children 从 conversationId 改为 groupId），通过 conversations.ts 的 addGroupToFolder/removeGroupFromFolder/moveGroupBetweenFolders IPC 支持多引用。

> 模型选择链路（Phase 4-5 重构）：对话创建时 tipc 把 settings.ai.defaultModelSelection 浅拷贝到 conversation.modelSelection（fork 则继承父对话）→ ChatInputArea 输入框工具栏的 ModelSelector（按 Profile 分组、按 modelId 去重、空选时红字「请先选择模型」+ textarea/send 全 disable）→ 用户切换时 conversation-store.setConversationModelSelection 写库 + 同步顶层镜像 → useSendMessage 发送前 reconcile：null 拦截 toast、有变更则 client.setSessionModel(selection)；同 profile 换 tier 走 PiSession 快速路径，跨 profile 后端返回 needsRestart → triggerSessionRestart + 让用户重发；插话路径（pendingState!='idle'）跳过 reconcile 沿用会话原模型。usePendingState 派生 idle/running/flushing；StreamingIndicator flushing 态显示「队列还有 N 条插话待回复…」。

## 数据存储（`.dogear/` 目录）

- `settings.json` — 应用设置（ModelProfile、Thinking、permissionMode 等）
- `workspaces.json` — 工作区索引（id、名称、路径、默认标记）
- `conversations.json` — 对话索引（id、标题、`sessionId: string | null`——Harness 会话稳定标识、`workspaceId`、`groupId`/`role`、分叉信息、personaId、tempPrompt、modelSelection、usageSummary；`sdkSessionId` 为迁移前遗留字段，主会话移除后恒为空，仅供归档溯源）
- `conversations/` — 旧 SDK 主会话历史（迁移归档后的只读备份，不再回放/恢复，仅归档说明引用；新会话历史见下方 `workspaces/{workspaceId}/sessions/`）
- `usage/{conversationId}.jsonl` — 会话 token 用量明细（每行一条 entry 或 compact marker，删除对话/工作区时联动清理）
- `workspaces/{workspaceId}/sessions/` — 主会话（及子会话）的 Harness JSONL 会话文件，`pi-session-repository.ts` 的 `JsonlSessionRepo` 按其 cwd 编码子目录 + 时间戳文件名布局管理；`conversations.json` 的 `sessionId` 字段指向这里，不保存绝对路径
- `workspaces/{workspaceId}/groups/{groupId}/digest.md` — 组级摘要卡（Phase 4 迁移后路径；frontmatter 含 groupId/title/createdAt/updatedAt/sourcesSeen[] + 概述 + 想法/注意/决策条目带回溯 sessionId#uuid + keyOutputs + tags）
- `workspaces/{workspaceId}/groups/{groupId}/background.md` — 组背景（结构化 frontmatter：topic / progress / keyDecisions / openQuestions）
- `workspaces/{workspaceId}/digests/_archive/{sessionId}.md` — 迁移前旧的会话级摘要卡备份（migration-p3 落，Phase 4 后旧 `digests/` 仅剩 _archive）
- `workspaces/{workspaceId}/dashboard.md` — 首页报告（frontmatter 仅 updatedAt + 给用户看的纯净 markdown 正文；记忆详细版另落 `<workspacePath>/.dogear/memory/`）
- `group-digest-prompt.md` — 组提炼提示词模板（全局单份，首次缺失自动播种，可编辑；Phase 3 起替代旧 `digest-prompt.md`）
- `review-prompt.md` — 首页报告提示词模板（全局单份，首次缺失自动播种，可编辑）
- `categorize-prompt.md` — 智能分类提示词模板（全局单份，首次缺失自动播种，可编辑）
- `workspaces/{workspaceId}/smart-categories.json` — 智能分类索引（categories 列表，category.groupIds[]；recentDecisions 环形 20 条；schemaVersion=2 表示已迁移）
- `workspaces/{workspaceId}/groups/{groupId}/shared/` — 组共享区（working agent 用 group-tools 读写；`_notes/` 子目录放阶段总结供组提炼参考）
- `stocks/watchlist.json` — 自选股列表
- `stocks/formulas.json` — 用户公式存储（screener/signal/score 三种类型）（新增）
- `stocks/kline/{market}.{code}.jsonl` — K线历史数据（JSONL，每行一条 KLineDataPoint）
- `stocks/daily/{market}.{code}.jsonl` — 每日快照数据（JSONL，getQuote 时自动采集，按 tradeDate 去重）
- `stocks/announcements/{market}{code}/` — 公司公告懒缓存目录：`<hash>.pdf` 原始 PDF + `<hash>.md` 解析后 markdown + `index.json` 元数据（`[{url, title, type, date, hash, cachedAt}]`）；hash = `sha256(url).slice(0,16)`；只增不淘，需清理调 `clearAnnouncementCache(market, code)`
- `stocks/cninfo-org-map.json` — 巨潮 orgId 映射（首次调用批量抓 sse/szse/bj 三市股票映射表，之后离线查表；新上市股票找不到时懒重抓）

## 关键数据流

- **IPC 通信**：Renderer → tipc.invoke() → Main tipc handler → service（JSON 文件读写） → renderer events 回传
- **Agent 执行（主会话）**：Renderer → tipc.attachConversationRuntime → conversationRuntimeService → getPiSessionManager().createSession/retain → PiSession.start() → PiHarnessAdapter 驱动 AgentHarness → 工具调用（内建/MCP 工具包）→ message-converter 转 ExtendedSessionMessage → sessionMessage 等事件广播 → Renderer；`PARSE_ARTICLE` 后台任务仍走 Renderer → tipc.submitTask → agent-worker → query() SDK → MCP Tools → agentTaskUpdate → Renderer
- **工作区文件树**：workspace/getFiles → articleService.listArticleTree + workspaceFsService.scan → 合并返回
- **自选股行情**：Renderer → stock-store → tipc/stock → stockService（通过 RateLimiter 防护）→ 腾讯/东方财富/新浪 API → 返回解析后数据（getQuote 同时 fire-and-forget 写入每日快照 JSONL）
- **股票分析**（新增）：AI 调用分析工具 → TypeScript handler → Python Bridge → Python 计算层（指标/筛选/公式/回测）→ 返回结果给 AI
- **公司公告抓取**：Agent 调 ListAnnouncements → announcement-service 查/懒抓 orgId 映射 → POST 巨潮 `hisAnnouncement/query` → 返回列表 markdown；Agent 选一条调 ReadAnnouncement → 命中 `<hash>.md` 直返 / 未命中下载 PDF → python-bridge `parseAnnouncementPdf` (pdfplumber) → 组装 markdown → 写 `<hash>.md` + 追加 index.json → 返回 markdown
