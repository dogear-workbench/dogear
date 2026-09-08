# Dogear 代码地图

> 核心文件功能索引。由 `codebase-map` skill 按需 Read，由 `doc-sync` skill 在代码变更后同步。 简单的定位/改动建议直接用 Glob/Grep 探索当前代码状态，索引可能滞后于实际文件。

## 入口与路由（src/）

- `src/main.tsx` — Vite 入口，挂载 React 到 `#root`，顶层挂载 setupManualTaskToasts / setupSettingsSync（动态 import 避免非主窗口加载副作用）
- `src/App.tsx` — React Router 配置（HashRouter 路由：`/` 主工作区、`/session-window/:id` 独立会话窗口、`/data-center` 数据中心独立窗口、`/workbench-window` 伴随工作台独立窗口、`/stocks` 自选股、`/wechat`、`/debug`）+ 设置全屏 overlay（ui-store settingsOpen 时 fixed inset-0 z-50 渲染 SettingsPage，底层页面不卸载）+ 全局 ConfirmDialog + Toaster
- `src/globals.css` — Tailwind CSS 4 全局样式

## 渲染层 Hooks（hooks/）

- `hooks/use-visible-polling.ts` — `useVisiblePolling(fn, intervalMs)`：数据中心统一轮询钩子，挂载且可见立即执行一次并起 interval；visibilitychange 隐藏停、恢复可见立即拉一次对齐；fn 用 ref 转发（变化不重置计时）；调用方自行处理 props 变化的立即刷新（参考 digests-panel 的 loadList effect）

## 页面（app/）

- `app/page.tsx` — 主工作区页面，三栏布局（对话列表 + AI助手 + 伴随面板）；TitleBar 自绘标题栏显示「Dogear」；header 数据中心按钮 openDataCenterTab（可开关 tab）；内容区常驻挂载 NotesPanel（固定 tab）+ DataCenterPage（dataCenterTabOpen 时挂载）+ 会话 tabs，按 activeTabId 切 display；哨兵 tab（笔记/数据中心）下 CompanionPanel 不渲染
- `app/session-window/page.tsx` — 独立会话窗口（路由参数 `conversationId`，可折叠文件树 + 聊天 + 预览，独立渲染进程初始化；selectConversation 成功后上报全局焦点 setFocusedConversation，伴随工作台跟随）
- `app/workbench-window/page.tsx` — 伴随工作台独立窗口（WorkbenchWindowPage，主进程单例 BrowserWindow 路由 `#/workbench-window`）：初始化链路 getDefault → setWorkspace(skipSetDefault)，默认跟随模式（不 pin 死）；订阅主进程 `focusedConversationChanged` 广播 + 冷启动 getFocusedConversation 拉取全局焦点会话（RPC 响应仅无值时生效防回退），锚点 `focusedConv?.conversationId ?? conversations[0].id`；焦点属于其他工作区时 setWorkspace(skipSetDefault) 整窗跟随切换；渲染 `<CompanionPanel full terminalAnchor=锚点>`，topic tab 的 groupId 与终端跟随锚点同源
- `app/settings/page.tsx` — 设置页（主窗口全屏 overlay 形态：返回按钮/关闭均调 handleClose，不 dirty 直接 closeSettings、dirty 弹三按钮 confirm 后关 overlay；顶栏保存/取消/保存并重启会话；保存联动走 updateSettings → broadcastSettingsChanged → setup-settings-sync，同窗口自收自发）；布局为顶部下划线式 TabsList（variant=underline）+ TabsContent 内层滚动，内容容器 max-w-* mx-auto 居中；纯设置 tab：基础设置 / 能力 / 模型方案 / 工作区管理 / 子会话派遣 / 关于（原记忆/摘要/定时/用量/解析历史 tab 已迁数据中心）；基础设置 tab 内含「受控浏览器」小节（代理地址 browserProxyServer 输入 + 默认引擎 browserSearchEngine 下拉 + 浏览器扩展状态行 ExtensionStatusLine，授权域名 chip 只读展示）
- `app/settings/ExtensionStatusLine.tsx` — 浏览器扩展状态行（挂载 client.getExtensionStatus() 查询 + extensionStatusChanged 订阅收即渲染：未连接引导文案 / ✅ 已连接·当前标签页 / extractError 灰字「该页面内容无法读取」/ textPreview 正文预览 / connected 态授权域名只读 chip 列表 + 「撤销请在扩展弹窗中操作」旁注）；ExtensionStatus 类型唯一源 browser-gateway.ts，渲染层 import type 自动流转
- `app/settings/AbilityTab.tsx` — 能力标签页编排层：workspaceId 本地 state（挂载时 getAll + getDefault，default 不在列表选第一个，零工作区 null；设置 overlay 无 workspace-store 初始化链路，不依赖 store）+ 工作区 Select；按能力域分块单视图（无视图切换）；数据加载分流、applySkillToggles 统一开关（单 skill / 域整体：开 = skills ∪ 关联工具包，关 = 按剩余已启用 skill 保留共享包，一次 updateWorkspaceConfig 提交）、包徽标跳转定位（展开目标域 + 包，highlightServer scrollIntoView + 2s ring 高亮）；容器 max-w-[1600px] 自适应 + 域块网格 xl:grid-cols-2（多包域全宽）；挂 SkillDetailDialog / ToolDetailDialog / SegmentDetailDialog 三个弹窗
- `app/settings/AbilityDomainCard.tsx` — 可选能力域块组件：域头（统计 + skill 数 >1 时显示整体开关）+ 展开后左右分区（md:grid-cols-2 对半：左 skill 控制层 / 右工具包折叠列表，包无独立开关、状态随 skill 联动）；无工具包域 skill 走网格（sm:grid-cols-2 xl:grid-cols-3）；PackPanel 折叠头 data-server 定位
- `app/settings/AbilityResidentSection.tsx` — 常驻能力块：默认收起统计行，展开后提示词段列表（只读）+ 常驻工具组折叠列表（只读）两栏
- `app/settings/ability-types.ts` — 能力页共享类型与常量：ToolInfo/ToolGroup/ToolPack/SkillSource/SkillEntry/SkillTemplate/Domain* 类型、SKILL_PACK_MAP（skill → 关联工具包）、RESIDENT_GROUPS（4 常驻 server + 中文 label + 注入条件）、SKILL_SOURCE_LABELS、ABILITY_DOMAINS（股票/文章/代码工作流三域硬编码）+ CUSTOM/GENERIC 兜底域 + buildDomainViews（templates/skills/packs/config → 域视图数组，未归类模板进通用域）
- `app/settings/WorkspaceManagementTab.tsx` — 工作区管理标签页（列表 + 删除 + 孤儿恢复 + 环境依赖检查）
- `app/settings/SubAgentTab.tsx` — 子会话派遣标签页（Profile 列表管理：非 default Profile 行内启用 Switch，停用后 agent 侧不可见不可派遣、行置灰加「已停用」徽标；ProfileEditor 编辑名称/模型/超时/基础工具/能力域/Skill（能力域含 extension 开关「浏览器扩展（dogear-extension 扩展工具包：真实浏览器已连接标签页，仅限已授权域名）」，countAbilityDomains 计入）；skill 列表按挂载时本地解析的工作区拉取——getAll + getDefault、default null 时选第一个、零工作区传 null——不依赖 workspace-store）
- `app/settings/pi-model-row.tsx` — 模型清单行组件 `PiModelRow`：ID 行内编辑（空/与同清单重复回退标红）、窗口徽标点击手填（`parseContextInput` 解析 1M/200K/262144 写法，清空恢复查表，手动角标）、显示名与删除
- `app/data-center/` — 数据中心（主窗口固定 tab 常驻挂载，tab 上 hover 可弹独立窗口；顶部下划线式 tab 导航 6 面板；workspaces 由 page.tsx 加载一次下传，各 panel 只自持 `workspaceId: 'all' | id` 筛选状态不读 workspace-store；轮询统一走 useVisiblePolling；设置加载由页面 loadSettings 负责）：
  - `page.tsx` — 骨架：顶部 TabsList variant=underline（组卡/用量/定时计划/执行历史/解析历史/记忆）；TabsContent 统一 `flex-1 overflow-hidden` + 内层滚动层；scheduler tab 加 forceMount（编辑页草稿切 tab 不丢，代价是跨 tab 轮询持续）
  - `history-panel.tsx` — 执行历史一级面板（挂载即 loadTasks + loadHistory；任务/状态筛选 shadcn Select、状态纯前端过滤；refreshActivity 10s 可见轮询；分钟 tick 刷新中/待跑时间）
  - `digests-panel.tsx` — 组卡查看面板（列表 + 详情 + 单组重新提炼；2s 可见轮询；「全部」模式行内显示工作区名；选中态记 groupId+workspaceId 双键）
  - `usage-panel.tsx` — 用量面板（时间分页今日/7天/30天/全部；'all' 时不传 workspaceId 走后端聚合；'all' 会话列表前端逐工作区拉取合并；全部模式会话行显示工作区名 Badge）
  - `scheduler/` — 定时计划组件目录（自设置页整体迁入，文件名不变）：
    - `SchedulerPanel.tsx` — 任务列表与编辑态切换（收 workspaces props、workspaceId 内置；activity 10s 轮询走 useVisiblePolling；editing 非 null 时整面板渲染 TaskEditorPage；列表态滚动层 + max-w 容器自带）
    - `TaskEditorPage.tsx` — 任务编辑页面内二级页（面包屑工具栏 + 左列名称/大提示词区 + 右列 w-80 参数卡片（模型/工作区/工具/触发器）；builtin 分支左列 BuiltinPromptSection、custom 分支大 textarea；validateDraft 预校验 + 重叠 showConfirm；返回直接丢草稿）
    - `BuiltinTaskDetailSection.tsx` — 内置任务两导出：BuiltinPromptSection（提示词模板读写，保存独立于页面保存）+ BuiltinParamsSection（模型选择即写盘 + 只读工具清单）
    - `CustomToolPacksSection.tsx` — 自定义任务工具包区（生效集 = toolPacksOverride ?? 工作区启用集）
    - `TriggerListEditor.tsx` — 触发器编辑（摘要行列表 + DropdownMenu 分「时间规则/条件事件」两组添加，新条目展开态插入，单条展开）
    - `TriggerRow.tsx` — 单条触发器摘要行（类型图标 + describeTrigger + 删除）+ Collapsible 展开态「标签在上、控件在下」小表单（含月日全宽网格、on_task_done shadcn Select）
    - `TriggerControls.tsx` — 触发器编辑共享控件（inputCls / MONTH_GRID / WeekdayChips / PresetChips / Field）
    - `utils.ts` — describeTrigger、formatRelativeFuture、周几 chips、datetime-local 双向转换、WorkspaceOption
  - `history-utils.ts` / `HistoryEntryCard.tsx` — 执行历史格式化与条目卡片（history-panel 使用，随迁至 data-center 根）
  - `parse-history-panel.tsx` — 文章解析历史面板（全局 history.jsonl，手动刷新，无轮询）
  - `memory-section.tsx` — 记忆 tab 容器（收 workspaces props、筛选内置；'all' 时空态也渲染标题行 + 筛选；头部重建索引按钮 rebuildMemoryIndex；内层三节 Tabs）
  - `core-profile-panel.tsx` — 核心画像编辑面板（workspacePath props）
  - `topics-panel.tsx` / `topics-list.tsx` / `topic-editor.tsx` / `memory-types.ts` — 主题记忆列表 + 编辑器（workspacePath props，slug 校验/覆盖确认/删除二次确认）
  - `smart-category-panel.tsx` — 智能分类配置（workspaceId props；总开关/阈值/上限锁死/分类列表折叠刷新/全量重置 showConfirm；categoriesUpdated 广播自动 reload）
- `app/stocks/page.tsx` — 自选股行情页面，双栏布局（自选股列表 + 个股详情）
- `app/debug/page.tsx` — 开发调试窗口，集成 AgentChat 测试

## 业务组件（components/）

- `agent-chat/` — AI 聊天模块（\~20 文件）
  - `AgentChat.tsx` — 主组件（\~250行），组合 hooks + 布局 + 右侧工具轨道 + Minimap 集成
  - `ChatInputArea.tsx` — 输入区域（引用芯片、图片预览、textarea、工具栏、斜杠命令菜单、运行中暂停按钮：调 pauseQueryBasedSession，受理到 paused 广播间显示「暂停中…」；状态行 paused 徽标「已暂停 · 发送消息继续」，paused 态输入框正常可用、发送即恢复）
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
  - `LineageBar.tsx` 已删除（子会话归属信息收敛到左侧列表树形层级，AgentChat 不再渲染溯源条）
  - `highlight.ts` — 搜索高亮工具（mark 黄底 + active 橙底 ring）
  - `path-link.tsx` — 工作区路径胶囊基础设施：splitPathSegments/resolvePathInWorkspace 纯函数（白名单扩展名 + resolve 后区内才可点，前缀 lowercase 比较）、PathChip 可点胶囊（点击 markdown-preview-store.open 弹浮窗）、PathText 路径切分增强（仅工具块内使用，正文已不识别）、useWorkspacePath（焦点工作区响应式取 + 否则 client.getAll 缓存）
  - `workspace-id-context.tsx` — 会话所属工作区 Context（AgentChat 顶层包 Provider，tool-renderers/ToolBlock 子树消费；无 Provider 时自动降级纯文本）
  - `minimap-utils.ts` — 消息预览提取工具函数
  - `transformers.ts` — 消息转换工具（streamReducer 消费主进程事件流，含 message_id 终化）
  - `task-aggregator.ts` — Task\* CRUD 聚合纯函数（aggregateTasks），把分散的 TaskCreate/TaskUpdate 合成当前任务清单，由 AgentChat 渲染期派生吸附渲染
  - `types.ts` — 类型定义（Message、ContentBlock，含 isMeta/isCompactBoundary 等字段）
  - `utils.ts` — 工具函数（getUserMessageSearchableText 等）
  - `hooks/` — 自定义 hooks（11 个）
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
    - `usePendingState.ts` — 纯函数 derivePendingState({ isRunning, pendingCount }) → 'idle' | 'running' | 'flushing'
  - `tool-renderers/` — 工具块专属渲染器（由 ToolBlock 路由分发）
    - `ToolDetailShell.tsx` — 统一展开容器（ToolSection / KeyValueList / OutputBox），bg-card+border 替代 bg-muted/20，主内容用 text-foreground
    - `ReadRenderer.tsx` — Read 工具：文件路径头 + 等宽内容块
    - `GlobRenderer.tsx` — Glob 工具：pattern 徽章 + 匹配文件路径列表
    - `GrepRenderer.tsx` — Grep 工具：pattern 徽章 + 命中行 + 关键词高亮
    - `SkillRenderer.tsx` — Skill 工具：lucide Zap 琥珀色图标 + Skill 名 + 参数 + 输出
    - `FileChangeRenderer.tsx` — Write/Edit 工具：pi(path/edits[]) 与旧 SDK(file_path/old_string) 双兼容，write 内容区，edit PathChip 读盘 + 红/绿 diff 区（快照预览入口已上移至 ToolBlock 标题行）；导出 formatByteSize/getEditCount 供 ToolBlock 摘要复用（替代已删除的 CodeChangeBlock）
  - `usage-badge/` — 会话 token 用量监控（输入框工具栏徽章 + Popover 详情）
    - `UsageBadge.tsx` — 徽章本体：上下文进度条 + token 文字（只显示上下文占用，费用口径收在弹层），点击弹 UsagePopoverContent
    - `UsagePopoverContent.tsx` — 弹层主容器：头部上下文占用 / 会话累计消耗（计费口径合计 in+out+缓存读，对齐用量页，附轮次·模型调用次数·缓存命中率·四格分层）/ 当前轮逐模型分桶（轮次序号自然语言「第 N 轮」，turnIndex+1）/ 每轮明细 Collapsible（复用 components/usage/TurnDetailList）/ 末尾工具 chips 紧凑行
    - `UsageSummaryHeader.tsx` — 弹层头部：当前上下文占用与上限百分比
    - `UsageByTool.tsx` — 按工具次数聚合（紧凑 chips 流式排布，默认 8 个+展开剩余）
    - `useConversationUsage.ts` — hook：getUsage 拉取 + usageEntryAdded 订阅刷新 + 从 latestContext 派生上下文占用/上限
    - `usage-utils.ts` — 派生纯函数（resolveContext/ContextInfo/formatTokens/cacheHitRate），含单测
- `ToolBlock.tsx` — 工具块路由组件（顶层 components/，normalizeToolName 归一后分发到专属 renderer：Read/Glob/Grep/Skill/Write/Edit（FileChangeRenderer），其余走 ToolDetailShell；图标走 lucide 简约样式，无边框包裹；getToolSummary 摘要兼容 file_path/path 双入参；标题行 headerActions Eye 预览按钮（buildPreviewAction：Read(.md/.txt/.json)/Write(.md)/Skill/dogear__ListGroupFiles(relPath) 走 openInline 快照，Edit 读盘，仅 success 且非 error 显示，span+stopPropagation 规避嵌套 button）
- `WorkspaceExplorer.tsx` — 工作区文件树（@headless-tree/react），拖放/重命名/删除/新建；文章分区头带「导入文章」入口（Globe 按钮 + 内联 URL 输入框 + 空态引导）
- `AdditionalFilesPanel.tsx` — 右侧「附加」tab：附加路径手风琴列表（文件夹分节行样式与文件树一致，行尾 Switch 启停 + hover 删除，展开后文件树占满面板，可多节同时展开）
- `TopicPanel.tsx` — 右侧「话题」tab（原 SharedAreaPanel 升级）：话题组三段折叠面板——话题背景（readGroupBackground 结构化内嵌：主题/进展/已拍板决策/待议问题）+ 组卡提炼（摘要 line-clamp 预览，点击 readGroupDigestRaw 拿原文走 MarkdownFileDialog 浮窗）+ 共享文件列表（md 点击 openInline 浮窗，非 md 提示去资源管理器看；引用/删除按钮 hover 显示）；订阅 groupDataChanged（共享区写点/背景/组卡落盘广播）匹配当前组重拉三份数据
- `companion/` — 右侧伴随面板模块（组件只依赖 store + tipc client，无主窗口特有上下文，可被 workbench-window 独立窗口复用）
  - `CompanionPanel.tsx` — 四 tab 容器（文件/附加/话题/终端）：props `{ workspaceId, groupId, terminalAnchor?, full? }`（terminalAnchor 终端跟随锚点，工作台窗口传全局焦点会话 id，缺省用主窗口 activeTabId），full=true 独立窗口模式（占满容器、无拖拽把手、忽略折叠与宽度记忆）；面板模式宽度 localStorage 记忆 key `companion-width:{tab}`（240~720 clamp，拖拽结束才写）、左缘拖拽把手、折叠由 ui-store.rightPanelOpen 控制；tab 分发 WorkspaceExplorer / AdditionalFilesPanel / TopicPanel / TerminalPanel，tab 状态 ui-store.rightPanelTab（每渲染进程独立实例，主窗口与工作台窗口互不影响）
  - `TerminalPanel.tsx` — 终端面板（props `{ terminalAnchor? }` 窗口级跟随锚点，缺省回退主窗口 activeTabId；跟随锚点/固定目标/跟随态标题三处统一走 windowAnchor，标题与 pin 目标有效性用 conversations 查找）：头部 h-9 固定/跟随切换（terminal-store followMode/pinnedConversationId）+ 固定态 shadcn Select 会话下拉（选项=conversation-store conversations）；身体 active 存在渲染 `<XtermTerminal key={terminalId}>` 否则空态；挂载时 ensureTerminals() 恢复实例清单，terminals/锚点变化时 reconcileActive() 修剪失效 active（回退链：会话最新→我的最新→null）；底部子 tab 栏左「我的」shell 右「会话」终端（command 短名 + 运行中 Loader/退出 exit N 灰化），tab hover × killTerminal，最右 + openUserShell
  - `XtermTerminal.tsx` — xterm 宿主组件（props `{ terminalId }`）：模块级 entryCache 永不 dispose，tab 切换 attach/detach（自持 host div 搬家，Terminal.open() 只调一次）；挂载 getPtyBuffer 灌历史后接实时流（sink 先注册，历史未返回期数据进 pending 队列灌完 flush 防乱序）；onData→ptyWrite（exited 拦截），ResizeObserver→fit→尺寸变化才 ptyResize；ptyExit 后底部终态条
- `ArticlePreview.tsx` — 网络文章内容预览，选中文字浮动引用按钮（主窗口文章 tab + 独立会话窗口右栏双挂载；引用锚定走 requireReferenceAnchorId，主窗口引用后切回目标会话）
- `ConversationList.tsx` — 对话列表主骨架（单一滚动视图：手动文件夹 → 近期 → 智能分类 + 归档 Popover 浮窗）
- `conversation-list/` — 对话列表子组件（拆分；按组渲染）
  - `ConversationRow.tsx` — 通用会话行（所有 section 共用，含 nodeId 必填 / 双层高亮 useNodeHighlight / expandToggle 可选展开箭头（agent 子会话折叠区）/ 操作按钮 absolute 右侧浮层（渐变背景叠在文字上，opacity-0+pointer-events-none 防隐形误触，编辑态隐藏）；agent 派出会话显示 Network 图标；文件夹相关 ContextMenu 已上移到 GroupCard）
  - `ManualSection.tsx` — 手动文件夹区（无「手动分组」总标题，文件夹平铺；headless-tree 仅在此用；children\[**root**\] 里的 folderId 节点及其子树，叶子渲染 GroupCard 装 groupId；订阅 section-collapse-store.folderReveal 展开祖先文件夹链）
  - `SmartSection.tsx` — 智能分类视图（默认折叠，展开状态在 section-collapse-store；按 groupIds.length 倒序，空分类隐藏，渲染 GroupCard；useSmartCategoryStore.load 同步）
  - `RecentVirtualGroup.tsx` — ⚡ 近期 &lt; 7 天虚拟分组（默认展开到话题卡，折叠状态在 section-collapse-store），按 group.updatedAt；阈值 RECENT_THRESHOLD_MS 在 group-store，文案由 RECENT_DAYS 派生
  - `ArchiveSection.tsx` — 归档段 Popover 浮窗（向上弹出，ScrollArea max-h-80 限高），懒加载 listArchivedConversations
  - `Toolbar.tsx` — 顶部"新建对话"按钮（"新建文件夹"按钮在 ManualSection 内）
  - `AddGroupToFolderMenu.tsx` — 组级：多选 ContextMenuCheckboxItem 子菜单，调 addGroupToFolder
  - `MoveGroupToFolderMenu.tsx` — 组级：单选子菜单，调 moveGroupBetweenFolders
  - `utils.ts` — getRelativeTime / getConversationTitle / RECENT_THRESHOLD_MS / CONV_TREE_ROOT / openOrFocusConversation（统一 selectConversation + openTab 入口，接 nodeId 设 lastFocusedNodeId）/ useNodeHighlight（isOpen 淡色 = 会话已开 tab；isSelected 深色 = 当前活动 tab 的会话，随 switchTab/关 tab 回退自动跟随；独立窗口会话无 tab 退回 lastFocusedNodeId 点击处高亮）
- `group-list/` — 组级 UI 组件
  - `GroupCard.tsx` — 组卡片（组标题 + 展开树形会话行：接 buildConversationTree 树，主会话行带 expandToggle 箭头、子会话默认折叠（section-collapse-store.subExpandedConvIds）、递归支持多层派遣链；头部 +/··· 按钮为 absolute 浮层；无 folderId 时显 AddGroupToFolderMenu / 有 folderId 时显 MoveGroupToFolderMenu + 从文件夹移除 + 删除组走 confirm-store 二次确认）
  - `utils.ts` — 组 helpers（deriveGroupTitle：group.title 直读，无 title 返回"未命名话题"）
- `WorkspaceSwitcherPopover.tsx` — 顶部导航栏工作区切换器（选择/添加）
- `WelcomeFirstRun.tsx` — 零工作区首次启动引导卡片
- `WorkspaceRuleDialog.tsx` — 工作区规则 Dialog（agent.md 编辑器）
- `EmptyFocusState.tsx` — 无聚焦对话时的占位
- `MarkdownRenderer.tsx` — Markdown 渲染器，GFM + 代码高亮；p/li 文本仅搜索高亮（highlightText，不再做正文路径识别：agent 提到的路径可能未落盘，可点胶囊只保留在工具块内）；传 workspacePath 开启路径链接时可选 baseDir 作相对链接解析基准（如 plan 文档所在目录），正文裸路径始终以 workspacePath 为基准
- `ModelSelector.tsx` — 通用模型选择下拉（按 Profile 分组、按 modelId 去重、可选「不指定」、inline/block 两种触发器）
- `ConfirmDialog.tsx` — 全局确认弹窗（基于 shadcn AlertDialog，由 confirm-store 驱动）
- `StatusPulse.tsx` — 状态脉冲指示器（蓝色=等待确认，橙色=运行中），支持 sm/md 两种尺寸
- `TitleBar.tsx` — 全窗口统一自绘标题栏：fixed 顶部 env(titlebar-area-height) 高度、pointer-events-none 点击穿透到全局 drag 层、左侧窗口名称 truncate、右侧 pr-32 避让 OS overlay 三键；z-9998 低于 #root::before drag 层（9999）
- `dashboard/` — 已删除（首页 tab 下线：报告并入笔记面板 report mode，捕捉盒移除）
- `notes/` — 笔记卡片模块（固定「笔记」tab 内容，数据见 services/notes/；四 mode 顶栏：笔记/任务/回收站/报告）
  - `NotesPanel.tsx` — 编排容器：四 mode 顶栏（笔记|任务|回收站|报告，任务 mode 保留 review 数徽章 + 通知深链切 mode）+ 搜索框按 mode 分域（报告 mode 不渲染；笔记走 searchNotes 300ms 防抖 + seq 竞态保护，query+tag 叠加；任务/回收站传 query 给对应面板前端过滤，不发 IPC）+ 笔记 mode 专属 # 标签下拉（TagFilterMenu）与选中标签 chip（可单独点掉）+ 右侧「新建卡片」仅笔记 mode；时间流独占笔记列表区；switchMode 切换清空搜索状态；Ctrl+\ 列表显隐（笔记 aside 与任务 TaskPanel 共用）
  - `ReportSection.tsx` — 报告 mode 内容（从 dashboard/ 移入）：自载 loadReport（挂载时 setCurrentWorkspace + loadReport）+ MarkdownRenderer 渲染 `dashboard.md` 正文 + 空态引导设置→会话摘要
  - `NotesTimelinePane.tsx` — 笔记 mode 内容区：时间流 aside（300px 可隐藏）+ 拖拽分隔线（双击切换）+ NoteEditor 详情区；搜索过滤结果（filter/filterResults props）与全量列表双分支渲染；handleDelete（showConfirm 轻确认 → deleteNote → 详情卡联动关闭）与 handleReference（referenceNoteIntoFocus）收口在此
  - `NoteEditor.tsx` — 卡片详情编辑：标题剥离（正文首个 ATX 标题行拆为独立标题输入）+ 元数据区 NoteMetaSection（标签 chips + article:/stock:/plan: 三前缀链接）+ TiptapEditor 正文；header 删除按钮（onDelete 回调交父层处理）；800ms 防抖保存 + 卸载 flush，父组件 key={noteId} 挂载换卡即重挂载
  - `TiptapEditor.tsx` + `tiptap/` — Tiptap 3 所见即所得正文编辑器（markdown 真源，tiptap-markdown 往返序列化）：input rules（`# `/`- [ ] `/`**` 等敲完即渲染）、正文 `- [ ]` 勾选项可点选落盘（待办=正文 checkbox，无独立待办实体）、BubbleToolbar 选中浮出（粗斜/行内代码/删除线/链接）、SlashMenu `/` 插入菜单、粘贴 markdown 自动解析
  - `TagFilterMenu.tsx` — # 标签下拉 Popover：从 notes store 聚合 tag→计数（计数降序），点选 toggle 过滤、选中项高亮打勾
  - `NoteCardItem.tsx` — 时间流卡片行，会话列表化样式（同 ConversationRow）：标题全宽 truncate + meta 行相对时间（getRelativeTime）+ hover 浮出引用/删除按钮（ml-auto opacity-0 pointer-events-none → group-hover）；不显示标签 Badge；导出 formatNoteTime 供 TrashView/TaskPanel 复用
  - `TaskPanel.tsx` — 任务 mode（协作任务六分组常量 plan「计划」/backlog「待办」/queued/running/review/done，rejected 不单列——filteredGroups 组装时并入 plan 组尾部）：props `{ workspacePath, query?, listHidden, onToggleListHidden }`；query 对 title/planPath 前端模糊过滤（planPath 判空跳过）；卡片标题行仅标题+徽标，meta 行仅时间（左）+ hover 按钮（右）：常显操作 plan/rejected「移到待办」、backlog「执行」，其余全部收进 ···菜单（queued/running 取消、done 移回计划、backlog 手动完成、全状态删除），无 planPath/笔记关联显示；详情页 TaskDetail：meta 行时间+删除+返回，planPath 小字挂「计划文档」小节标题旁，状态分支 plan/rejected 移到待办+手动完成 / done 移回计划 / 其余照旧，plan 态无文档显挂文档引导文案
  - `TrashView.tsx` — 回收站 mode（独立占满内容区）：两段聚合（笔记/任务，Promise.all 并行拉取独立容错，段标题 sticky 带计数，空段不渲染）；query 前端过滤（各段主文本 includes）；恢复/彻底删除（purge 前 showConfirm），busyKey 防双击；恢复/删除后本地移除，原视图刷新靠 changed 广播
  - `NoteState.tsx` — 空态/加载态复用组件
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

- `workspace-store.ts` — 工作区状态：文件树、选中文件、文件操作（CRUD/移动）；窗口入口 actions：openStockWindow（主进程单例窗口，已存在则 focus）；模块级订阅 workspaceFilesChanged（主进程 workspace-watcher 广播）匹配当前工作区重拉文件树
- `article-store.ts` — 文章状态：选中文章、文章解析、URL 输入框；selectArticle 成功后自动切到文章哨兵 tab（ARTICLE_TAB_ID）；clearSelectedArticle 同步处理文章 tab 回退（关 tab/删文章/切工作区三条清空路径共用）
- `conversation-store.ts` — 对话状态：对话列表、选中对话、分叉参数、编辑重发、对话级模型（setConversationModelSelection）、会话重启触发（sessionRestartTrigger）；loadConversations 并行拉 conversations + tree + groups 后一次写完并同步 group-store；focusConversationById（Tab 焦点联动入口）在活跃会话切换时调 revealTopicInList 展开左侧列表定位话题，并经 expandSubParentIfNeeded 展开 agent 子会话的父折叠区；底部 activeTabId 订阅 async 化焦点联动：真实会话 tab 才 fire-and-forget 上报全局焦点（client.setFocusedConversation，哨兵/空 tab 不上报保持最近焦点语义），tab 属其他工作区时先 `await setWorkspace(目标)` 后 focusConversationById（先切后高亮时序铁律，点 tab/关 tab/独立窗口收回唯一入口）；三个 folder actions 已改名（addGroupToFolder / moveGroupBetweenFolders / removeGroupFromFolder）；导出 CONV_TREE_ROOT 根哨兵；列表刷新统一走 conversationListChanged 事件回环（主进程 service 写点广播，含任务队列建会话 / touch / 改名 / 归档等后台路径），各写 action 内不再手动 loadConversations；`runningConversationIds` / `pendingActionConversationIds` / `pausedConversationIds` 三个 Set 唯一订阅源是后端 `sessionStateChanged` / `sessionClosed`（废弃旧 `conversationRunningStateChanged` 前端订阅，删除乐观直写以避免双源 race）
- `group-store.ts` — 会话组状态：groups\[\] + currentGroupId + expandedGroupIds（默认全折叠）+ syncGroups（conversation-store loadConversations 拉完 groups 后同步写入，不碰展开状态）+ expandGroup（reveal 单向展开）/ createGroup / updateGroup / archiveTopic / restoreTopic / deleteTopic；RECENT_THRESHOLD_MS 常量在此；自动归档由主进程定时触发（见 auto-archive-service）
- `section-collapse-store.ts` — 左侧列表分区折叠状态：recentExpanded（「近期」默认展开）/ expandedSmartCategoryIds（智能分类默认全折叠）/ folderReveal（nonce 供 ManualSection 订阅后逐层 expand 祖先文件夹链）/ subExpandedConvIds（会话行子会话折叠区，默认全折叠，expandSubConv 供焦点联动单向展开）；revealTopic(groupId) 在活跃会话切换时展开话题所在全部分区与话题卡片，数据源动态 import group/smart-category/workspace/conversation 四个 store
- `reference-store.ts` — 引用状态：引用文章列表、引用片段（用户选中文字）、会话引用（ConversationReference，含 workspaceId 支持跨工作区，去重按 conversationId）
- `slash-command-store.ts` — 斜杠命令状态：SDK + 自定义命令合并、capabilities 更新
- `settings-store.ts` — 应用设置：加载/保存/重启会话（整体 save 模式；saveSettings 可选 `{restartSessions}` 透传主进程，触发 settingsChanged 广播）
- `ui-store.ts` — UI 状态：设置全屏 overlay（settingsOpen/openSettings/closeSettings，reset 归 false）+ 右侧面板折叠（rightPanelOpen）
- `confirm-store.ts` — 全局确认弹窗：confirm() 返回 Promise，showConfirm() 简化版
- `stock-store.ts` — 自选股状态：watchlist/quotes/K线/分时/资金流向/搜索/RateLimiter 状态
- `dashboard-store.ts` — 首页工作台状态：reportMarkdown/reportUpdatedAt（首页报告）+ reviewActivity 轮询 + triggerReview/loadReport actions
- `notes-store.ts` — 笔记卡片前端：notes（created 倒序）/loading/loadedWorkspacePath/activeNoteId + loadNotes（listNotes）/subscribeNotesChanged（notesChanged 广播按 workspacePath 匹配重拉）/setActiveNoteId/createNote（支持 {content, tags} 输入，不自动激活——新建即编辑由 NotesPanel 控制）/updateNote（本地乐观更新，广播兜底）/deleteNote（软删除，成功后本地移除）
- `task-store.ts` — 协作任务前端：groups（TaskGroups 八分组，含 plan）/loading/loadedWorkspacePath/activeTaskId + loadTasks（listCollabTasks）/executeTask（tipc executeCollabTask 内部已 kick 队列，成功即 loadTasks 刷新，失败返 false 由组件 toast）/moveTask（tipc moveCollabTask，plan↔backlog 流转）/subscribeTasksChanged（广播匹配重拉）/setActiveTaskId
- `task-focus-store.ts` — 任务通知深链请求（focusReq {taskId, seq}，seq 递增使同一任务重复通知可再触发；NotesPanel 切任务 mode、TaskPanel 选中任务各自响应）
- `session-store.ts` — 多会话标签页：tabs\[\] + activeTabId + sessionWindowIds + lastFocusedNodeId（UI 状态：对话列表节点双层高亮区分"被点击的那一处" vs "已打开的同会话其他节点"）；导出 `NOTES_TAB_ID`/`DATA_CENTER_TAB_ID`/`ARTICLE_TAB_ID` 哨兵（文章 tab 挂载由 article-store.selectedArticle 驱动，选中文章即出现、清空即卸载）（非真实会话）+ `isSentinelTabId()` 判定函数，activeTabId 初始/关末 tab 后回退到 NOTES；`dataCenterTabOpen`（localStorage `data-center-tab-open` 记忆）+ openDataCenterTab/closeDataCenterTab（关闭时 active 在数据中心则回退最近会话 tab 或笔记）；`SessionTab` 无 `isStreaming` 字段运行态一律读 `conversation-store.runningConversationIds`）
- `smart-category-store.ts` — 智能分类前端：categories / activity / load / triggerFullRebuild / cancel / refreshActivity / reset；模块加载时订阅 categoriesUpdated 事件自动 reload（dynamic import @/lib/events 避免 SSR 爆）。UI 消费仅 categories/loading/load（会话列表 SmartSection + 数据中心面板，数据中心在主窗口 tab 后两处同实例），全量重置入口在数据中心面板，补分类定时任务与整理在定时计划
- `scheduler-store.ts` — 定时任务前端：tasks（ScheduledTaskWithNextRun，nextRunAt 现算不落盘）/ activity（refreshActivity，10s 轮询由数据中心面板 useVisiblePolling 驱动）/ history（倒序分页：loadHistory(historyTaskId?) + loadMoreHistory，cursor=上页末条 ts）+ 任务 RPC 封装（saveTask/deleteTask/stopTask 失败 toast 后端文案）
- `terminal-store.ts` — 终端面板前端：terminals Map（terminalId → TerminalMeta：conversationId/command/exited/exitCode，不存内容流）+ activeTerminalId + followMode/pinnedConversationId（跟随/固定，pinConversation/setFollowMode）；openUserShell（cwd 取 workspace.path，ptyCreate conversationId:null）/killTerminal/setActive/ensureTerminals（listPtyTerminals 全量 upsert，后开窗口恢复）/reconcileActive；registerDataSink(terminalId, cb) 收流注册口 + dispatchPtyData 按终端路由（XtermTerminal 消费）；模块级订阅 ptyCreated/ptyData/ptyExit（dynamic import @/lib/events）

## 工具函数（lib/）

- `client.ts` — tipc 客户端，window.ipcRenderer 通信入口
- `utils.ts` — cn() 类名合并工具
- `events.ts` — tipc 事件处理入口，监听主进程事件
- `setup-settings-sync.ts` — setupSettingsSync()（src/main.tsx 顶层挂载）：监听 settingsChanged 事件 loadSettings；restartSessions 时 restartActiveSessions + triggerSessionRestart（设置 overlay 与主窗口同上下文，广播自收自发）
- `manual-task-toasts.ts` — setupManualTaskToasts()（src/main.tsx 顶层挂载）：监听 manualTaskDone 出完成/失败/取消 toast；导出 formatDurationMs
- `model-selection.ts` — 模型选择纯函数：dedupeProfileTiers（按 Profile 提取去重后的 (tier, modelId) 列表）/ sameSelection（结构相等比较）/ resolveModelLabel（selection → 展示名，ModelSelector 与设置页提示文案共用）
- `conversation-sort.ts` — buildConversationTree：组内会话树纯函数（递归 ConversationTreeNode），手动会话按 updated_at 倒序作为根 + agent 派出会话挂派出者下（created_at 升序、支持多层派遣链，parentSessionId 不在组时回落自然序作根）
- `reference-guard.ts` — guardReferenceIntoFocus()：右栏文件/文件夹/附加路径引用前置校验——浏览工作区 ≠ 焦点 tab.workspaceId 时 toast 拒绝（附焦点会话工作区名），HOME tab 无焦点会话放行；WorkspaceExplorer / AdditionalFilesPanel 引用入口共用；requireReferenceAnchorId()：文章引用专用锚定——会话 tab/独立窗口焦点优先，哨兵 tab（文章 tab 等）回退 lastActiveConversationTabId（带工作区匹配守卫），文章选中引用与右键引用整篇共用；jumpToSourceConversation()（async）：笔记/任务详情跳来源会话——已开 tab 聚焦，独立窗口唤起 focus，未开 tab 查会话列表（冷启动先拉取）openTab + selectConversation，跨工作区由焦点联动兑底
- `sdk/index.ts` + `sdk/query.ts` — Claude Agent SDK 的 query 函数封装

## 类型定义（types/）

- `article.ts` — ArticleMeta / Article / QuoteSnippet
- `note.ts` — NoteMeta（id/file/title/created/updated/tags/links）/ Note，主进程镜像在 `electron/main/services/notes/note-types.ts`；旧卡内 todos 类型链（TodoStatus/TodoItem/NoteMeta.todos）已随待办实体退役删除，frontmatter 遇 todos: 块直接忽略
- `task.ts` — 协作任务数据模型：TaskStatus（plan/backlog/queued/running/review/done/rejected/interrupted）/ Task（title/planPath?/originSessionId?/execSessionId?/result?/deletedAt?，lastActiveAt 已废弃读时忽略）/ TaskGroups，主进程真源在 `electron/main/services/task-store.ts`
- `ai.ts` — AIInteraction / AIMessage
- `settings.ts` — ModelTier / ModelSelection / ModelProfile / AppSettings（含 defaultModelSelection 与 digest/review/categorizeModelSelection 各自独立，parseModelSelection 为文章解析 AI 兑底任务专用（null 时回退默认模型）；含 `subAgent = { profiles: SubAgentProfile[] }` 子会话派遣 Profile 清单，SubAgentProfile.enabled 仅非 default 有意义——停用后系统提示词索引不列出、startChild 拒绝；根级 `basicToolPermissions` 七工具映射；`ai.permissionMode` 为 `default | autoExecute` 两态；`ai.effort` 控制推理努力程度）/ DEFAULT_SETTINGS
- `agents.ts` — TaskStatus / TaskType / AgentTask / ForkParams
- `electron-api.ts` — Workspace / WorkspaceFileNode / ExtendedSessionMessage / Citation / Conversation（含 modelSelection/contractMetadata — 后者记录 agent 派出溯源：createdBy / parentSessionId / task）
- `delegation.ts` — Agent 协作契约数据模型（ContractMetadata / ChildSessionState / 契约通道消息类型）
- `stock.ts` — WatchlistItem / StockQuote / KLineDataPoint / TimelinePoint / MoneyFlowPoint / StockSearchResult / DailySnapshot / QUOTE_FIELD_MAP / RateLimiterStatus / Announcement / AnnouncementType / ListAnnouncementsOpts / AnnouncementDetail / CachedAnnouncementEntry
- `usage.ts` — 会话用量数据模型（ConversationUsageEntry / CompactMarker / ContextSnapshot / ConversationUsage / UsageJsonlLine），主进程镜像在 `electron/main/types.ts`
- `system-prompt.ts` — SystemPromptSegment（key/label/category/template/triggerDescription/isDynamic），主进程镜像在 `electron/main/types.ts`
- `smart-category.ts` — 智能分类数据模型（DigestTags / SmartCategory { groupIds\[\] } / CategorizeDecisionLog { groupId } / SmartCategoriesIndex / CategorizeActivity / CategorizeRecentEntry），主进程镜像在 `electron/main/types.ts`
- `scheduler.ts` — 定时任务数据模型（ScheduledTask 两变体 builtin|custom / Trigger 八种含 on_task_done 任务链 / TaskRunState / RunHistoryEntry / SchedulerActivity / ScheduledTaskWithNextRun / HistoryPage），主进程镜像在 `electron/main/services/scheduler/types.ts`
- `electron.d.ts` — window.ipcRenderer 全局类型声明

## Electron 主进程入口（electron/main/index.ts）

窗口创建与生命周期；渲染层加载统一走 `getRendererPath()`（dev 为 `http://localhost:3000`，生产为 `app://dogear/index.html` 自定义协议）。`app://` 注册为 standard+secure scheme，handler 从 `process.resourcesPath/out/` 响应文件（字体扩展名显式映射 MIME，`.ttf` 等需 `font/ttf` 否则 `@font-face` 拒载；含路径穿越防护）——替代原 `file://` 加载，消除 opaque origin 下 CSS 字体等 CORS 严格资源被拦的问题；主窗口 + debug/stocks/data-center/session-window/workbench-window 各子窗口均为 `${getRendererPath()}#/路由` 拼接；broadcastSettingsChanged 定向发主窗口驱动设置刷新与会话重启

## IPC 路由（electron/main/tipc/）

- `index.ts` — 路由注册中枢，聚合所有子路由
- `windows.ts` — 窗口管理路由：openDataCenterWindow / openWorkbenchWindow；动态 import index.js 避免循环依赖，BrowserWindow 单例（数据中心 1200×800、伴随工作台默认 560×840 + 位置记忆）在 electron/main/index.ts
- `focus.ts` — 全局焦点会话：setFocusedConversation（主窗口切 tab / session-window 激活时上报，写 focused-conversation-service 内存态，值变化才广播 focusedConversationChanged）/ getFocusedConversation（伴随工作台冷启动恢复跟随）
- `pty.ts` — 真 PTY 终端路由：ptyCreate（conversationId 可 null=用户 shell）/ptyWrite/ptyResize/ptyKill/getPtyBuffer（返回快照 buffer+cols+rows+exited+exitCode，后开窗口灌历史）/listPtyTerminals（可按 conversationId 过滤）；另导出 registerPtyBroadcaster（registerTipcHandlers 调用）：把 pty-service 的 PtyEvent 桥接成 ptyCreated/ptyData/ptyExit 三个渲染层广播
- `agent.ts` — Agent 会话管理（RPC：创建/发送/关闭会话、权限控制）
- `ai.ts` — 通用 AI 接口（chat / summarize，占位实现）
- `article.ts` — 网络文章管理（抓取解析、列表、详情、删除）
- `notes.ts` — 笔记卡片 CRUD（createNote/getNote/listNotes/updateNote/appendNote/deleteNote/restoreNote/purgeNote/listTrashNotes/searchNotes，输入首参 workspacePath）；写操作后主进程广播 notesChanged 事件
- `tasks.ts` — 协作任务路由：listCollabTasks（六分组）/listDeletedCollabTasks/getCollabTask/reviewCollabTask/executeCollabTask（backlog→queued + kick 队列）/deleteCollabTask（软删）/restoreCollabTask/purgeCollabTask
- `conversations.ts` — 对话 CRUD + 分叉（JSON 存储）
- `workspace.ts` — 工作区管理（列表、默认、文件夹选择、文件树）
- `file.ts` — 文件操作（打开文件位置）
- `explorer.ts` — 工作区文件树操作（创建/重命名/移动/复制/删除）
- `stock.ts` — 自选股行情 + 分析（12+RPC：自选股CRUD、批量行情、单股行情+自动快照、K线、分时、资金流向、每日快照查询、搜索、限流状态 + 指标计算、筛选、财务、回测等）
- `usage.ts` — 会话用量查询（getUsage：懒重算 usageSummary 后读 JSONL；getUsageStats 入参 `{workspaceId?, sinceMs}`：不传 workspaceId 时逐工作区聚合 flat，返回 stats 每行带 workspaceId 归属标识，供数据中心用量页时间分页）
- `group.ts` — 会话组 +话题生命周期 +共享区：listGroups / getGroup / createGroup / updateGroup / archiveTopic / restoreTopic / listArchivedTopics / deleteTopic / readGroupBackground（读 background.md 供前端话题面板）/ listSharedFiles / read+write+deleteSharedFile / openSharedAreaInExplorer / autoArchiveStale
- `digest.ts` — 组卡巡检（listGroupDigests 入参 `{workspaceId?}`：不传 = 遍历 workspaces.json 聚合全工作区按 updatedAt 全局降序，返回行带 workspaceId 归属标识 / readGroupDigest / readGroupDigestRaw 读原文供前端浮窗 / triggerGroupDigestScan 全工作区扫脏 / triggerGroupDigest 单组重跑 / getGroupDigestActivity 活动轮询 / get+setGroupDigestPrompt 提示词读写 / cancelGroupDigest 单任务取消 / cancelAllGroupDigest 一键停（清队列+取消当前）/ get+setDigestModelSelection 沿用旧的 settings.ai.digestModelSelection 配置项）
- `review.ts` — 首页报告（历史代号 review）：getReport 读 `dashboard.md` / triggerReview 触发生成 / getReviewActivity 活动轮询 / get+setReviewPrompt 提示词 / get+setReviewModelSelection 整体模型选择 / cancelReview 取消
- `category.ts` — 智能分类：getCategories（含归档过滤，按 groupIds 存活性过滤）/ triggerCategorize { workspaceId, groupId, groupDigestPath } / triggerFullRebuild（手动入口传 source 'manual'，完成写 run-history 伪计划记录并广播 manualTaskDone）/ cancelCategorize（无参全局单队列）/ getCategorizeActivity / get+setCategorizePrompt / get+setCategorizeModelSelection 整体模型选择 / get+setSmartCategorySettings（enabled/threshold/maxCategories，后端 clamp）；conversations.ts 也加了 addGroupToFolder / removeGroupFromFolder / moveGroupBetweenFolders 三个 IPC 支持手动文件夹装 groupId + 多引用，以及 setConversationModelSelection 单独写对话级模型
- `agent.ts` — Agent 会话管理，路由统一查 `getPiSessionManager()`（）：setSessionModel（接收 ModelSelection，返回 `{ ok:true; needsRestart? } | { ok:false; error }`；同 profile 换 tier 走 PiSession 快速路径，跨 profile 由前端触发会话重启）；`closeQueryBasedSession` = release 语义（refCount-1，归零即销毁），`forceCloseQueryBasedSession` = 强杀（`/clear` 走这条立刻销毁避免后台弹卡片）；`pauseQueryBasedSession` = turn 粒度暂停请求（受理后当前 run 完成进 paused，返回 `{success}` 受理与否或 `{error}`）；路由名保留旧字样是历史兼容，内部实现已纯 pi；broadcaster complete 分支挂 model-failover 钩子——success 走 clearFailoverTriedBySession 清 tried，failed 走 maybeFailoverMainSession 主会话 quota 自动切换（见 `agents/model-failover.ts`）
- `system-prompt.ts` — 系统提示词模板查询（getSystemPromptSegments，返回 `{ segments } | { error }`，供设置页只读预览用户看不见的系统级 append 段）
- `scheduler.ts` — 定时任务（listTasks 含现算 nextRunAt / saveTask 全量校验含触发态合并、on_task_done 引用与环检测、toolPacksOverride 清洗，builtin 名称锁定 / deleteTask 拒 builtin「内置任务不能删除」/ setTaskEnabled / runTaskNow 手动直跑不看 enabled / stopTask 整停（清队列+取消当前）/ listRunHistory 倒序分页（planId 过滤=任务 id + before cursor）/ getSchedulerActivity 运行快照 / getBuiltinTaskDetail + saveBuiltinPrompt + resetBuiltinPrompt 内置任务提示词三件套）
- `renderer-handlers.ts` — main→renderer 事件定义（分析更新、会话消息、权限请求、usageEntryAdded、categoriesUpdated、pendingCountChanged、sessionStateChanged / sessionClosed 跑步机状态原子事件、failoverNotice 主会话供应商切换提示条、tasksChanged 协作任务变更、manualTaskDone 手动全量重置/重新提炼完成 toast、ptyCreated/ptyData/ptyExit 真 PTY 终端三事件等）

## 业务服务（electron/main/services/）

- `conversation-service.ts` — 对话索引 CRUD + 对话级模型选择（`.dogear/conversations.json`），含 modelSelection 字段；create() 时由 tipc 注入 settings.ai.defaultModelSelection 浅拷贝，createFork() 继承父对话 modelSelection；updateModelSelection 单独维护；listByParent(workspaceId, parentConversationId) 只读查某父会话全部 role='sub' 对话（调度站 getChildrenByParent 持久层补集数据源）；含 usageSummary（applyUsageSummary 增量、recomputeUsageSummaryIfStale 懒重算）；withConversationsTxn 持锁期间 mtime 变化打 error（跨进程覆盖观测）
- `session-id-repair.ts` — sessionId 丢失启动自愈（index.ts 启动时 fire-and-forget）：扫全 workspace 的 null sessionId 会话，按 harness 文件名时间戳与 conversation.createdAt ±2s 对齐回填；不经 JsonlSessionRepo.list（其 cwd 过滤跨环境行为不一致，直接解析文件名）
- `usage/` — 会话 token 用量采集与存储
  - `usage-extractor.ts` — 从 SDK result 提取 ConversationUsageEntry 纯函数（contextWindow 查 `pi/model-catalog.ts` 目录表、modelUsage 缺失合成、工具/子代理聚合）
  - `usage-service.ts` — 用量 JSONL 读写删（`.dogear/usage/{conversationId}.jsonl`，appendEntry/appendCompactMarker/appendContext/readUsage/readUsageSince（轻量扫描聚合计时段轮次）/deleteUsage）
- `memory/` — 会话清洗 + 组级提炼闭环（按「组」粒度）
  - `session-paths.ts` — 会话路径解析共享 util（getClaudeConfigDir / getSdkSessionsDir / getSessionJsonlPath）：服务 PARSE_ARTICLE 及 `agent.ts` 的 `getSubAgentHistory`/`getSdkSessions`（子代理历史文件路径），与主会话 pi-session/ 的 Harness 会话路径（`pi-session-repository.ts` 的 `getSessionsRoot`）是两套不同的存储位置
  - `transcript-cleaner.ts` — 会话 JSONL 确定性去噪（cleanTranscriptFromLines 纯函数 + cleanTranscript IO，剥工具结果/系统行/思考块，保留用户+助手文字与一行工具骨架，\~20x 压缩）
  - `group-digest-store.ts` — 组卡读写（GroupDigestCard 序列化/解析 + sourcesSeen 合并 + readGroupDigest/saveGroupDigest/listGroupDigests/deleteGroupDigest；落 `<configDir>/workspaces/<wsId>/groups/<groupId>/digest.md`；导出 getGroupDir 供组内其它文件复用）
  - `group-digest-prompt.ts` — 组提炼提示词模板（DEFAULT_GROUP_DIGEST_PROMPT + loadGroupDigestPrompt 播种 `<configDir>/group-digest-prompt.md` + saveGroupDigestPrompt；设置页可编辑）
  - `group-digest-scanner.ts` — 组卡脏判定（isGroupDirty 纯函数按「新会话加入 / 会话 mtime 增长 / 会话被移出」三条件；findDirtyGroups / scanDirtyByGroup / scanDirtyByConversation；子会话 role='sub' 被过滤；session 文件 stat 失败逐会话 warn，整组不可读时告警并跳过）。`findDirtyGroup(..., force)` 的 force=true 跳过脏判定并返回全量 main 会话，只给设置页手动「重新提炼」用
  - `source-fidelity.ts` — 组卡引用保真度校验：`buildSessionUuidIndex(workspacePath, sessionIds)` 复用 `cleanMessagesFromLines` 建「sessionId → 去噪后 uuid 集合」索引（每会话只读一次，缺文件映射为 null）；`validateItemSources` 纯函数逐条查，分三种问题——uuid_not_found（编造）/ wrong_session（张冠李戴，回告正确 sessionId）/ session_missing。**校验口径必须与 agent 所见一致**，所以复用同一个去噪函数而非 JSONL 全量 uuid
  - `group-digest-trigger.ts` — 组提炼编排（串行队列并发=1 + in-flight 去重；triggerScanAll 全量扫 / triggerByGroup 手动单组强制 / triggerByConversation 会话级精准入口——已接回调度器 on_session_close：带脏判定，组不脏只留日志不入队；提交 GROUP_DIGEST_SESSION 任务）+ 活动采集（current/queueDepth/recent 环形 / lastScan）+ recent/lastScan/failStreaks 持久化到 `<configDir>/digest-activity.json`（sync load + debounce 500ms save）+ 连续 3 次未产出（no-card/error）暂停该组自动提炼（手动重新提炼清零，精准触发同样被拦截）+ cancelAllGroupDigest 一键停 + 成功后 chainCategorize
  - `migration-p3.ts` — 启动幂等迁移（app.whenReady 之后一次跑完）：① 旧 `<sessionId>.md` → `<groupId>.md` 1:1 重命名并落 sourcesSeen；② smart-categories.json 的 conversationIds → groupIds；③ conversation-tree.json 的 children 从 conversationId → groupId + schemaVersion=2；旧产物落 `_archive/`，二次执行检测已迁移即跳过
  - `notes-store.ts` — 组共享区 `_notes/` 目录读写（列出/读取，供组提炼 agent 优先利用 working agent 的阶段总结）
  - `background-store.ts` — 组背景 background.md：结构化 frontmatter（topic / progress / keyDecisions / openQuestions），落 `<wsData>/groups/<groupId>/background.md`，供组内新会话派子会话查阅
  - `migration-gate.ts` — 启动闸门：whenMigrationReady() 阻塞组提炼 / 分类 trigger，直到 markMigrationComplete() 被调用
  - `migration-p4.ts` — 幂等迁移：组卡从 `<wsData>/digests/<groupId>.md` 迁到 `<wsData>/groups/<groupId>/digest.md`，删除 `digests/_cleaned/`（不再留盘干净逐字稿）
  - `dashboard-watcher.ts` — dashboard.md 文件监听（递归 fs.watch + 300ms 去抖，变更时全窗口广播 reportUpdated 事件，触发 dashboard-store 重新拉取）
  - `review-store.ts` — 首页报告存储：ReportDoc { updatedAt, markdown } 落 `<configDir>/workspaces/<wsId>/dashboard.md`
  - `review-scanner.ts` — 报告脏检查：isReportStale 纯函数（最新组卡 updatedAt vs 报告 updatedAt）
  - `review-prompt.ts` — 报告提示词模板（引导 agent 分流为「记忆 dogear__SaveMemory + 报告 dogear__WriteReport」，读组卡驱动）
  - `review-skill-service.ts` — 历史 no-op 遗留：跨会话复盘 skill 已删（功能由调度器内置任务 review / review-prompt.ts 承载），`ensureReviewSkillInitialized` 保留空实现仅为 index.ts 启动序列兼容
  - `review-trigger.ts` — 报告生成编排（串行队列 + in-flight 去重；triggerReview 提交 REVIEW_SESSION 任务）+ 活动采集
  - `smart-category-store.ts` — 智能分类索引读写（`<configDir>/workspaces/<wsId>/smart-categories.json`）+ 纯函数 helpers（pushGroup / removeGroupEverywhere / appendDecision 环形 20 条 / newCategory）
  - `smart-category-engine.ts` — 决策纯函数：matchByThreshold（Step A 阈值匹配，0 LLM）+ pickRedistributeCandidates（Step C 邻近候选召回）+ normalizeTag/normalizeTags（标签归一化）
  - `categorize-prompt.ts` — 分类提示词模板（DEFAULT_CATEGORIZE_PROMPT + loadCategorizePrompt 播种 `<configDir>/categorize-prompt.md` + saveCategorizePrompt）
  - `category-trigger.ts` — 分类编排（串行队列并发=1 + in-flight 去重；triggerCategorize(workspaceId, groupId, groupDigestPath) 单条 / triggerCategorizeSweep 差集补分类（有 tags 活跃组卡 − 分类挂载并集，逐组入队 incremental，scheduler 补分类 builtin 即走此路径）/ triggerFullRebuild 工作区全量（manual 来源完成时写 run-history + 广播 manualTaskDone）/ cancelCurrent 取消正在跑的任务）+ 活动采集 + 索引变更（含 full-rebuild 全 skip）时广播 categoriesUpdated
  - 注：工作区主题记忆（memory-service / memory-recall / memory-fs / memory-indexer / memory-loader / memory-types）也在此目录
- `scheduler/` — 定时任务系统（一行一任务：builtin 四种常驻可改不可删 + custom 自定义；任务级触发器 OR 语义，分钟级 tick 调度；单例 getSchedulerService 在 index.ts 启动接线 init）：
  - `types.ts` — 数据模型（ScheduledTask\[builtin|custom\] / Trigger 八种含 on_task_done 任务链 / TaskRunState / RunHistoryEntry / SchedulerActivity / ScheduledTaskWithNextRun），渲染层镜像 `types/scheduler.ts`
  - `builtin-task-meta.ts` — 内置任务元数据：BUILTIN_TASK_IDS / BUILTIN_LABELS 共享常量 + BUILTIN_TASK_META（label / loadPrompt / savePrompt / defaultPrompt / tools，复用四个既有 prompt 模块的磁盘机制）
  - `time-rule-engine.ts` — 时间规则纯函数（validateTrigger / nextDueAt / minNextDueAt / detectMissed / windowOpen / windowCloseAt / describeTrigger 中文摘要）
  - `plan-store.ts` — `.dogear/plans.json` 读写（`{version:2, tasks}` 容器；loadTasks 读时一次性迁移+seed，模块级 readyPromise 防并发可重试；旧数组格式按任务拆条：on_plan_done 过滤 / 空计划丢弃 / builtinId 去重保首条 / runState 丢弃；seed 固定 id `builtin-${builtinId}`；safe-json 原子写 + 变更互斥队列；touchTriggerFired / markOnceFired / updateTaskRunState 细粒度变更）
  - `plan-validate.ts` — 保存校验纯函数（assignTaskIds / mergeFiredState 按 trigger.id 保留旧触发态 / validateTaskForSave（builtin name 必须 === 固定 label、custom prompt 与 workspaceId 必填）/ on_task_done 目标存在性校验 + detectTaskCycle 任务链环检测 / KNOWN_TOOL_PACKS + sanitizeToolPacksOverride 过滤未知包名）
  - `scheduler-service.ts` — 调度核心（60s tick 按任务逐触发器求值；窗口状态机开触发关停机；handleAppStart 事件入口 + handleSessionClose(conversationId) 会话自然销毁入口——pi-session-manager 触发点下沉后唯一 on_session_close 来源：quitting 拦截 + 经 conversation-service 解析 workspace 严格相等过滤跨工作区 + fireTask 透传 triggerContext.conversationId 到 executor；启动错过检测记 missed 不补跑；runTaskManual 直调 runner 不看 enabled；task_done 完成事件触发 on_task_done 下游 fireTaskDoneDownstream；stopTask 整停转 runner.requestStop）
  - `run-history-store.ts` — `.dogear/run-history/YYYY-MM.jsonl` 按月追加 + queryHistory 倒序分页（before 语义 cursor）+ 保留 3 个月自动清理
  - `custom-agent-prompt.ts` / `custom-agent-tools.ts` — CUSTOM_AGENT 自定义任务的提示词模板与工具集组装（基础文件/搜索工具 + 常驻 memory/review 工具 + 可选包：toolPacksOverride 有值时完全替代工作区 enabledToolPacks，workspace 边界校验，不装 Bash）
  - `runtime/plan-runner.ts` — 单任务执行器（单例 getTaskRunner：按 task.id 防重入 / runState.cursorStartedAt 断点补记 interrupted 历史 / task_done 事件 / requestStop 按任务类型分派取消——custom 走 agentTaskId cancelTask、builtin 走各 trigger 层 cancelAll\*，stopRequested 按 stopReason（manual/window）标注 summary；requestStop 可带来源 triggerId，window 超时只停自己触发的运行）
  - `runtime/task-executor.ts` — 任务执行（builtin 四种直调现有 memory trigger 层并等队列空闲；group_digest 带 hooks.triggerContext 时走 triggerByConversation 精准提炼、summary 定性描述，否则全量扫描引用 dirtyCount；custom 提交 CUSTOM_AGENT 到 agent-manager Worker 池等待回调，payload 携带 toolPacksOverride，hooks.onAgentTaskId 回填 id 供停止取消，模型三级 fallback，token 用量提取入历史）
- `conversation-runtime-service.ts` — 会话运行时管理（多附件绑定 desktop/wechat-bot、会话快照、复用 session；detach 链路 detachAttachment / detachByConversationHolder 带可选 source 参数透传到 release——failover 换血传 forced 使其不触发调度器 on_session_close，closeConversation 走 closeSession 强杀同样不触发）
- `contract-channel-service.ts` — 契约通道校验（hasDirectContractChannel：只认直接派出关系，A 派 B 派 C 时 A 无法直连 C；dogear__SendMessage / dogear__StopSession 工具层前置校验）
- `group-service.ts` — 会话组 CRUD（`.dogear/groups/{workspaceId}.json`）：listGroups / getGroup / createGroup / updateGroup / deleteGroup / archiveGroup / restoreGroup / listActiveGroups / touchGroup（会话活动时刷新 updatedAt）；全部写方法尾部广播 conversationListChanged（结构操作 immediate，touchGroup 500ms 去抖）
- `group-shared-service.ts` — 组共享区文件读写（`.dogear/workspaces/{wsId}/groups/{groupId}/shared/`），供 group-tools 和前端 TopicPanel 使用；writeNativeFile / deleteNativeFile 尾部广播 groupDataChanged
- `auto-archive-service.ts` — 自动归档：autoArchiveStaleGroups(wsId) 筛选 updatedAt 超 30 天且不在手动文件夹的活跃组，逐个 archiveGroup + removeGroupEverywhere；startAutoArchiveTimer 主进程启动跑一次 + 每 24h 一次（归档广播由 group-service 发出）
- `conversation-tree-service.ts` — 手动文件夹树（`.dogear/workspaces/{wsId}/conversation-tree.json`）：children 装 groupId（schemaVersion=2）；listFolders / addGroupToFolder / removeGroupFromFolder / moveGroupBetweenFolders / initializeTree；结构写方法（文件夹 CRUD / 移动 / 组挂载）尾部广播 conversationListChanged（sortGroupsByUpdatedAt 是读路径懒重排，不广播防回环）
- `workspace-json-service.ts` — 工作区 JSON 存储（`.dogear/workspaces.json`）；add / remove 尾部触发 workspace-watcher 增删起停
- `renderer-broadcast.ts` — 主进程→渲染层广播收口：broadcastToWindows 全窗口遍历；broadcastConversationListChanged（immediate / debounced 500ms 尾部去抖两档，会话与组列表域）；broadcastGroupDataChanged（TopicPanel 三数据域）
- `focused-conversation-service.ts` — 全局焦点会话状态（「最近一次被激活的会话」语义，跨窗口共享）：内存态 `{conversationId, workspaceId} | null`，setFocusedConversation 值变化才广播 focusedConversationChanged 到所有窗口（伴随工作台据此跟随，含跨工作区整窗切换）；哨兵 tab 不上报故焦点自然保持，会话删除后悬空焦点由渲染层 find 不到自然空态
- `workspace-watcher.ts` — 工作区文件树监视：每工作区递归 fs.watch 只处理 rename 事件（增删改名，忽略 change），路径段 `.` 开头或 node_modules 丢弃，500ms 尾部去抖后广播 workspaceFilesChanged；随 workspaces.json 增删起停，监听错误静默降级关闭
- `settings-service.ts` — 应用设置 JSON 存储（`.dogear/settings.json`，含 permissionMode、basicToolPermissions；导出 normalizeSettings 做幂等历史设置迁移与结构修复，清理遗留 SDK 字段；normalize 尾部挂 settings-types.ts 的 normalizeFailoverChain 维护全局模型故障转移链——类型 FailoverEntry/FailoverConfig（AppSettings.failover）：新供应商追加链尾、删除供应商移出链、tier 失效回退该家首个 piModel、piModels 为空的供应商不进链，链序与 enabled 完全保留）；浏览器搜索设置项 browserProxyServer（空=禁用代理引擎仅 Bing）与 browserSearchEngine（auto/google/bing，默认 auto）也在此维护；SubAgent 能力域字段维护在 settings-types.ts（`SubAgentEnabledAbilities` 双份镜像：`SubAgentProfile.enabledAbilities.{browser,extension,…}`，extension 非布尔剔除且标记 changed；`createBrowserParseSubAgentProfile` 模板 browser+extension 双 true）；浏览器解析 Profile description 已重构为探索方法论（2026-09-08 browser-exploration 计划 Step 4：先取站点档案 → observe → read_state 下钻 → site_finding 沉淀），normalizeSettings 以 `LEGACY_BROWSER_PARSE_DESCRIPTIONS` 三旧值集合识别并迁移到新描述，用户自定义描述不动
- `pty-service.ts` — 真 PTY 实例管理（node-pty）：模块级 Map（terminalId → instance + buffer，按 UTF-16 字符 100K 封顶保尾部）；createTerminal（detectShell：Windows 优先 Git Bash，排除 WSL bash.exe，找不到报错提示装 Git for Windows；resolveCwd 经 workspaceRoots 边界校验）/writeTerminal（exited 幂等）/resizeTerminal/killTerminal/killConversationTerminals（doClose 随会话销毁清）/killAll/getBuffer/listTerminals；事件经 setPtyEventBroadcaster 上抛（桥接在 tipc/pty.ts 的 registerPtyBroadcaster）
- `window-state-service.ts` — 窗口位置记忆通用小工具：`.dogear/window-state.json` 按 key 存 {x,y,width,height}（safe-json 原子写），load/saveWindowBounds；当前仅 workbench-window 使用
- `ai-service.ts` — AI 接口占位（chat / summarize）
- `article-service.ts` — 网络文章抓取（V2：平台脚本优先 + Readability 兜底 + AI 失败才介入），微信公众号特殊处理
- `browser/` — 受控浏览器（真实 Chromium + patchright 反检测 fork，headful + 持久 profile；lease 语义 acquire/release，空闲约 3min 自动关）+ 浏览器扩展网关（用户真实浏览器扩展的双向命令通道，P1）：
  - `nm-bridge.ts` — NM host worker 入口（`resources/nm-host/nm-bridge-worker.cjs` 为其打包产物）：stdio ↔ named pipe 双向桥接，浏览器把扩展消息原样转发到 gateway pipe（`scripts/build-nm-manifest.mjs` 生成注册清单，allowed_origins 用 manifest.key 固定扩展 ID）
  - `nm-protocol.ts` — 帧协议（4B LE 长度前缀 + UTF-8 JSON，64MB 上限；`extension/src/nm-protocol.js` 为语义一致的独立副本，不共享文件）：`ProtocolVersion = 3` 协商（P3：加 read_state kind 递增）、6 种 P0 帧 + `command`/`command_result`/`permission_state`、`CommandKind`（observe/click/fill/read_text/**navigate**/**read_state**）与 `CommandErrorCode` 13 值联合类型（含 P2 新增 `navigation_blocked`）；tab_snapshot 帧带 `generation`（P2 代际语义：受控 tab URL 变化时递增，SW 冷启重置 0），navigate 命令帧 params 为 `NavigateCommandParams { targetUrl }`，read_state 命令帧 params 为 `ReadStateCommandParams { path? }`（旧扩展 hello v2 收 stale_protocol 引导重载）
  - `browser-gateway.ts` — NM pipe server 单例（`initBrowserGateway(appVersion)`）：单连接模型（新 hello takeOver 旧连接发 goodbye + rejectAllPending），pending map 管理命令生命周期（30s 超时/断连 disconnected/迟到 command_result 忽略）；`ExtensionStatus`（connected 分支含 extensionVersion/protocolVersion/tabId/title/url/textPreview/extractError/authorizedOrigins/**generation**）经 `setExtensionStatusBroadcaster` 注册制广播；`sendExtensionCommand(kind, params, timeoutMs=30000)` 前置校验链 not_connected → stale_protocol（protocolVersion<2）→ permission_denied（`isOriginAuthorized`：授权 origin 列表或 `<all_urls>` 全放行，url 空/非法 origin 一律拦截）；**P2**：navigate 走 `validateNavigateTarget(targetUrl, authorizedOrigins)` 目标域前置校验（非 http/https / 非法 URL / 目标未授权 → `navigation_blocked` 拒绝且命令帧不发出）并跳过「当前页域 permission_denied」校验（工作区模型：任意页可导航到已授权域），成功后 command_result `data.url` 同步 status.url；拒绝 payload 的 `currentUrl`（拒绝瞬间受控页地址）透传至 CommandError 供工具层文案拼接
  - `browser-manager.ts` — 单例 getBrowserManager：ensureLaunched（patchright chromium.launch；Chromium 缺失时经 browser-download-service 自动安装）、PAC 按域代理注入（读 settings.browserProxyServer，data URL 内嵌：.google 系 + duckduckgo.com + reddit 系（P3：reddit.com/redditstatic.com/redd.it）走代理、其余 DIRECT，不受系统代理开关影响；知乎直连）、acquire(taskMeta) 排队发 lease（page 复用）
  - `browser-article-service.ts` — readArticleWithBrowser：渲染等待 + 展开全文启发式点击 + 翻页拼接 + DOM 登录墙检测（need_login 引导窗口人工登录，profile 记住登录态），错误归类不抛
  - `browser-search-service.ts` — searchWeb(query, opts)：引擎编排（auto 按 browserProxyServer 探测 2s 定链 / 显式引擎），降级链 Google → DDG(html) → Bing cn，验证页（/sorry/）与代理故障检测，逐级降级记录原因，三级全失败才失败；P3 加 `site` 参数（reddit/zhihu 站内引擎，见 site-search.ts）：站内尝试成功 → engine=site + meta 透传，失败自动降级「{query} site:{domain}」喂通用链（degradations 记录站点→引擎，outcome.query 反映实际搜索词）；站内降级态（effectiveQuery 带 site: 语法）对通用引擎结果做 `urlMatchesDomain`（host 精确匹配含子域）域名过滤兜底（Bing 真机无视 site: 语法），剔除非目标域结果（emit 过滤明细），过滤后为空 → 该引擎视为失败走降级/最终诚实失败（message「域名过滤后无匹配」），普通搜索路径不受影响；不抛，错误归类（empty_query/parse_empty/timeout/browser_crash）；serpUrls 参数仅测试注入用（google/ddg/bing/reddit/zhihu 五键），不暴露给工具
  - `serp-parsers.ts` — 三引擎 SERP 解析器（evaluate 内 DOM 查询，new Function 写法）：Google（#search/#rso div.g 多候选 + 广告剔除）、DDG（div.result + uddg 重定向解码 + y.js 广告剔除）、Bing（li.b_algo + b_ad 剔除）；P3：ParsedSerpItem 加 `meta?`（站内互动量一行文本）+ parseRedditSerp（old.reddit 版式：score/评论数/subreddit/时间）/ parseZhihuSerp（DOM 兑底：ContentItem 卡片作者/赞同）/ extractZhihuStateCards（知乎 __INITIAL_STATE__ 通用启发式 walk：type 谓词 + URL 派生去重，深度/节点/卡片上限防护）
  - `browser-action-stream.ts` — 浏览器动作事件汇总出口（navigate/wait/click/observe/parse/read_state…，kind=article|agent，source 区分后端：受控浏览器各动作 | 'extension'（扩展工具）| 'save_article'，供伴随面板动作流消费）；extension 动作带 `conversationId`/`urlBefore`/`urlAfter`/`errorCode`/`durationMs`（仅命令耗时，策略延迟不计），语义结果枚举 result：navigated/clicked/filled | error | budget_exceeded | risk_blocked | risk_signal | busy（P3 独占拒绝）| missing_state/path_not_found/not_serializable（P3 read_state 专用）
  - `site-policy.ts` — 站点策略模块（P2，代码级不进 settings）：`SitePolicy { matchOrigins, searchUrlIncludes, delayMs, searchDelayMs, budget{maxNotes,maxSearches}, riskKeywords }`，内置小红书策略（操作间随机 15~45s / 搜索导航 30~90s、单会话预算 20 笔记/5 搜索、12 个风控关键词），`getSitePolicy(url)` origin 精确匹配未配置域返回 null（保持 P1 宽松行为）；`registerSitePolicy` 运行时注册（测试注入缩小参数用）；会话级运行时（模块内 Map）：搜索/笔记预算检查与计数（navigate 搜索 URL 计 1 搜索、read_text 无 ref 计 1 笔记带 ref 分片不计）、`markRiskBlocked` 会话×域名风控标记（命中后该会话对该域名全部扩展工具前置拒绝），进程内存无持久化；P3：`controlledBrowserBlock(url)` 受控浏览器通道封禁扩展绑定站点（readArticle/navigate 入口直接拒绝并引导扩展通道）
  - `extension-ownership.ts` — 扩展通道会话独占（P3，纯逻辑零 IO）：`acquireChannel(conversationId, now)`（同 owner 续期 / 空闲超 `IDLE_RELEASE_MS`=10min 自动释放后新 owner 可夺取 / 异 owner busy + idleMs）、`releaseChannel`（非持有者无效）、`resetChannel`（断连清零，browser-gateway handleDisconnect 接线）；无 conversationId 的 adhoc 调用不参与独占；busy 不排队直接拒（随机延迟下等待不可预期）
  - `site-search.ts` — 站内搜索引擎（P3）：`SITE_SEARCH_CONFIG`（reddit=old.reddit `sort=top&t=year` / zhihu=搜索页 type=content）、`runSiteAttempt`（navigate → zhihu waitForSelector 渲染等待 → state 优先/DOM 兑底解析，nav_failed/parse_empty 失败归类）；`readZhihuState` 用 CDP `Runtime.evaluate` 直连主世界（patchright 的 page.evaluate 落隔离世界读不到页面脚本写入的 window 全局，生产级发现）；`refineEmptyReason`（2026-09-08 browser-exploration Step 1）：parse_empty 按站点细化降级原因——zhihu 用 `page.locator('text=未搜索到相关内容')` 探测空态（tsconfig.electron 无 DOM lib 不能直访 document，未登录软登录墙服务端置空结果）、reddit 用 `/login/` URL 判据识别登录重定向（硬登录墙 302 → /login/?reason=lor2）；nav_failed 分支同判据，URL 落 /login/ 时提示未登录而非网络异常
  - `site-knowledge-service.ts` — 站点档案存储（2026-09-08 browser-exploration 计划，`.dogear/site-knowledge/{domain}.md` 两区档案：正式地图已验证 + 探索发现未验证由会话追加）：`normalizeDomain`（小写、去 www. 前缀、容忍 URL 输入、合法性校验）、`readSiteKnowledge`（存在性 + 内容，超 8KB 头部截断带提示）、`hasSiteKnowledge`、`appendSiteFinding`（探索发现区追加：单条 ≤500 字、60s 会话内相同内容去重提示已记录、自动补骨架/发现区标题，行前缀 `[日期 · 会话短id]`）；无档案域名是正常态非错误
  - `browser-download-service.ts` — Chromium 自动下载（npmmirror/playwright-cdn 双源 + 进度广播）
- `notes/` — 笔记卡片数据层（存储 `<workspacePath>/.dogear/notes/` 一卡一 md，frontmatter 承载元数据，文件为真源）
  - `notes-store.ts` — IO 原语：路径/文件名生成（`<YYYYMMDD-HHmmss>-<shortid8>.md`）/手写 frontmatter 解析序列化（YAML 兼容子集，零依赖，遇 todos: 块直接忽略）/原子写/index.json 维护（不回退 .bak，损坏全量重建）/.trash 移动
  - `notes-service.ts` — CRUD 语义（唯一写入口）：create/get（永远读文件同步刷索引）/list（走索引）/update（tags/links 整体深替换）/append/remove 软删除/restore/purge/listTrash/search（tag 精确 + query 标题正文不区分大小写）；写后广播 notesChanged；note-types.ts 为 types/note.ts 主进程镜像
- `task-store.ts` — 协作任务存储层（`.dogear/tasks.json`，version 2，读时幂等迁移 v1：backlog→plan）：八状态机（rejected=执行前确定性拒绝，interrupted=执行中意外中断交用户手动处置，两者均可被申报回写 review；新边 running→interrupted、rejected→review、interrupted→review/queued/plan/done）+ createTask（upsert：plan 态同标题命中则补 planPath 不新建；planPath 可选=占位）/listTasks/listDeletedTasks（软删过滤，deletedAt 倒序）/listTasksGrouped/getTaskDetail（占位任务 planContent null 无 planError）/reviewTask/markTaskRunning/completeTask/rejectTask/interruptTask（running→interrupted，result=中断原因）/reportTaskResult（按 execSessionId 原子查找 running/interrupted/rejected 迁移 review，未命中返 null）/appendResultNote（结果摘要留痕追加进 result，不改状态）/executeTask（plan/backlog/interrupted→queued）/completeTaskManually（plan/backlog/rejected/interrupted→done）/moveTaskToBacklog（plan→backlog）/moveTaskToPlan（done/rejected/interrupted→plan）/softDeleteTask/restoreTask/purgeTask/recoverInterruptedTasks（无条件 running→interrupted 不自动重跑，返回 {recovered, recoveredTasks}）；原子写 + 文件锁；lastActiveAt 心跳已删不再写入
- `task-service.ts` — 协作任务广播包装层：create/review/markRunning/complete/reject/interrupt/reportResult/appendResultNote/execute/completeManually/cancel/move/delete/restore/purge 透传 task-store 并广播 tasksChanged（reportTaskResult/appendResultNote 仅命中才广播）；recoverInterruptedTasks 无条件 running→interrupted 返回 {recovered, recoveredTasks}（>0 广播）
- `task-queue.ts` — 任务串行队列执行器（drain 循环一次跑一个 queued 任务）：取任务先验 planPath（缺失或文件不存在 → 拒 rejected「任务尚无 plan 文档」，占位任务拦截）→ origin 会话查询带退避重试（1s/5s/15s，防会话索引跨进程并发写窗口的瞬时缺失误拒；拒绝理由区分：无 originSessionId/重试后仍查不到/无话题）→ 创建执行会话（role='main'）→ markTaskRunning（此后意外中断走 safeInterrupt→interrupted，之前确定性拒绝走 safeReject→rejected）→ 按任务提示词实施（提示词约定先调 dogear__ReportTaskResult 申报 + <task-result> 标签备用）→ 结果写回（写回前重查防双写：review=已申报跳过，running=completeTask 兜底写回，其他状态=留痕 appendResultNote+通知丢弃）→ review + 系统通知；超时兜底 session.interrupt 后 60s 仍不收尾则 Promise.race 强制放行解锁队列（sendMessage 挂死不拖死后续）；recoverAndStartTaskQueue 启动无条件 running→interrupted + 逐任务带申报引导句的中断通知；kick() 唤醒，service 层不 import 队列避免循环依赖，由调用方 tipc/工具层 kick
- `migrate-notes-todos.ts` — 待办实体退役迁移（启动 fire-and-forget，幂等）：todos.json 人待办 → 笔记正文勾选项（带 noteId 且笔记存在 appendNote 并入尾部，否则 createNote 新卡 tags ['待办']；done → `- [x]`、due → 行尾 ` 📅 YYYY-MM-DD`）；跑完 todos.json 原子改名 .migrated 防重跑；单条失败 warn 跳过
- `skill-service.ts` — Skill 管理服务：`listSkills(workspaceId)` 扫三源目录的 SKILL.md（builtin `resources/skill-templates/` 只读模板；custom `.dogear/skills/` 全局目录，与工作区无关；user `~/.claude/skills/`）标注 source + enabled（enabled 按传入 workspaceId 的 enabledSkills，null 时全 false）；`setSkillEnabled` 读写 workspace-config 的 enabledSkills 数组
- `article-parser-skills-service.ts` — 网络文章解析 Skills 和 MCP 工具定义；运行时目录 `.dogear/article-parser/`（`getArticleParserSkillsDir()` 同步解析 + 旧目录存在性回退），`ensureSkillsInitialized` 首跑 `migrateLegacyDirs()` 一次性整目录迁移（旧 `.dogear/skills/article-parser/` rename 到新目录，幂等，失败仅 warn 不抛）
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

- `pi/model-catalog.ts` — pi-ai 十个厂商目录（anthropic/openai/deepseek/zai/moonshotai/minimax/qwen-token-plan/xai/google/kimi-coding）合并的上下文窗口查表：`lookupContextWindow(modelId)` / `lookupCatalogEntry` / `FALLBACK_CONTEXT_WINDOW=200_000`；渲染层同源副本 `lib/pi-model-catalog.ts`（tsconfig 隔离无法共享，另有 `resolveModelWindow(entry)` 手填优先解析与 `parseContextInput` K/M 输入解析）；piModels 条目可带 `contextWindow` 手填窗口（主进程 provider 构造/usage 提取均按「手填 &gt; 目录 &gt; 200K」解析）

- `pi/run-once.ts` — pi 的一次性任务执行器：`runOnce({ systemPrompt, prompt, tools, model, profile, signal, maxTurns=30, onLog })`。**不抛出**，失败以 `{ ok:false, error, cancelled? }` 返回。pi 的 loop 故意没有轮次上限，这里在 `subscribe` 里数 `turn_start` 超限调 `agent.abort()`；`tool_execution_end` 带 `isError` 时以 `[tool-error]` 前缀走 onLog（四个 handler 都按该前缀落 WARN 级日志）

- `pi/tool-adapter.ts` — 运行时中立的工具定义层：`defineTool` / `ToolDef` / `toSdkServer`（给 SDK）/ `toPiTools`（给 pi，走 `z.toJSONSchema()`）。工具 handler 一律沿用 `isError: true` 约定，`toPiTools` 负责在 pi 侧翻转成 `throw`。自定义工具名自带 `dogear__` 前缀（与基础工具隔离名字空间），pi 侧不带 `mcp__server__` 前缀

- `pi-session/` — **主会话（及其派遣的子会话）运行时门面**，基于 pi-agent-core 的 AgentHarness：

  - `pi-session.ts` — `PiSession`（EventEmitter）：唯一门面类，`start()` 组装 systemPrompt/工具集/权限映射并创建 `PiHarnessAdapter`，skill 索引扫三源（builtin 模板 / custom `.dogear/skills/` 全局目录 / user `~/.claude/skills/`）按工作区 enabledSkills 过滤后拼 `<available_skills>`，子会话再按 Profile enabledAbilities 过滤（builtin 源看 skills[]、custom 源看 skills[]、user 源看 customSkills[]；工具包挂载含 browser（createBrowserToolDefs 透传 workspacePath 供 save_article 落库）/extension（ab.extension===true → createExtensionToolDefs）能力域分支）；`sendMessage`/`steer`/`interrupt`/`requestPause`/`close`/`setPermissionMode`/`respondPermissionRequest` 覆盖完整生命周期、插话、权限确认、usage 采集；turn 粒度暂停（`requestPause` 置 adapter 标志，当前 run 正常收尾后进 paused 独立状态：`isPaused()` = 标志已置位 && 非 running；paused 态 sendMessage = 清标志 + prompt 即恢复，interrupt = 取消暂停并清插话队列，异常收尾不进 paused 回 idle）；非 steer 发消息前按 `contextWindow×autoCompactPercent%` 阈值自动压缩（emit 'compacting'/'compact_boundary'，失败仅提示不阻断）
  - `pi-session-manager.ts` — `PiSessionManager`（单例 `getPiSessionManager()`）：conversation-runtime-service 唯一入口，引用计数式生命周期（`retain`/`release` 归零即销毁——running 时入 orphan 保活等 settled 后 maybeCollectOrphan 回收，无跑步机保活），`_destroySession(sessionId, source)` 区分自然销毁/强杀：natural 时对绑定的 conversation 逐个 fire-and-forget 通知调度器 handleSessionClose（on_session_close 触发点，failedover/closeSession/closeAll 均 forced 或不走此路不触发），`bindConversation` 维护 conversationId↔sessionId 映射，订阅 PiSession 事件转发到渲染层
  - `pi-session-repository.ts` — `PiSessionRepository`（单例）：按 workspaceId 缓存 `JsonlSessionRepo` 实例，封装 `create`/`open`/`delete`/`fork`/`getSessionPath`，session 根目录固定 `<configDir>/workspaces/<workspaceId>/sessions/`
  - `pi-harness-adapter.ts` — `PiHarnessAdapter`：构造 `AgentHarness` 并做事件订阅分发，暴露 `prompt`/`steer`/`compact`/`abort` 与暂停标志控制（`requestPause`/`clearPause`/`isPauseRequested`，经 `shouldStopAfterTurn` 回调在 turn 边界生效），是 pi-session.ts 与 Harness 裸类型之间的唯一隔离层（Harness 类型不得外泄）
  - `message-converter.ts` — `convertPiEvent(event)`：把 pi `AgentEvent` 转成前端 `ExtendedSessionMessage`，供 PiSession 实时消息流使用
  - `history-adapter.ts` — `buildSessionHistory(workspaceId, sessionId)`：把 Harness branch entries 转成前端 `HistoryMessage[]`，唯一数据源是 session-history-reader.ts
  - `transcript-adapter.ts` — Harness 版逐字稿清洗：`cleanMessagesFromEntries` 去噪 + 工具骨架化，`readCleanTranscript` 提供 tail/range/uuid 三种切片读取，`buildSessionUuidIndex` 供组卡引用保真度校验，对齐旧 SDK transcript-cleaner 语义
  - `session-history-reader.ts` — `readSessionBranchEntries(workspaceId, sessionId)`：读取 Harness session 当前 branch 的唯一入口，其他模块不得直接解析 JSONL 或触碰 Harness 内部对象
  - `permission-mode.ts` — `PiPermissionMode` 类型定义（`default | autoExecute`）
  - `permission-rules.ts` — 基础工具权限判定纯函数：`isBasicToolName`、`getBasicToolPermission`、`decideToolPermission`（autoExecute 放行 / 工具包放行 / 基础工具按快照映射 / 其余 ask）
  - `skill-loader.ts` — 薄封装 pi-agent-core 的 `loadSkills`/`formatSkillInvocation`：`loadSkillIndex` 扫描目录产出 `SkillEntry[]`，拼 `<available_skills>` 索引文本，`createSkillTool` 提供懒加载 Skill 工具
  - `builtin-tools.ts` — `createBuiltinFileTools(options?)`：Read/Write/Edit 复用 pi-agent-core 官方工厂；bash 双轨（`createPtyBashTool`，schema 兼容 command/timeout + run_in_background——falsy 透传委托原版零变化，truthy 调 pty-service.createTerminal 后台起终端立即返回 terminalId）+ read_terminal（无参=本会话终端概览，带 terminalId=stripAnsi 后尾部 8KB 快照）/kill_terminal（校验归属后杀）；conversationId/workspaceRoots 由 pi-session 组装时闭包注入；错误用 throw（AgentHarnessTool 层无 isError 字段，agent-loop 只在 execute throw 时置 isError）
  - `search-tools.ts` — `createSearchToolDefs(workspacePath)`：手写 Glob/Grep 工具，路径边界委托 workspace-boundary.ts
  - `usage-extractor.ts` — pi usage 采集：`accumulatePiUsage`/`extractPiUsageEntry`/`extractPiContextSnapshot`，字段映射对齐旧 SDK 口径供前端 usage 徽章零改动复用
  - `workspace-boundary.ts` — `resolveWithinWorkspace(workspacePath, candidatePath)`：路径边界校验（含符号链接逃逸拦截），供内建/搜索工具与 workspace-execution-env.ts 共用
  - `workspace-execution-env.ts` — `WorkspaceExecutionEnv`（实现 `ExecutionEnv`）：委托官方 `NodeExecutionEnv` 做实际文件 IO/子进程执行，每个带路径参数的方法前加边界校验；`createTempDir`/`createTempFile` 创建的 temp 路径记入白名单（bash 输出溢出暂存的 appendFile/readTextFile 不拦截）

- `delegation-bridge.ts` — **子会话调度站核心状态机**（单例，所有 child 会话的检测/重调/降级都经此；状态只存内存，重启即失）：状态模型（childStates 内存 Map，快照 status ∈ {running, stopped}，另带 delivered 单调交付事实 / 内部 terminalReason 死因 / consecutiveFails 连续失败计数，success 清零上限 3）；检测（wireSession 挂子会话 message 流 + createIdleWatch 滑动无进展计时 + timeout 双计时器，10 分钟无流事件判 hang）；重调（settleTerminal 终态统一结算：transient 在 MAX_RETRY 内自动 resumeChild 复活原会话，quota 错误沿全局 failover 链（settings.failover）findNextFailover 跨供应商降级，开关关闭或链耗尽直接终态通知）；降级（不重调的终态 notifyTerminalToWaiters 带结构化通知 {errorClass, attempts, modelTried} 秒级唤醒父会话的 dogear__WaitForMessage）；另导出 startChild / stopChild / markChildDelivered / getChildrenByParent（内存为主 + conversation-service listByParent 补集合并，补集按 updatedAt 降序只保留最近 10 条，转 stopped/delivered=false 快照）/ waitForMessage / deliverMessage / abortWaitsForParent（前端「中断等待」按钮：取消该父会话全部等待并终止其运行中子会话）/ cleanupLegacyStateFile（启动时一次性删除旧 delegation-state.json 遗留文件）

- `delegation-idle.ts` / `delegation-terminal.ts` / `delegation-resume.ts` / `delegation-lifecycle.ts` — 调度站纯逻辑层：滑动 idle 计时（createIdleWatch，超时可注入）/ 错误分类（classifyDelegationError：quota 关键词表 + MAX_RETRY + isNotifiableTerminal + buildTerminalNotice 通知文案）/ 重调决策（decideResumeOnError + buildResumePrompt 续跑提示词；quota 降级入口是 model-failover.ts 的 findNextFailover，不再从 subAgent.profiles 找 fallback）/ 完成事件分类（classifyChildCompletion → no_delivery/failed/cancelled）

- `model-failover.ts` — 模型故障转移（主/子会话共用一套全局 failover 链）：`findNextFailover(chain, currentProfileId, tried)` 纯链查找（顺位下一个未试且非当前的供应商，当前不在链走链头，全试尽返回 null 耗尽）；`maybeFailoverMainSession` 主会话编排——tipc/agent.ts 的 broadcaster complete(failed) 钩子进入，quota 且 failover.enabled 且链有下一个时 updateModelSelection → detachByConversationHolder('desktop') 销毁旧 session → attachConversation 以新模型重建 → failoverNotice 广播（前端 AgentChat 黄色提示条）→ fire-and-forget 续跑提示，per-conversation failoverTried 防回摆（complete(success) 清空）；子会话不进该编排，delegation-bridge.decideResume 只取 findNextFailover 沿链降级（tried 从 modelTried 解析 profileId 集合）

- `session-append-templates.ts` — 系统级 append 段模板集中处（REFERENCE_APPEND / groupAppendFor / NOTES_GUIDANCE_APPEND / subAgentContractFor），buildSystemPrompt 直接引用；末尾 getSystemPromptSegments() 收集 6 段模板 + 触发条件说明供设置页只读预览

- `agent-query-config.ts` — 共享的 SDK `query()` 配置构建器 + 设置读取入口（无 electron 依赖，Worker 线程内安全导入）：两类调用方共用——`PARSE_ARTICLE` 用它构建真正的 SDK query() 配置（主会话已迁移到 pi-session/，不再依赖本文件）；`GROUP_DIGEST`/`REVIEW`/`CATEGORIZE`/`CATEGORIZE_ORGANIZE` 四条 pi 后台任务只借用 `buildQueryBaseConfig` 读取 `appSettings`，再喂给 `pi/provider.ts` 的 `resolvePiModel`，本身不发起 SDK query()

- `task-types.ts` — 任务类型（SUMMARIZE/PARSE_ARTICLE/GROUP_DIGEST_SESSION/REVIEW_SESSION/CATEGORIZE_SESSION）和消息定义（含 ExtendedSessionMessage、各 Payload 源定义；GroupDigest/Review/CategorizeSessionPayload 用统一 modelSelection?: ModelSelection 字段；GroupDigestSessionPayload 携带 groupId + dirtyConversations\[\] + hasExistingCard）

- `logger.ts` — 日志工具（mainLogger / workerLogger / createTaskLogger）

- `tools/tool-registry.ts` — 工具注册表（SDK 内置工具 + 自定义工具注册，IPC 查询供设置页/代理编辑页动态加载）

- `tools/article-tools.ts` — 文章阅读工具（dogear__ReadArticle / dogear__ListArticles）

- `tools/browser-tools.ts` — 受控浏览器 MCP 工具（dogear-browser server，跟随 browser 能力域，组内 11 工具）：声明式入口 dogear__browser__readArticle（复用 browser-article-service，need_login 引导人工登录；入口对扩展绑定站点 controlledBrowserBlock 直接拒绝）+ dogear__browser__search（复用 browser-search-service，从设置读 browserSearchEngine/browserProxyServer 传入；P3 加可选 `site: 'reddit'|'zhihu'` 站内引擎——需要互动量排序时用，站内失败自动降级 site: 通用链，结果带 meta 行；工具描述含登录态敏感提示：知乎未登录空结果 / Reddit 未登录跳登录页，降级原因提到登录或空结果时提示用户人工登录一次后重试，2026-09-08 Step 1）+ 原子探索 8 工具（navigate/observe_page/click/fill/read_text/wait_for/screenshot/close，ref 编号定位、单步 30s 超时）+ dogear__browser__save_article（B 项：读→存闭环，{title,url,content,author?,siteName?,excerpt?} 直调 saveArticleFromScript，返回「已入库：{title}（N 字，id uuid）」，workspacePath 由调用方显式传参——多工作区不落错库，rawHtml 传空串落盘空文件）；全部动作经 setBrowserToolsActionListener 转发（source=readArticle|search|navigate…|save_article）
- `tools/extension-tools.ts` — 浏览器扩展 MCP 工具（dogear-extension server，跟随 extension 能力域，P2 起 5 工具、P3 加 read_state 成 6 工具、2026-09-08 browser-exploration 加 site_knowledge/site_finding 成 8 工具（实现在 extension-site-tools.ts，deps 注入）；主文件 715 行）：dogear__extension__{navigate,observe_page,click,fill,read_text,read_state,site_knowledge,site_finding} 作用于用户真实浏览器的已连接标签页（描述首行统一声明「仅限已授权域名、拦截提交类操作、同一时间仅一个会话可用」+ 双链路引导「需登录态站点优先本工具组，公开网页用 dogear__browser__*」），zod schema 与一期受控浏览器同名同义；**P3 独占 gate**（acquireGate：全部 handler 入口最前，断连 resetChannel → 有 conversationId 时 acquireChannel，busy → result='busy' isError 不排队；action=null 的非页面操作——站点档案读写——busy 不记动作流）；observe_page 链接元素带 href（IDL el.href 绝对 URL 截 400，可传 navigate 直达）；read_state 读页面 __INITIAL_STATE__（双模式：无 path 顶层概要 / path 点分下钻 8000 截断，扩展侧 world:'MAIN' 注入；预算按 conversationId×页面 URL 去重计 1 次，命令成功+风控扫描通过才计数）；执行体统一走 `runCommand` → sendExtensionCommand，失败经 `ERROR_MESSAGES`（13 个 errorCode 全覆盖中文映射）转 isError 不抛异常（navigated_away/ref_expired 拼接 currentUrl、navigation_blocked 非授权类 detail 走「无法导航：{detail}」）；navigate 支持小红书搜索直达 URL 提示，成功文案尾部拼站点档案指针（siteKnowledgePointer：有档案域名提示先读档案，无档案域名提示可用 site_finding 沉淀）；**站点策略门控**（policyGate/navigateGate，顺序：独占 gate → 风控前置拒绝 → 预算检查 → 随机延迟 → 命令 → 结果风控扫描 → 计数；site_knowledge/site_finding 读写站点档案无页面交互，不过 policyGate；observe/read_text/read_state 结果过 riskKeywords 命中即 isError + 会话级域名标记，预算超限返回含已用/剩余额度的结构化文案）；动作流 recordBrowserAction 直调（source='extension'，带 conversationId/urlBefore/urlAfter/errorCode/durationMs）
- `tools/extension-site-tools.ts` — 站点档案 MCP 工具（dogear-extension server 同组，2026-09-08 browser-exploration 计划 Step 3 自 extension-tools 拆出）：`siteKnowledgePointer(url)`（normalizeDomain 后判断 `.dogear/site-knowledge/{domain}.md` 存在性，返回 navigate 成功文案尾部指针——仅在有档案时提示先读档案，无档案返回 null 不加提示）+ `createSiteToolDefs(deps)`（deps 注入 readSiteKnowledge/appendSiteFinding）：dogear__extension__site_knowledge（读站点档案，无档案域名正常空态非错误）/ dogear__extension__site_finding（追加探索发现区：单条 ≤500 字、60s 内相同内容去重、isError 中文文案不抛）

- `tools/notes-tools.ts` — 笔记卡片 MCP 工具（dogear-notes server，主会话且绑定工作区时挂载：dogear__CreateNote / dogear__GetNote / dogear__SearchNotes / dogear__AppendNote / dogear__UpdateNote / dogear__DeleteNote 软删除；可实施工作分流见 dogear__CreateTask）；直调 notes-service 不绕 tipc；配合 session-append-templates 的 NOTES_DISCIPLINE_APPEND 存卡纪律（可实施工作一律走任务不存卡、方案落盘后 CreateTask 挂计划栏可占位、琐事备忘存卡片正文用 - [ ] 勾选项）
- `tools/task-tools.ts` — 协作任务 MCP 工具（dogear-tasks server：dogear__CreateTask（默认落计划栏，planPath 可省略占位，同标题 plan 态自动补路径；autoExecute=true 先落 plan 再 executeTask 两步入队）/ dogear__ListTasks（八态过滤，plan 计划 / backlog 待办 / interrupted 已中断）/ dogear__ExecuteTask（plan/backlog/interrupted→queued + kick，占位任务即时报错）/ dogear__ReportTaskResult（执行会话按 conversationId 归属申报结果→review；已回写提示不重复，非执行会话 isError））

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

- `tools/group-tools.ts` — 会话组共享区 MCP 工具（dogear-group server：dogear__ListGroupFiles 默认列清单（relPath+大小+修改时间）、传 relPath 读单文件全文 / dogear__SaveSharedNote；供 working agent 主动写 `_notes/` 阶段总结）

- `tools/reference-tools.ts` — 引用会话 / 组背景 MCP 工具（dogear-reference server，**只装到子会话**）：dogear__ReadReferenceSession 读任意 sessionId 的去噪原文（可尾切 / 区间切，可选 workspaceId 跨工作区定位——不传走 closure 会话所属工作区）/ dogear__ReadGroupBackground 读本组 background.md 结构化字段 / dogear__ListSiblingSessions 列组内兄弟会话；主 agent 靠 dogear__CreateSession 派子会话消化后回摘要，避免污染主上下文

- `tools/delegation-tools.ts` — Agent 协作 MCP 工具（dogear-delegation server）：

  - 主会话工具集：`dogear__CreateSession` / `dogear__CreateSessionBatch` / `dogear__SendMessage` / `dogear__WaitForMessage` / `dogear__ListLinkedSessions` / `dogear__ResumeSession` / `dogear__StopSession`
  - `dogear__CreateSession(task, outputPath, title?, profile?, model?)` / `dogear__CreateSessionBatch(items[])` — model 为模型 ID 单字符串，bridge.resolveModelByTier 在所有完整 ModelProfile 的 piModels 里解析出 profileId+tier（找不到则报错并列出可用模型）；模型优先级 spec.model &gt; profile.modelSelection &gt; 主会话模型 &gt; 全局默认
  - 子会话工具集：`dogear__SendMessage` / `dogear__WaitForMessage` / `dogear__ListLinkedSessions`（无 Create\*/Resume/Stop，不能派孙子）
  - `dogear__SendMessage(toSessionId, message, options?)` — options.delivery=true 标记交付；工具层先过 `hasDirectContractChannel` 校验（仅直接派出关系）
  - `dogear__WaitForMessage(fromSessionIds[], timeoutMs?)` — 不按 delivery 过滤，取第一条到达消息返回；等待中子会话终态时会先收到结构化终态通知（死因 + 重试次数 + 降级轨迹）而非干等超时
  - `dogear__ResumeSession(sessionId)` — 调起中断/失败的子会话续跑（复用原会话消息历史不新建副本，走 bridge.resumeChild；仅限本进程运行时跟踪中的子会话，重启后内存跟踪丢失则报错）；重试/quota 耗尽的终态通知文案会引导用它
  - 子会话交付 = `dogear__SendMessage(父sessionId, summary, { delivery: true })`，内部触发 bridge.markChildDelivered 同步 childStates 状态机与 UI 事件

- `tools/review-tools.ts` — 首页报告 MCP 工具（dogear-memory-review server：dogear__ListDigests / dogear__ReadDigest / dogear__TraceSource / dogear__ReadReport / dogear__WriteReport）；零分析逻辑，分流靠提示词。配合 dogear-memory 的 dogear__RecallMemory/dogear__SaveMemory/dogear__ForgetMemory 实现「记忆 + 报告」双层写入

- `tools/category-tools.ts` — 智能分类 MCP 工具（dogear-smart-category server：dogear__ListCategories 含样例组标题 / dogear__SaveCategoryJoin { categoryId, addAnchorTags? | replaceAnchorTags? } / dogear__SaveCategoryNew { name, anchorTags, redistribute? } 校验上限 / dogear__SaveCategoryMerge { fromIds (length=2), name, anchorTags } / dogear__PruneCategoryTags；三个 Save\* 拆开是因为 GLM 等国内 Anthropic 兼容层不吃 discriminatedUnion 的 oneOf 和 tuple 的 prefixItems，全平台通吃；**单引用语义**：dogear__SaveCategoryJoin/dogear__SaveCategoryNew 先 removeGroupEverywhere 再加入，一个组只在一个分类；append 决策日志，入参和落库全用 groupId）

> 组提炼链路：触发已迁移到调度器（内置任务 group_digest / review 的默认触发器：03:00–05:00 窗口 / 应用启动 / 会话自然销毁（on_session_close，触发点在 pi-session-manager.\_destroySession，主窗口关 tab / 独立窗口 / orphan 跑完回收统一覆盖，failover 换血与强杀不触发）三触发点，见 `services/scheduler/`；带 triggerContext 时走 triggerByConversation 精准提炼单组，否则全量扫描；停止 / 立即运行 / 整批重跑入口已收敛到定时计划，tipc digest.ts 路由保留供单组重跑与调度器复用）→ 内置任务 group_digest 调 group-digest-scanner 扫脏 → group-digest-trigger 串行起 GROUP_DIGEST_SESSION 任务，payload 携带 groupId + dirtyConversations\[\]（每条含 conversationId/sessionId/mtime）+ hasExistingCard（活动状态采集含 taskId，供整停链路取消当前任务；数据中心组卡面板 2s 可见轮询组卡列表）→ agent-worker.handleGroupDigestTask 走 pi `runOnce`（按 payload.modelSelection ?? settings.digestModelSelection ?? settings.defaultModelSelection 走 resolvePiModel，方案不完整即返回明确 error；接 AbortController，cancelGroupDigest → agent.abort() 真正中断）→ agent 自调 dogear__CleanTranscript（对 dirty 会话逐个去噪）+ dogear__ReadGroupDigest（拿上次组卡 summary/items/keyOutputs 增量参考）+ dogear__ListGroupFiles（拉 `_notes/` 阶段总结、子会话 dogear__SendMessage delivery 产出）+ dogear__SaveGroupDigest（新组卡覆写，工具自动合并 sourcesSeen）→ 组卡落 `<configDir>/workspaces/<wsId>/groups/<groupId>/digest.md`。**dogear__SaveGroupDigest 落盘前过 source-fidelity 校验**：items 里每个 `sessionId#uuid` 必须真实存在于去噪逐字稿，否则拒绝落盘并回告 agent 哪条错、错在哪（wrong_session 直接给出正确 sessionId）。子会话（role='sub'）不进 sourcesSeen，其贡献通过 dogear__SendMessage delivery 汇入父会话产出。

> 首页报告链路（历史代号 review）：脏检查（review-scanner.isReportStale：最新组卡 updatedAt &gt; 报告 updatedAt）→ review-trigger 串行起 REVIEW_SESSION 任务 → agent-worker.handleReviewSessionTask 走 pi `runOnce`（同样按 reviewModelSelection 三级 fallback 走 resolvePiModel，可取消）→ agent 自调 review-tools（dogear__ListDigests/dogear__ReadDigest/dogear__TraceSource）+ memory-tools（dogear__RecallMemory/dogear__SaveMemory/dogear__ForgetMemory）做**分流**：沉淀/有价值结论/注意事项进**记忆**（详细全集），需用户主动处理的待办/中断/搁置的简述进**报告**；最终 dogear__WriteReport 落 `dashboard.md`。笔记面板「报告」mode 的 ReportSection 用 MarkdownRenderer 渲染 dashboard.md 给用户看；dashboard-watcher 监听文件变化推事件到前端；普通会话里说"聊聊首页"也能触发同一 skill。

> 智能分类链路（按组）：group-digest-trigger 任务成功保存组卡后 → chainCategorize 检查 smartCategory.enabled + 组卡 tags 存在 → category-trigger.triggerCategorize(workspaceId, groupId, groupDigestPath) 串行起 CATEGORIZE_SESSION 任务 → agent-worker.handleCategorizeSessionTask：Step A 跑 matchByThreshold 阈值匹配（0 LLM），命中即 push 到对应分类记 'match'；无匹配则上 LLM（走 pi `runOnce`，按 categorizeModelSelection 三级 fallback 走 resolvePiModel，可取消）→ agent 自调 category-tools（dogear__ListCategories 看现有分类 + 样例组标题 / SaveCategory 决策 JOIN_EXISTING 或 NEW_CATEGORY，新建时附带 redistribute 候选迁移；入参用 groupId）→ smart-categories.json 落 `<configDir>/workspaces/<wsId>/`（category.groupIds\[\]）。outcome=match/join/new 时 broadcast categoriesUpdated，前端 useSmartCategoryStore 自动 reload。手动文件夹装 groupId（tree children 从 conversationId 改为 groupId），通过 conversations.ts 的 addGroupToFolder/removeGroupFromFolder/moveGroupBetweenFolders IPC 支持多引用。

> 模型选择链路：对话创建时 tipc 把 settings.ai.defaultModelSelection 浅拷贝到 conversation.modelSelection（fork 则继承父对话）→ ChatInputArea 输入框工具栏的 ModelSelector（按 Profile 分组、按 modelId 去重、空选时红字「请先选择模型」+ textarea/send 全 disable）→ 用户切换时 conversation-store.setConversationModelSelection 写库 + 同步顶层镜像 → useSendMessage 发送前 reconcile：null 拦截 toast、有变更则 client.setSessionModel(selection)；同 profile 换 tier 走 PiSession 快速路径，跨 profile 后端返回 needsRestart → triggerSessionRestart + 让用户重发；插话路径（pendingState!='idle'）跳过 reconcile 沿用会话原模型。usePendingState 派生 idle/running/flushing；StreamingIndicator flushing 态显示「队列还有 N 条插话待回复…」。

## 浏览器扩展（extension/，独立交付物，不进 tsc/eslint 工程）

- `manifest.json` — MV3：permissions 仅 nativeMessaging/activeTab/scripting/storage，**无静态 host_permissions**；`optional_host_permissions: ["<all_urls>"]`（商店审核友好申请形态，popup 手势按 origin 授权）；key 固定扩展 ID（jpabfficjncbbbkkdgjkhkmpmgehbfaa，与 NM 注册 allowed_origins 一致）
- `popup.{html,js}` — 连接/授权 UI：connect 按钮（tabs.query active tab → runtime.connectNative）+ 授权区（originFromUrl 白名单 http/https/ftp/file，非 http(s) scheme 显示「此页面无法按域名授权」；已授权显示「已授权 ✓ + 撤销」；request/remove 均在 click handler 手势内直调，完成后 sendMessage(dogear_permission_changed) 通知 SW，3s 轮询 getAll 兑底刷新）
- `src/background.js` — SW 命令分发中枢：hello（protocolVersion:2）建连 → 收 command 走 handleCommand（stale_tab → 未知 kind stale_protocol → tab_closed → navigated_away → 注入执行）→ `executeScriptWithTimeout` 8s 超时竞赛（点击导航会销毁注入上下文，executeScript 永不 settle，必须外层兑底）→ click 丢失结果走 resolveLostClickResult URL 检测兑底（已导航 = 成功 verification:'lost'）→ command_result 回推（ok 严格布尔 + 12 值 errorCode + 中文文案）；observe/read_text 成功后顺带回推 tab_snapshot；`sendPermissionState`（permissions.getAll 归一化 → storage.local 冗余 → port.postMessage permission_state，连接时与 welcome 后双推 + onAdded/onRemoved + popup 通知多触发源）
- `src/dom-actions.js` — 四纯 DOM 注入函数（executeScript 序列化约束：函数体零模块作用域引用）：observeFn（选择器组 → 可见性 → region 三分 → text_filter → 清旧 ref 重打 `data-dogear-ref` e1..eN 120 上限）/ clickFn（guard_submit 三类拦截：button[type=submit]、input[type=submit|image]、form 内无 type button；400ms settle 验证 urlBefore/After + elementGone + 正文字数）/ fillFn（guard_password：自身 password 或祖先 form 内存在 password；contenteditable 分支；三原型 native setter + input/change 事件派发（React 受控组件必需）；回读不一致 value_mismatch）/ readTextFn（带 ref 读元素 / 无 ref 读正文容器最长者，8000 截断）
- `src/nm-protocol.js` — 帧编解码器（与 electron/main/services/browser/nm-protocol.ts 语义一致，不共享文件）
- 授权链路：popup 手势 permissions.request（optional_host_permissions）→ SW getAll 归一化 → permission_state 帧 → gateway authorizedOrigins（命令前置校验纵深防御，扩展侧 executeScript 注入失败二次拦截 permission_denied）→ 设置页只读 chip；授权列表存 storage.local 兑底（SW 冷启重连后自动恢复；gateway 重连即重置授权列表，依赖扩展重推）

## 测试基建（resources/）

- `resources/browser-eval/` — 受控浏览器评测集（runner 一律 node 执行，bun 下 patchright acquire 永久挂起；`DOGEAR_CONFIG_DIR` 临时目录隔离）：
  - `run-pipeline.mjs` — 零模型管线回归（27 断言：10 文章读取 + 1 antibot 分流 + 16 search——三引擎 mock 解析 / maxResults 裁剪 / 降级链编排 / parse_empty 路径 / 站内 site: 引擎与降级域名过滤；自建本地 http server 模拟 403 反爬、Google 验证页、空 SERP）
  - 冒烟脚本 11 个（node 逐个执行，从 dist 导入跑前先 build:electron；run-agent 另见 agent 基线）：site-policy 45 / extension-ownership 18 / observe-href 9 / nm-protocol 6 / nm-navigate 15 / nm-read-state 14 / nav-tracker 15 / stale-protocol 5 / profile-migration 11 / site-knowledge 26 / extension-site-tools 16，全 PASS 口径
  - `run-agent.mjs` — agent 基线采集（electron-stub hooks 进程内起 PiSession 子会话，便宜档模型启发式选中；断言 expect.found 标记 / expect.tools 必调用工具 / expect.minUrls 去重 URL 下限；--only / --model 可选）
  - `tasks.json` — 任务清单（pipeline / antibot / agent 三类；agent 含 6 探索任务 + 2 search 任务，search 类无 url 字段走真实搜索引擎）
  - `baseline.md` — 基线记录（管线 / agent / WebSearch 真实冒烟结果与已知限制，含 Google goto 降质形态限制）
  - 文章测试页 7 个（SPA 延迟注入 / 折叠正文 / 翻页×2 / 登录墙 / 懒加载 / 非标准容器）+ mock SERP 页 7 个（serp-google/-ddg/-bing/-reddit/-zhihu-dom/-zhihu-state/-bing-site-mixed，meta charset 必带）

## 数据存储（`.dogear/` 目录）

- `settings.json` — 应用设置（ModelProfile、Thinking、permissionMode 等）
- `workspaces.json` — 工作区索引（id、名称、路径、默认标记）
- `conversations.json` — 对话索引（id、标题、`sessionId: string | null`——Harness 会话稳定标识、`workspaceId`、`groupId`/`role`、分叉信息、modelSelection、usageSummary）
- `plans.json` — 定时任务存储（`{version:2, tasks}` 容器，一行一任务：触发器含 lastFiredAt/once.fired，runState 仅 cursorStartedAt 断点；首次缺失 seed 内置四任务；读到旧数组格式自动按任务拆条迁移；scheduler/plan-store.ts 经 safe-json 原子写）
- `run-history/YYYY-MM.jsonl` — 计划运行历史（任务级条目 + missed 错过条目，按月分文件，保留 3 个月自动清理；scheduler/run-history-store.ts）
- `conversations/` — 旧 SDK 主会话历史（迁移归档后的只读备份，不再回放/恢复，仅归档说明引用；新会话历史见下方 `workspaces/{workspaceId}/sessions/`）
- `usage/{conversationId}.jsonl` — 会话 token 用量明细（每行一条 entry 或 compact marker，删除对话/工作区时联动清理）
- `workspaces/{workspaceId}/sessions/` — 主会话（及子会话）的 Harness JSONL 会话文件，`pi-session-repository.ts` 的 `JsonlSessionRepo` 按其 cwd 编码子目录 + 时间戳文件名布局管理；`conversations.json` 的 `sessionId` 字段指向这里，不保存绝对路径
- `workspaces/{workspaceId}/groups/{groupId}/digest.md` — 组级摘要卡（frontmatter 含 groupId/title/createdAt/updatedAt/sourcesSeen\[\] + 概述 + 想法/注意/决策条目带回溯 sessionId#uuid + keyOutputs + tags）
- `workspaces/{workspaceId}/groups/{groupId}/background.md` — 组背景（结构化 frontmatter：topic / progress / keyDecisions / openQuestions）
- `workspaces/{workspaceId}/digests/_archive/{sessionId}.md` — 迁移前旧的会话级摘要卡备份（旧 `digests/` 仅剩 \_archive）
- `workspaces/{workspaceId}/dashboard.md` — 首页报告（frontmatter 仅 updatedAt + 给用户看的纯净 markdown 正文；记忆详细版另落 `<workspacePath>/.dogear/memory/`）
- `group-digest-prompt.md` — 组提炼提示词模板（全局单份，首次缺失自动播种，可编辑）
- `review-prompt.md` — 首页报告提示词模板（全局单份，首次缺失自动播种，可编辑）
- `categorize-prompt.md` — 智能分类提示词模板（全局单份，首次缺失自动播种，可编辑）
- `workspaces/{workspaceId}/smart-categories.json` — 智能分类索引（categories 列表，category.groupIds\[\]；recentDecisions 环形 20 条；schemaVersion=2 表示已迁移）
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
- **扩展命令链路**：agent 调 dogear__extension__* 工具 → 独占 gate（P3：acquireChannel，异 owner busy 直接拒；site_knowledge/site_finding 无页面交互，旁路后续站点策略门控与命令链路直调 service）→ 站点策略门控（命中域：风控前置拒绝/预算检查/随机延迟；navigate 另有 gateway 侧目标域校验）→ extension-tools.sendExtensionCommand → gateway 前置校验（not_connected/stale_protocol/permission_denied/navigate 目标域 navigation_blocked 快速失败）→ command 帧（NM pipe）→ nm-bridge worker → 扩展 SW handleCommand（navigate 真实导航 + URL 自动跟踪 bumpGeneration、ref 代际校验、竞态校验 + executeScript 注入，read_state 用 world:'MAIN' 读页面主世界）→ command_result → pending map resolve → 工具层中文文案返回；observe/read_text/read_state 成功后 SW 回推 tab_snapshot 驱动设置页状态行刷新；导航/SPA pushState 均由扩展 onUpdated 监听自动重采快照并递增 generation（agent 跨导航无需重连，旧 ref 被代际校验误杀强重 observe）；断连时 gateway handleDisconnect → resetChannel 清零独占（防通道粘滞）
- **股票分析**：AI 调用分析工具 → TypeScript handler → Python Bridge → Python 计算层（指标/筛选/公式/回测）→ 返回结果给 AI
- **公司公告抓取**：Agent 调 dogear__ListAnnouncements → announcement-service 查/懒抓 orgId 映射 → POST 巨潮 `hisAnnouncement/query` → 返回列表 markdown；Agent 选一条调 dogear__ReadAnnouncement → 命中 `<hash>.md` 直返 / 未命中下载 PDF → python-bridge `parseAnnouncementPdf` (pdfplumber) → 组装 markdown → 写 `<hash>.md` + 追加 index.json → 返回 markdown