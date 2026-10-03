# 聊天域（chat）

聊天界面全链：主工作区/会话窗口/伴随工作台页面、会话列表与组、agent-chat 消息渲染、输入区、minimap、伴随面板（文件树/终端/话题）、会话数据层。

## 页面

- `app/page.tsx` — 主工作区三栏布局（会话列表+聊天+伴随面板）；常驻挂载 NotesPanel/DataCenterPage/WebAiPanel/会话 tabs 按 activeTabId 切 display；哨兵 tab 下不渲染 CompanionPanel
- `app/session-window/page.tsx` — 独立会话窗口（文件树+聊天+预览），selectConversation 成功后上报全局焦点
- `app/workbench-window/page.tsx` — 伴随工作台独立窗口（主进程单例），订阅 focusedConversationChanged 跟随全局焦点，跨工作区整窗切换

## agent-chat 组件（components/agent-chat/）

- `AgentChat.tsx` — 聊天主组件：组合 hooks+布局+工具轨道+Minimap；从 childrenByParent 派生等待交付展示态；历史加载三态 UI（骨架/错误/空）
- `ChatInputArea.tsx` — 输入区：引用芯片、分流操作气泡（shunt 气泡，同会话最多一个）、图片附件（粘贴/拖拽/按钮三入口 + 5MB 上限，预览缩略图，发送转 base64 image 块）、工具栏（ModelSelector）、斜杠命令菜单、暂停/恢复按钮、暂停与等待交付状态行
- `MessageItem.tsx` — 单条消息渲染：长文本折叠、sticky 冻结、分叉/编辑按钮、跨会话注入消息卡（默认收起）
- `ContentBlockItem.tsx` — 内容块路由（text/tool_use/thinking/permission/askUser/compact_boundary）
- `MessageMinimap.tsx` — 消息小地图：轮次聚合、视口指示、跳转、hover 展开/固定
- `SearchBar.tsx` — 搜索浮条（Ctrl+F、匹配高亮、激活项自动滚动）
- `ThinkingBlock.tsx` — 思考块（compact/detailed 两模式）
- `StreamingIndicator.tsx` — 运行状态指示（基于 pendingState；flushing 态显示插话队列长度）
- `AwaitingDeliveryIndicator.tsx` — 等待子会话交付动效，点击=中断等待
- `AskUserQuestionCard.tsx` / `PermissionRequestCard.tsx` — AskUser 问题卡 / 权限请求卡
- `shunt-suggestions.tsx` — 分流建议卡：ShuntAwareMarkdown 在 MarkdownRenderer 之前剥除/解析 shunt-suggestions fenced JSON 块，卡片按钮插入 shunt 气泡；协议见 plan 全局决策 6
- `MoveToWorkspaceDialog.tsx` — 临时会话移入工作区弹层（选工作区→选组/新建→showConfirm 执行）
- `CitationBadge.tsx` / `CollapsibleBlock.tsx` — 引用徽章 / 可折叠块基础组件
- `SubAgentPanel.tsx` / `SubAgentBlock.tsx` — 子 Agent 面板 / 块
- `highlight.ts` / `minimap-utils.ts` — 搜索高亮工具 / 消息预览提取
- `path-link.tsx` — 工作区路径胶囊基础设施：PathChip 可点弹浮窗、PathText 路径增强（仅工具块内）
- `workspace-id-context.tsx` — 会话所属工作区 Context（无 Provider 降级纯文本）
- `turns.ts` — 轮次构建：轮次头优先级真人消息 > task-execution 注入 > 其他注入（注入仅上一轮头同为注入类才开新轮）
- `transformers.ts` / `types.ts` / `utils.ts` — 流式事件消费转换 / Message 类型 / 工具函数
- `hooks/` — useAgentSession（会话生命周期+pendingCount）、useSessionMessages（消息流）、useSessionEvents（权限/AskUser 事件）、useMessageHistory（历史加载，错误不静默清空可重试）、transcript 三层（transcript-core 纯 reducer / transcript-store 外部订阅 store / useTranscriptState 入口 hook：stable/live 双队列+init 屏障）、useImageAttachment、useSendMessage（发送/重发/分叉/权限响应）、useSlashCommands、useChatScroll（followMode 状态机）、useMessageSearch、useSubAgentMessages、usePendingState（idle/running/flushing 派生）
- `tool-renderers/` — 工具块专属渲染器（Read/Glob/Grep/Skill/FileChange + ToolDetailShell 统一容器），由 ToolBlock 分发
- `usage-badge/` — 会话 token 用量徽章+Popover（上下文占用/累计消耗/逐轮明细；数据链路另见 data-center.md）

## 通用组件（components/）

- `ToolBlock.tsx` — 工具块路由：normalizeToolName 归一后分发 renderer；标题行 Eye 快照预览按钮
- `WorkspaceExplorer.tsx` + `workspace-explorer/` — 工作区文件树（拖放/重命名/删除；文章分区带「导入文章」入口；文件/文件夹右键「历史」（git 能力检测通过才渲染）→ git-history-store 开历史面板）；树行/内联输入/树模型拆在 workspace-explorer/ 三文件（TreeItemRow/inline-inputs/tree-model）
- `FileHistoryPanel.tsx` + `file-history/HistoryDiffView.tsx` — 文件历史 Dialog（双栏：双源时间线（来源徽标 Agent/你/恢复前/外部）+ 行级 diff；影子快照可恢复：showConfirm → restoreSnapshot → toast+刷新文件树；UI 不写用户仓库；主窗口与会话窗口两宿主都挂载）
- `AdditionalFilesPanel.tsx` — 附加路径面板（多节手风琴，行尾 Switch 启停）
- `TopicPanel.tsx` — 话题 tab：话题状态卡渲染（含待确认变更接受/拒绝）+ 共享文件列表；数据层另见 data-center.md
- `companion/CompanionPanel.tsx` — 五 tab 伴随面板容器（文件/附加/话题/终端/浏览器），可被工作台窗口复用；宽度 localStorage 记忆
- `companion/TerminalPanel.tsx` — 终端面板：跟随/固定切换、我的/会话终端子 tab、reconcileActive 修剪失效锚点
- `companion/XtermTerminal.tsx` — xterm 宿主：tab 切换 attach/detach、历史灌入与实时流防乱序
- 浏览器面板三件套（BrowserPanel/BrowserPageView/BrowserInterventions）→ 见 browser.md
- `ConversationList.tsx` + `conversation-list/` — 会话列表（顶部常显 PersonalSection 临时会话分区：当天平铺/更早折叠/「+」与 Ctrl+Alt+N；手动文件夹/近期<7天/更早/归档 tab 入口；ConversationRow 双层高亮；子会话树形折叠）
- `archive/` — 归档 tab 页（左：话题卡/主会话行+子会话徽标/标题搜索/右键恢复·永久删除；右：DigestView 精简轮次流 input+结论，useTopicDigest 话题级缓存）
- `group-list/GroupCard.tsx` — 组卡片（树形会话行、文件夹挂载菜单、删除二次确认）
- `EmptyFocusState.tsx` / `StatusPulse.tsx` — 无焦点占位 / 状态脉冲
- `feishu/` — 飞书 Bot UI（FeishuPanel 主窗口哨兵 tab 页：状态卡通栏 + 左对话右命令两栏，未配置时显 FeishuSetupGuide 开放平台引导），入口 app/page.tsx 工具栏飞书按钮（官方 logo）；类型 `types/feishu.ts`（前后端共享：凭证/连接态/入站消息）；哨兵 id `FEISHU_TAB_ID`（session-store，不落盘）
- `webai/WebAiPanel.tsx` — 网页 AI tab 页：挂载恢复（getWebAiState 有存量同步选中站点/null 按归一化选中站点 openWebAiSite）+ 站点被删兜底切首项（选中态在 session-store `webAiSelectedSiteId` 内存态，读取处 resolveSelectedSite 归一化）+ 占位容器 bounds/弹层遮挡上报（独立 tipc 通道驱动主进程 attach/detach/隐藏，主进程服务见 browser.md webai.ts）；入口 PersonalSection Globe 按钮 + WorkspaceTabBar 可开关 tab 项（关闭联动 client.closeWebAiTab 销毁主进程 tab）；哨兵 id `WEB_AI_TAB_ID`（session-store，webAiTabOpen 内存态刷新即收起）
- `webai/WebAiSiteMenu.tsx` — 网页 AI tab 项内的站点切换器：Globe+当前站点名+箭头弹 shadcn DropdownMenu（Radix 弹层走 WebAiSurface overlay 隐藏链路，零新机制），选中后写 store+openWebAiSite+切到网页 AI tab；导出 resolveWebAiSites/resolveSelectedSite 归一化工具
- 设置类组件（WorkspaceSwitcherPopover/WelcomeFirstRun/WorkspaceRuleDialog/ModelSelector/MarkdownRenderer）→ 见 settings.md / infra.md

## Stores（stores/）

- `workspace-store.ts` — 工作区文件树状态（选中/CRUD/移动）+ openStockWindow；订阅 workspaceFilesChanged 重拉
- `conversation-store.ts` — 对话列表/选中/分叉/对话级模型；personalConversations 独立分片（所有工作区视图常显）与 newPersonalConversation/movePersonalConversationToWorkspace/focusConversationFromLink；tab 焦点联动（revealTopic 定位话题、上报全局焦点）；四个运行态 Set 订阅后端事件
- `group-store.ts` — 会话组状态（groups/currentGroupId/expandedGroupIds；RECENT_THRESHOLD_MS 常量在此）
- `section-collapse-store.ts` — 列表分区折叠状态（近期/更早/子会话折叠区）
- `reference-store.ts` — 引用状态（文章列表/选中片段/会话引用）+ shunt 气泡（分流附件，closeTab 自动清理）
- `slash-command-store.ts` — 斜杠命令合并与 capabilities
- `session-store.ts` — 多会话 tabs+activeTabId+lastFocusedNodeId；哨兵 tab 常量（NOTES/DATA_CENTER/ARTICLE/ARCHIVE/FEISHU/WEB_AI，不落 localStorage）+ dataCenterTabOpen（localStorage 记忆）/webAiTabOpen（内存态）/webAiSelectedSiteId（内存态，网页 AI 选中站点）
- `terminal-store.ts` — 终端前端（terminals Map、followMode/pinned、registerDataSink 收流注册）
- `git-history-store.ts` — 文件历史面板状态（open/target/gitAvailable + checkGitAvailable 幂等能力检测）
- `feishu-store.ts` — 飞书 Bot 前端状态（配置信息/连接态/botStatus 绑定会话与候选列表），订阅 feishuConnectionStatus/feishuBotAutoInit/feishuBotBindingChanged 三事件

## lib / services

- `lib/conversation-sort.ts` — buildConversationTree 组内会话树纯函数（多层派遣链）
- `lib/reference-guard.ts` — 引用前置校验（跨工作区拒绝）、requireReferenceAnchorId 文章锚定、jumpToSourceConversation 跳来源会话
- `services/conversation-service.ts` — 对话索引 CRUD（`.dogear/conversations.json`，含 modelSelection/usageSummary 懒重算）
- `services/conversation-move-service.ts` — 临时会话移入工作区执行链（校验→释放句柄→importConversation→session JSONL 搬运→personal 清理，失败回滚）
- `services/session-id-repair.ts` — 启动自愈：扫 null sessionId 会话按文件名时间戳回填
- `services/group-service.ts` — 会话组 CRUD（`.dogear/groups/{wsId}.json`），写后广播 conversationListChanged
- `services/group-shared-service.ts` — 组共享区文件读写（`.dogear/workspaces/{wsId}/groups/{gid}/shared/`），写后广播 groupDataChanged
- `services/auto-archive-service.ts` — 组自动归档（真实工作区 30 天/personal 临时会话 7 天；启动+每 24h）
- `services/topic-digest-service.ts` — 归档话题 digest 构建/落盘（`groups/<gid>/digest.json`：主会话轮次 input+最后文字结论；归档时预计算、浏览时缺失懒构建；注入判定与前端 utils.ts 语义对齐需同步维护）
- `services/focused-conversation-service.ts` — 全局焦点会话内存态（值变化才广播，跨窗口共享）
- `services/workspace-watcher.ts` — 文件树监视（递归 fs.watch 仅 rename，500ms 去抖广播）
- `services/workspace-fs-service.ts` — 文件树扫描与文件操作（安全路径验证）；create/rename/move/copy/delete 成功后自动触发影子 git 快照（可选尾参 workspaceId，fire-and-forget）
- `services/git-service/` — 双层 git 服务层：exec（execFile 封装+GitServiceError）/shadow（影子仓库：--git-dir/--work-tree 分离，workspaceId 级串行快照队列，add -A -f + exclude pathspec 绕过用户 .gitignore 覆盖私人文件）/user-repo（用户仓库读写+repo-busy 探测）/history（双源合并）；agent Write/Edit 快照挂钩在 pi-session/builtin-tools.ts（withSnapshot 包装）
- `services/pty-service.ts` — PTY 实例管理（node-pty，buffer 尾部 100K 封顶，事件上抛 tipc/pty.ts 桥接）
- `services/feishu/` — 飞书 Bot 主进程服务（唯一 Bot 渠道，微信 Bot 整链已删）：feishu-config-service（凭证 CRUD+连通性测试，`.dogear/feishu/config.json`）/feishu-client-service（@larksuiteoapi/node-sdk WSClient 长连接，自动重连/去重）/feishu-bot-controller（p2p+text 消息处理与会话绑定，message_id 幂等）/feishu-card（Agent 回复 markdown 卡片：表格降级等宽块、4000 字符拆条；命令回执纯文本）；Agent 回复监听在 tipc/feishu.ts 挂 sessionMessage/sessionComplete，bot 状态经 registerBotStateGetter 多注册进 tipc/agent.ts

## 注意

- `personal` 是保留字 workspaceId（常量 `types/workspace.ts` ↔ `electron/main/types.ts` 镜像双份，改需两处同步）：内置隐藏工作区，不进 workspaces.json/getAll 默认过滤，每会话一隐式单会话组，前端平铺不显示组概念

- 「先切后高亮」时序铁律：tab 属其他工作区时必须先 `await setWorkspace(目标)` 再 focusConversationById（conversation-store 唯一入口）
- running/pendingAction/paused/alive 四个 Set 的唯一订阅源是后端事件（sessionStateChanged/sessionClosed/aliveConversationsChanged），禁止前端乐观直写
- 列表刷新统一走 conversationListChanged 事件回环，写 action 内不手动 loadConversations
- 哨兵 tab（笔记/数据中心/文章）不上报全局焦点，保持「最近焦点」语义
- 路径胶囊仅工具块内识别路径，正文不做（agent 提到的路径可能未落盘，MarkdownRenderer 只做搜索高亮）
- 终端数据按终端路由：terminal-store.registerDataSink 注册收流，XtermTerminal 消费

## 数据流

- 工作区文件树：workspace/getFiles → articleService.listArticleTree + workspaceFsService.scan → 合并返回
- 全局焦点跟随：切 tab → setFocusedConversation（IPC focus.ts）→ focusedConversationChanged 广播 → 伴随工作台跟随（含跨工作区切换）
