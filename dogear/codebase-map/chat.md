# 聊天域（chat）

聊天界面全链：主工作区/会话窗口/伴随工作台页面、会话列表与组、agent-chat 消息渲染、输入区、minimap、伴随面板（文件树/终端/话题）、会话数据层。

## 页面

- `app/page.tsx` — 主工作区 L 形框架：TopBar 顶栏 + ActivityRail 左栏 + 对话列表（conversationListOpen 且会话模式时 256px，整页模式动画收起但不覆写状态）+ 内容区（会话区直达顶栏下）；常驻挂载 NotesPanel/TasksPanelPage/DataCenterPage/ArchivePage/FeishuPanel/会话 tabs 按 activeTabId 切 display，DraftChat 按 activeTabId===DRAFT_VIEW_ID 条件挂载；CompanionPanel 草稿视图与会话 tab 渲染、哨兵 tab 不渲染；无工作区兜底态（欢迎/选择页）与加载态挂 TitleBar 拖拽条；任务通知点击（focusTask 事件）切工作区后跳任务面板选中任务
- `app/session-window/page.tsx` — 独立会话窗口（文件树+聊天+预览），selectConversation 成功后上报全局焦点
- `app/workbench-window/page.tsx` — 伴随工作台独立窗口（主进程单例），订阅 focusedConversationChanged 跟随全局焦点，跨工作区整窗切换

## agent-chat 组件（components/agent-chat/）

- `AgentChat.tsx` — 聊天主组件：组合 hooks+布局+工具轨道+Minimap；从 childrenByParent 派生等待交付展示态；历史加载三态 UI（骨架/错误/空）
- `ChatInputArea.tsx` — 输入区：引用芯片、图片附件（粘贴/拖拽/按钮三入口 + 5MB 上限，预览缩略图，发送转 base64 image 块）、工具栏（ModelSelector）、斜杠命令菜单、暂停/恢复按钮、暂停与等待交付状态行
- `MessageItem.tsx` — 单条消息渲染：长文本折叠、sticky 冻结、分叉/编辑按钮、跨会话注入消息卡（默认收起）
- `ContentBlockItem.tsx` — 内容块路由（text/tool_use/thinking/permission/askUser/compact_boundary）
- `StableHistory.tsx` / `LiveTail.tsx` — 历史区稳定渲染容器（transcript stable 队列渲染，防重排）/ 实时尾部渲染容器（live 队列追尾渲染）
- `ToolGroupBlock.tsx` / `ToolRow.tsx` — 相邻工具调用组合并块（ContentBlockItem 分发消费）/ 单工具行渲染（预览行+markdown-preview 联动）
- `MessageMinimap.tsx` — 消息小地图：轮次聚合、视口指示、跳转、hover 展开/固定
- `SearchBar.tsx` — 搜索浮条（Ctrl+F、匹配高亮、激活项自动滚动）
- `ThinkingBlock.tsx` — 思考块（compact/detailed 两模式）
- `StreamingIndicator.tsx` — 运行状态指示（基于 pendingState；flushing 态显示插话队列长度）
- `AwaitingDeliveryIndicator.tsx` — 等待子会话交付动效，点击=中断等待
- `SessionDispatchCard.tsx` / `TaskReportMessage.tsx` / `UserActionsCard.tsx` — 派遣卡（CreateSession 工具的消息卡渲染）/ ReportTaskResult 申报消息卡 / TrackUserActions 待办清单卡
- `CollapseControlBar.tsx` / `CollapsedHistoryBanner.tsx` — 历史折叠控制条 / 已折叠横幅
- `SearchHitBadge.tsx` / `SelectionActionTooltip.tsx` — 搜索命中徽标（块级命中描边+计数）/ 选中文字操作浮条
- `AskUserQuestionCard.tsx` / `PermissionRequestCard.tsx` — AskUser 问题卡 / 权限请求卡
- `shunt-suggestions.tsx` — 分流建议卡：ShuntAwareMarkdown 在 MarkdownRenderer 之前剥除/解析 shunt-suggestions fenced JSON 块，点卡展开补充输入、确认后直调 tipc executeShunt（代码直建会话/话题/笔记）+ toast 跳转，无 agent 执行环节
- `CollapsibleBlock.tsx` — 可折叠块基础组件
- `SubSessionDeliveredBanner.tsx` — 子会话交付完成横幅
- `session-tools.ts` + `AgentCommCard.tsx` + `injection-tags.ts` — 会话性质工具（SendMessage 等 agent 通讯/申报）拦截渲染为消息卡 + 注入 tag 配色
- `highlight.ts` / `minimap-utils.ts` — 搜索高亮工具 / 消息预览提取
- `path-link.tsx` — 路径胶囊基础设施：PathChip 可点弹浮窗（点击兜底校验与读盘均带 groupId，组共享区文件可点）、PathText 路径增强、useSharedRoot 拉组共享区根（extraRoots 来源）、useExistenceResolved 存在性校验（existenceCache key 含 groupId 防跨组串缓存）
- `path-resolve.ts` — 路径分段解析纯函数（path-link 底层）
- `workspace-id-context.tsx` — 会话所属工作区/组 Context（useWorkspaceId/useGroupId，AgentChat 从 conversation 挂 Provider；无 Provider 降级纯文本）
- `conversation-id-context.tsx` — 会话 id Context（与 workspace-id-context 并列）
- `turns.ts` — 轮次构建：轮次头优先级真人消息 > task-execution 注入 > 其他注入（注入仅上一轮头同为注入类才开新轮）
- `transformers.ts` / `types.ts` / `utils.ts` — 流式事件消费转换 / Message 类型 / 工具函数
- `hooks/` — useAgentSession（会话生命周期+pendingCount）、useSessionMessages（消息流）、useSessionEvents（权限/AskUser 事件）、useMessageHistory（历史加载，错误不静默清空可重试）、transcript 三层（transcript-core 纯 reducer / transcript-store 外部订阅 store / useTranscriptState 入口 hook：stable/live 双队列+init 屏障）、useImageAttachment、useSendMessage（发送/重发/分叉/权限响应）、useSlashCommands、useChatScroll（followMode 状态机）、useMessageSearch、useInterventionFocus（介入卡焦点定位，另见 browser.md）、useSubSessionDelivered（子会话交付事件订阅）、useTopicArchiveState / useUserActionChecklist（话题归档态/待办清单勾选态）、usePendingState（idle/running/flushing 派生）
- `tool-renderers/` — 工具块专属渲染器（Read/Glob/Grep/Skill/FileChange + ToolDetailShell 统一容器），由 ToolBlock 分发
- `usage-badge/` — 会话 token 用量徽章+Popover（上下文占用/累计消耗/逐轮明细；数据链路另见 data-center.md）

## 通用组件（components/）

- `TopBar.tsx` + `TopBarSearch.tsx` — 36px 顶栏通栏（根 drag + 按钮 no-drag 分区，负 margin 拉入 Windows WCO 条，双 flex-1 空白对称夹持搜索）：左通知中心 + 中上下文搜索 + 右工作台按钮与右栏折叠开关（最右缘，工作台窗口开启期间隐藏）；右侧挂 TopBarStatusBadge（任务执行中/排队数指示，浅橙 orange-500/15 底与会话运行态同色系、无转圈图标；ai.unattended 开启时覆盖显示「无人值守中」+ 点击快捷取消）；上下文搜索分发（消费 search-store 的 useActiveProvider：会话页 provider mode=conversation 桥接 conversation-search-store 驱动 AgentChat Ctrl+F 同一链路，含匹配计数/上下处；其余 hits 型 provider 同步过滤内存副本，防抖 150ms 弹命中下拉 icon+title+subtitle，onSelect 跳转定位；无 provider 页面 placeholder 退化「搜索」且输入框禁用）
- `ActivityRail.tsx` — 48px 左侧 rail（对话/笔记/任务/数据中心/归档/飞书 + 底部设置，激活项左侧 3px 竖条）：入口全接 store 哨兵动作；「对话」会话模式再点 = toggleConversationList，整页模式点 = 恢复 prevConversationView（草稿/会话，prev 失效落最近活跃会话 tab，全弹出时聚焦最近弹窗，无 tab 落草稿）；「笔记」笔记模式再点 = toggleNotesListHidden；笔记/数据中心弹窗打开时对应项 = 聚焦窗口

- `ToolBlock.tsx` — 工具块路由：normalizeToolName 归一后分发 renderer；标题行 Eye 快照预览按钮
- `WorkspaceExplorer.tsx` + `workspace-explorer/` — 工作区文件树（单区：dogear/articles 内 md 读 frontmatter 识别为文章节点，显示站点名/相对时间/解析状态徽章，点选进文章阅读模式，识别失败降级普通文件；拖放=移动、重命名/删除与普通文件同机制；树头部 URL 导入框临时位（任务面板接管后撤）与空库引导；文件/文件夹右键「历史」（git 能力检测通过才渲染）→ git-history-store 开历史面板）；树行/内联输入/树模型拆在 workspace-explorer/ 三文件（TreeItemRow/inline-inputs/tree-model）
- `FileHistoryPanel.tsx` + `file-history/HistoryDiffView.tsx` — 文件历史 Dialog（双栏：双源时间线（来源徽标 Agent/你/恢复前/外部）+ 行级 diff；影子快照可恢复：showConfirm → restoreSnapshot → toast+刷新文件树；UI 不写用户仓库；主窗口与会话窗口两宿主都挂载）
- `AdditionalFilesPanel.tsx` — 附加路径面板（多节手风琴，行尾 Switch 启停）
- `TopicPanel.tsx` — 话题 tab：共享文件列表（筛选/预览/引用/删除）；数据层另见 data-center.md
- `companion/CompanionPanel.tsx` — 五 tab 伴随面板容器（文件/附加/话题/阅读/终端），可被工作台窗口复用；宽度 localStorage 记忆
- `companion/TerminalPanel.tsx` — 终端面板：跟随/固定切换、我的/会话终端子 tab、reconcileActive 修剪失效锚点
- `companion/XtermTerminal.tsx` — xterm 宿主：tab 切换 attach/detach、历史灌入与实时流防乱序
- 浏览器等待人工卡（agent-chat/InterventionCard，会话消息流内）→ 见 browser.md
- `ConversationList.tsx` + `conversation-list/` — 会话列表（手动文件夹/近期<7天/更早/归档 tab 入口；ConversationRow 双层高亮 + 右键「关闭/稍后继续/重命名/引用/延续到新会话（tipc continueConversation：同组建新会话，首条消息带源 sessionId 与 ReadReferenceSession 指引）/删除」；子会话树形折叠）；定时运行/协作执行会话及其 agent 派出子会话不出现在列表（visibleConversationsOf 排除 schedulerTaskId/executor 及其 parentSessionId 命中的子会话，任务面板唯一入口；孙会话主列表由 hidden 组级过滤兜底）
- `ConversationSearchProvider.tsx` — 会话页顶栏搜索 provider（mode=conversation，isActive=非草稿视图且非哨兵会话 tab 且非弹窗会话）
- `archive/` — 归档 tab 页（左：话题卡/主会话行+子会话徽标/标题搜索/右键恢复·永久删除；右：DigestView 精简轮次流 input+结论，useTopicDigest 话题级缓存）；ArchiveSearchProvider 复用页内已拉话题列表同步过滤（不发 IPC），命中=清搜索框+展开+选中第一个主会话
- `group-list/GroupCard.tsx` — 组卡片（树形会话行、文件夹挂载菜单、删除二次确认）
- `agent-chat/DraftChat.tsx` / `StatusPulse.tsx` — 草稿会话视图（activeTabId===DRAFT_VIEW_ID 显式草稿视图，首条消息发送后落盘成会话）/ 状态脉冲
- `feishu/` — 飞书 Bot UI（FeishuPanel 主窗口哨兵 tab 页，单页二态：未配置显 FeishuSetupGuide 开放平台引导、已配置显双 tab（underline 风格）：「使用」默认（状态卡通栏 + 左栏群绑定两层视图（群绑定卡：工作区·话题·管理卡状态 Badge + 群内会话绑定列表）+ 右栏话题工作群卡片/通知推送开关/私聊命令）、「配置引导」常驻放完整 FeishuSetupGuide（8 步，第 4 步权限 JSON 批量导入——PermissionImport 一键复制 + 简短用途说明），凭证保存成功 toast 反馈），入口 ActivityRail 飞书项（官方 logo）；类型 `types/feishu.ts`（前后端共享：凭证/连接态/入站消息/群绑定嵌套结构，主进程镜像两处需同步）；哨兵 id `FEISHU_TAB_ID`（session-store，不落盘）
- 设置类组件（WorkspaceSwitcherPopover/WelcomeFirstRun/ModelSelector/MarkdownRenderer）→ 见 settings.md / infra.md
- `EffortSelector.tsx` — 努力档位选择器（ChatInputArea 与定时任务编辑页共用）
- `ErrorBoundary.tsx` — 路由级错误边界（App.tsx 全路由包裹）
- `conversation-list/DraftRow.tsx` / `RecentVirtualGroup.tsx` / `Toolbar.tsx` — 草稿行 / 近期虚拟分组 / 列表工具条

## Stores（stores/）

- `workspace-store.ts` — 工作区文件树状态（选中/CRUD/移动）；订阅 workspaceFilesChanged 重拉
- `conversation-store.ts` — 对话列表/选中/分叉/对话级模型；focusConversationFromLink；locateConversation 跨工作区定位会话统一入口（切工作区+开 tab+选中，通知/介入/顶栏搜索共用）；tab 焦点联动（revealTopic 定位话题、上报全局焦点）；四个运行态 Set 订阅后端事件
- `group-store.ts` — 会话组状态（groups/currentGroupId/expandedGroupIds；RECENT_THRESHOLD_MS 常量在此）
- `section-collapse-store.ts` — 列表分区折叠状态（近期/更早/子会话折叠区）
- `reference-store.ts` — 引用状态（文件/文件夹/会话/共享文件引用 + 选中片段；文章选字引用锚 articlePath 路径形态），closeTab 自动清理
- `slash-command-store.ts` — 斜杠命令合并与 capabilities
- `session-store.ts` — 多会话 tabs+activeTabId（值域 DRAFT_VIEW_ID/会话 id/哨兵 id）+prevConversationView（切哨兵前视图暂存，哨兵→哨兵不覆盖；回来落地/引用锚定/弹窗回退三消费点，消费后不清除）+lastFocusedNodeId；哨兵 tab 常量（NOTES/TASKS/DATA_CENTER/SETTINGS/ARCHIVE/FEISHU）+ DRAFT_VIEW_ID 草稿视图常量（不入哨兵集合，草稿属会话模式）+ isSentinelTabId/isInConversationMode 判定 + dataCenterTabOpen（localStorage 记忆）+ notesWindowOpen/dataCenterWindowOpen 弹窗态（弹出期间哨兵页隐藏；弹窗回退用 pickFallbackFromPrevView prev 优先、失效落 mostRecentTab 再落草稿，closeTab/fallbackActiveTab 用 pickFallbackConversationTab 纯 mostRecentTab）
- `search-store.ts` — 顶栏搜索 provider 注册表（SearchHit{ id,title,subtitle?,icon?,onSelect } / SearchProvider{ id,placeholder,isActive(),search(query),mode? }；模块级 registerProvider/unregisterProvider 后注册者优先，useActiveProvider 按 activeTabId 派生当前 provider；各页挂载时注册：会话页 ConversationSearchProvider / 笔记 NotesSearchProvider（纯笔记）/ 任务面板 TasksSearchProvider（另见 data-center.md）/ 设置 SettingsSearchProvider / 数据中心 DataCenterSearchProvider / 归档 ArchiveSearchProvider，飞书页无 provider 退化）
- `terminal-store.ts` — 终端前端（terminals Map、followMode/pinned、registerDataSink 收流注册）
- `git-history-store.ts` — 文件历史面板状态（open/target/gitAvailable + checkGitAvailable 幂等能力检测）
- `compact-collapse-store.ts` — 会话历史折叠状态（conversationId 级）
- `draft-store.ts` — 草稿视图状态与草稿图片（pendingImages）
- `handoff-draft-store.ts` — 浏览器移交草稿（整页/选中两种移交输入）
- `input-focus-store.ts` — 输入框聚焦请求（按 conversationId 寻址）
- `task-focus-store.ts` — 任务深链请求（任务通知点击落 requestTaskFocus，任务面板 CollabTaskSection 消费；另见 articles.md）
- `intervention-focus-store.ts` — 人工介入卡焦点跳转登记（主进程事件落窗；另见 browser.md）
- `tool-registry-store.ts` — 工具注册表前端（AgentChat/ToolGroupBlock 消费工具元数据）
- `markdown-preview-store.ts` — markdown 预览状态（path-link/tool-actions/ToolRow 主消费方）
- `feishu-store.ts` — 飞书 Bot 前端状态（配置信息/连接态/botStatus 绑定会话与候选列表/topicChatId/notifyPush），订阅 feishuConnectionStatus/feishuBotAutoInit/feishuBotBindingChanged 三事件

## lib / services

- `lib/conversation-sort.ts` — buildConversationTree 组内会话树纯函数（多层派遣链）
- `lib/reference-guard.ts` — 引用前置校验（跨工作区拒绝）、requireReferenceAnchorId/referenceNoteIntoFocus 锚定（哨兵页锚 prevConversationView，已弹窗/已关视为失效落当前工作区草稿伪锚，不兜底 mostRecent）、jumpToSourceConversation 跳来源会话
- `services/conversation-service.ts` — 对话索引 CRUD（`.dogear/conversations.json`，含 modelSelection/usageSummary 懒重算）
- `services/session-id-repair.ts` — 启动自愈：扫 null sessionId 会话按文件名时间戳回填
- `services/conversation-create-service.ts` — 建会话公共入口（默认组/默认模型装配，shunt、派遣、延续共用）
- `services/session-search-service.ts` — 跨会话+共享文件检索引擎（dogear__SearchSessions 后端：多词 OR、三类源优先级、预算三闸）
- `services/session-text-strip.ts` — 会话文本注入块剥离（topic-digest 与 session-search 共用口径）
- `services/topic-lifecycle-service.ts` — 话题/会话删除收口（会话文件+usage+索引联动删除）
- `services/workspace-search-service.ts` — 工作区文件名搜索（TTL 缓存索引，tipc/workspace 消费）
- `services/session-notification-service.ts` — 会话完成/权限系统通知+提示音（intervention-notify、task-queue、通知中心共用出口）
- `services/group-service.ts` — 会话组 CRUD（`.dogear/groups/{wsId}.json`），写后广播 conversationListChanged
- `services/group-shared-service.ts` — 组共享区文件读写（`.dogear/workspaces/{wsId}/groups/{gid}/shared/`），写后广播 groupDataChanged
- `services/auto-archive-service.ts` — 组自动归档（30 天；启动+每 24h）
- `services/topic-digest-service.ts` — 归档话题 digest 构建/落盘（`groups/<gid>/digest.json`：主会话轮次 input+最后文字结论；归档时预计算、浏览时缺失懒构建；注入判定与前端 utils.ts 语义对齐需同步维护）
- `services/focused-conversation-service.ts` — 全局焦点会话内存态（值变化才广播，跨窗口共享）
- `services/workspace-watcher.ts` — 文件树监视（递归 fs.watch 仅 rename，500ms 去抖广播）
- `services/workspace-fs-service.ts` — 文件树扫描与文件操作（安全路径验证）；create/rename/move/copy/delete 成功后自动触发影子 git 快照（可选尾参 workspaceId，fire-and-forget）
- `services/git-service/` — 双层 git 服务层：exec（execFile 封装+GitServiceError）/shadow（影子仓库：--git-dir/--work-tree 分离，workspaceId 级串行快照队列，add -A -f + exclude pathspec 绕过用户 .gitignore 覆盖私人文件）/user-repo（用户仓库读写+repo-busy 探测）/history（双源合并）；agent Write/Edit 快照挂钩在 pi-session/builtin-tools.ts（withSnapshot 包装）
- `services/pty-service.ts` — PTY 实例管理（node-pty，buffer 尾部 100K 封顶，事件上抛 tipc/pty.ts 桥接）
- `services/feishu/` — 飞书 Bot 主进程服务（唯一 Bot 渠道，微信 Bot 整链已删）：feishu-config-service（凭证 CRUD+连通性测试，`.dogear/feishu/config.json`，含 userOpenId/topicChatId/notifyPush 扩展字段）/feishu-client-service（@larksuiteoapi/node-sdk WSClient 长连接，自动重连/去重；p2p 全量 + group 仅 thread_id 话题消息放行，普通群静默；发文本/卡片/reply/建话题群/开话题/open_id 直发/card.action.trigger 回调分发（依赖 patches/ 下 node-sdk card 帧放行补丁，bun patchedDependencies 固化 1.74.0）/createGroupCardMessage 卡片实体群消息（即开新话题）/pin/unpin，pin 失败只记日志））/feishu-bot-controller（四期话题群模型：群=Dogear 话题、飞书话题=会话一对一；入口分流 p2p 与话题——p2p 单会话命令模型不变，话题内零命令纯聊；ensureThreadRuntime 懒绑定走群级 chatBinding（有 groupId 建会话、无则建 group+会话+upsertChat）、consumePendingBinding 待绑定续聊（查重/已删防御回退新建）、建群即发状态卡建管理话题+pin、230019 自动重开；message_id 幂等；首次私聊幂等记 userOpenId；/debug card 发回调链路测试卡）/feishu-card-controller（card.action.trigger 回调分发骨架：value.action 路由键查注册处理器，2.5s 超时保护先回空响应副作用后台继续）/feishu-card（Agent 回复 markdown 整段卡片 fallback：表格降级等宽块、4000 字符拆条）/feishu-cardkit（CardKit JSON 2.0 封装：createCard/batchUpdate/updateCard 实体三件套 + buildCallbackButton/buildButtonCard 构造 helper + 流式卡 create/content/settings，错误分类 degradable/transient）/feishu-status-card（状态卡：buildStatusCard 展示态/列表态/待绑定态构造 + sendStatusCard（unpin 旧→createCard→群消息→setManageCard→pin）+ refreshStatusCard（hash 去重、实体更新失败转重发自愈、inFlight 防重入），会话列表最近 20 条）/feishu-card-manage（manage.* 七处理器：ws/topic/conv 三组列表+点选 + back 回展示态，safeWrap 异常兜底 toast+回展示态）/feishu-stream-renderer（流式生命周期：占位卡→500ms 节流全量刷新→finalize 定格，20KB soft/28KB hard 分卡续写，reply 目标 resolveCtx(sessionId) 注入，begin 失败按 sessionId 记忆降级；finalize 返回是否定格，handleReply 对未定格且 text 非空兜底整段卡片补发——降级竞态/分卡中断不丢内容）/feishu-thread-service（threads.json v2 三层 binding：chatBindings 群→group（含 manageCardId/manageMessageId）/threadBindings 话题→会话一对一/pendingBindings 待绑定（TTL 10 分钟，set/consume 命中即删/peek 只读），v1 数据不迁移直接清空；sessionId 不落盘重启后幂等重建）/feishu-notify-outlet（通知中心推送出口：conversation 通知推绑定话题（230019 转私聊兜底）、其余 userOpenId 私聊文本，notifyPush 开关/未连接跳过/聚合更新不推）；Agent 回复监听在 tipc/feishu.ts 挂 sessionMessage/sessionComplete（isBotManagedSession 集合匹配：p2p active ∪ 话题绑定），bot 状态经 registerBotStateGetter 多注册进 tipc/agent.ts

## 注意

- 「先切后高亮」时序铁律：tab 属其他工作区时必须先 `await setWorkspace(目标)` 再 focusConversationById（conversation-store 唯一入口）
- running/pendingAction/paused/alive 四个 Set 的唯一订阅源是后端事件（sessionStateChanged/sessionClosed/aliveConversationsChanged），禁止前端乐观直写
- 列表刷新统一走 conversationListChanged 事件回环，写 action 内不手动 loadConversations
- 哨兵 tab（笔记/数据中心/归档/飞书）与草稿视图（DRAFT_VIEW_ID 查无 tab）不上报全局焦点，保持「最近焦点」语义
- 路径胶囊识别范围：正文 markdown 在有 workspacePath 场景已可识别路径成胶囊（agent 提到的路径可能未落盘，由存在性校验兜底，不存在回退纯文本；组共享区文件经 groupId 纳入候选根同样可点），无 workspacePath 场景仍仅搜索高亮
- 终端数据按终端路由：terminal-store.registerDataSink 注册收流，XtermTerminal 消费

## 数据流

- 工作区文件树：workspace/getFiles 单区懒加载（根层 scanDirectoryLevel 逐层 getDirLevel，dogear/articles 内 md 由扫描层读 frontmatter 识别为文章节点，无独立文章扫描链路）
- 全局焦点跟随：切 tab → setFocusedConversation（IPC focus.ts）→ focusedConversationChanged 广播 → 伴随工作台跟随（含跨工作区切换）
