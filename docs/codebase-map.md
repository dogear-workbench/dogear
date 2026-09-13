# Dogear 代码地图

> 核心文件功能索引。由 `codebase-map` skill 按需 Read，由 `doc-sync` skill 在代码变更后同步。 简单的定位/改动建议直接用 Glob/Grep 探索当前代码状态，索引可能滞后于实际文件。

## 入口与路由（src/）

- `src/main.tsx` — Vite 入口，挂载 React 到 `#root`，顶层挂载 setupSettingsSync（动态 import 避免非主窗口加载副作用）
- `src/App.tsx` — React Router 配置（HashRouter 路由：`/` 主工作区、`/session-window/:id` 独立会话窗口、`/data-center` 数据中心独立窗口、`/workbench-window` 伴随工作台独立窗口、`/stocks` 自选股、`/wechat`、`/debug`）+ 设置全屏 overlay（ui-store settingsOpen 时 fixed inset-0 z-50 渲染 SettingsPage，底层页面不卸载）+ 全局 ConfirmDialog + Toaster
- `src/globals.css` — Tailwind CSS 4 全局样式

## 渲染层 Hooks（hooks/）

- `hooks/use-visible-polling.ts` — `useVisiblePolling(fn, intervalMs)`：数据中心统一轮询钩子，挂载且可见立即执行一次并起 interval；visibilitychange 隐藏停、恢复可见立即拉一次对齐；fn 用 ref 转发（变化不重置计时）；调用方自行处理 props 变化的立即刷新

## 页面（app/）

- `app/page.tsx` — 主工作区页面，三栏布局（对话列表 + AI助手 + 伴随面板）；TitleBar 自绘标题栏显示「Dogear」；header 数据中心按钮 openDataCenterTab（可开关 tab）；内容区常驻挂载 NotesPanel（固定 tab）+ DataCenterPage（dataCenterTabOpen 时挂载）+ 会话 tabs，按 activeTabId 切 display；哨兵 tab（笔记/数据中心）下 CompanionPanel 不渲染
- `app/session-window/page.tsx` — 独立会话窗口（路由参数 `conversationId`，可折叠文件树 + 聊天 + 预览，独立渲染进程初始化；selectConversation 成功后上报全局焦点 setFocusedConversation，伴随工作台跟随）
- `app/workbench-window/page.tsx` — 伴随工作台独立窗口（WorkbenchWindowPage，主进程单例 BrowserWindow 路由 `#/workbench-window`）：初始化链路 getDefault → setWorkspace(skipSetDefault)，默认跟随模式（不 pin 死）；订阅主进程 `focusedConversationChanged` 广播 + 冷启动 getFocusedConversation 拉取全局焦点会话（RPC 响应仅无值时生效防回退），锚点 `focusedConv?.conversationId ?? conversations[0].id`；焦点属于其他工作区时 setWorkspace(skipSetDefault) 整窗跟随切换；渲染 `<CompanionPanel full terminalAnchor=锚点>`，topic tab 的 groupId 与终端跟随锚点同源
- `app/settings/page.tsx` — 设置页（主窗口全屏 overlay 形态：返回按钮/关闭均调 handleClose，不 dirty 直接 closeSettings、dirty 弹三按钮 confirm 后关 overlay；顶栏保存/取消/保存并重启会话；保存联动走 updateSettings → broadcastSettingsChanged → setup-settings-sync，同窗口自收自发）；布局为顶部下划线式 TabsList（variant=underline）+ TabsContent 内层滚动，内容容器 max-w-* mx-auto 居中；纯设置 tab：基础设置 / 能力 / 模型方案 / 工作区管理 / 子会话派遣 / 关于（原记忆/摘要/定时/用量/解析历史 tab 已迁数据中心）；基础设置 tab 内含「受控浏览器」小节（代理地址 browserProxyServer 输入 + 默认引擎 browserSearchEngine 下拉 + 浏览器扩展状态行 ExtensionStatusLine，授权域名 chip 只读展示）
- `app/settings/ExtensionStatusLine.tsx` — 浏览器扩展状态行（挂载 client.getExtensionStatus() 查询 + extensionStatusChanged 订阅收即渲染：未连接引导文案 / ✅ 已连接·当前标签页 / extractError 灰字「该页面内容无法读取」/ textPreview 正文预览 / connected 态授权域名只读 chip 列表 + 「撤销请在扩展弹窗中操作」旁注）；ExtensionStatus 类型唯一源 browser-gateway.ts，渲染层 import type 自动流转
- `app/settings/AbilityTab.tsx` — 能力标签页编排层（两级结构：列表态 = 工作区 Select + 规则合并卡 RulesPackCard + 其余能力包卡片 AbilityPackCard + 系统行为卡；详情态按 selectedKey 路由——workspace-rules/global-rules 两 key 均进 RulesPackDetailPage、__system__ 进 SystemBehaviorDetail、其余切 AbilityPackDetailPage（带 key={pack.key} 切包时重置内部 state），面包屑返回）；包开关写 workspace config 的 abilityOverrides（主进程侧自动标脏活跃会话），applySkillToggles 保留（开 = skills ∪ 关联工具包，关 = 按剩余已启用 skill 保留共享包，原子双写 enabledSkills+enabledToolPacks，映射源 getAbilityPacks 的 skillMetas[].toolPacks）；handleTogglePack 总开关联动（2026-09-13）：有 Skill 的包 enable=true 一键补齐包内 skillMetas[].name 到 enabledSkills + 有 pack 归属的 toolGroupMetas[].id 到 enabledToolPacks（只补不删），enable=false 只写 overrides 不动细闸，无 Skill 纯工具包维持开加关删联动；能力元数据唯一来源 `getAbilityPacks()`（前端零硬编码，residentToolGroups 常驻组清单同接口下传）；弹窗仅剩 ToolDetailDialog（工具详情浮窗；SkillDetailDialog 随 skill 就地渲染退役已删）
- `app/settings/ability/` — 能力页两级结构组件目录（全文一律 MarkdownRenderer 渲染态 + Tailwind 标准字号档位随 root font-size 缩放）：`pack-meta.ts`（图标选型 + 包类型徽标文案 + 系统行为图标）、`RulesPackCard.tsx`（首页合并卡：标题「规则」+ 工作区/全局两条启用徽标，无总开关，点击进合并详情）、`RulesPackDetailPage.tsx`（合并详情：左侧两个独立 RuleFileEditor + 右栏两包开关与两段 AbilityMountsSection）、`RuleFileEditor.tsx`（单栏态切换：平时 MarkdownRenderer 渲染态，点「编辑」进 Textarea 编辑态（保存/恢复模板/未保存标记），保存后回渲染态）、`AbilityPackCard.tsx`（列表态卡片：图标+名称+描述+开关+统计+类型徽标）、`AbilityPackDetailPage.tsx`（详情态编排：左主区 skill 型包 = 顶部 chips 切换 + 选中 skill 的 SKILL.md 渲染全文（useSkillContent）+ 细开关在标题旁，段型包 = SegmentBlock（MarkdownRenderer）/CoreProfileView；右栏 Sidebar + MountsSection，agent-collab 附关闭效果说明）、`AbilityPackSidebar.tsx`（能力总开关 + 配套工具组折叠列表 + 挂载情况，w-72 固定窄栏）、`AbilityMountsSection.tsx`（getAbilityMounts 读时快照，configVersion 计数驱动刷新）、`SystemBehaviorDetail.tsx`（三区：会话组上下文段 / 主子会话协作段+固定协作组说明+agent-collab 交叉引用 / 常驻工具区）、`BasicToolsSection.tsx`（常驻区基础工具 ask/allow 就地切换，读 settings-store 经 client.updateSettings 即时保存）
- `app/settings/WorkspaceManagementTab.tsx` — 工作区管理标签页（列表 + 删除 + 孤儿恢复 + 环境依赖检查）
- `app/settings/SubAgentTab.tsx` — 子会话派遣标签页（Profile 列表管理：非 default Profile 行内启用 Switch，停用后 agent 侧不可见不可派遣、行置灰加「已停用」徽标；ProfileEditor 编辑名称/模型/超时/基础工具/能力域/Skill，能力域区附交集语义说明——Profile 勾选是子会话侧细闸，实际生效 = Profile 勾选 ∩ 工作区能力包开关（能力域含 extension 开关「浏览器扩展（dogear-extension 扩展工具包：真实浏览器已连接标签页，仅限已授权域名）」与 web 开关「联网搜索（bigmodel__webSearch / bigmodel__webReader，GLM MCP 快档）」，countAbilityDomains 计入）；skill 列表按挂载时本地解析的工作区拉取——getAll + getDefault、default null 时选第一个、零工作区传 null——不依赖 workspace-store）
- `app/settings/pi-model-row.tsx` — 模型清单行组件 `PiModelRow`：ID 行内编辑（空/与同清单重复回退标红）、窗口徽标点击手填（`parseContextInput` 解析 1M/200K/262144 写法，清空恢复查表，手动角标）、显示名与删除
- `app/data-center/` — 数据中心（主窗口固定 tab 常驻挂载，tab 上 hover 可弹独立窗口；顶部下划线式 tab 导航 5 面板；workspaces 由 page.tsx 加载一次下传，各 panel 只自持 `workspaceId: 'all' | id` 筛选状态不读 workspace-store；轮询统一走 useVisiblePolling；设置加载由页面 loadSettings 负责）：
  - `page.tsx` — 骨架：顶部 TabsList variant=underline（用量/定时计划/执行历史/解析历史/记忆）；TabsContent 统一 `flex-1 overflow-hidden` + 内层滚动层；scheduler tab 加 forceMount（编辑页草稿切 tab 不丢，代价是跨 tab 轮询持续）
  - `history-panel.tsx` — 执行历史一级面板（挂载即 loadTasks + loadHistory；任务/状态筛选 shadcn Select、状态纯前端过滤；refreshActivity 10s 可见轮询；分钟 tick 刷新中/待跑时间）
  - `usage-panel.tsx` — 用量面板（时间分页今日/7天/30天/全部；'all' 时不传 workspaceId 走后端聚合；'all' 会话列表前端逐工作区拉取合并；全部模式会话行显示工作区名 Badge）
  - `scheduler/` — 定时计划组件目录（自设置页整体迁入，文件名不变）：
    - `SchedulerPanel.tsx` — 任务列表与编辑态切换（收 workspaces props、workspaceId 内置；activity 10s 轮询走 useVisiblePolling；editing 非 null 时整面板渲染 TaskEditorPage；列表态滚动层 + max-w 容器自带）
    - `TaskEditorPage.tsx` — 任务编辑页面内二级页（面包屑工具栏 + 左列名称/大提示词区 + 右列 w-80 参数卡片（模型/工作区/工具/触发器）；大 textarea 提示词编辑；validateDraft 预校验 + 重叠 showConfirm；返回直接丢草稿）
    - `CustomToolPacksSection.tsx` — 自定义任务工具包区（生效集 = toolPacksOverride ?? 工作区启用集）
    - `TriggerListEditor.tsx` — 触发器编辑（摘要行列表 + DropdownMenu 分「时间规则/条件事件」两组添加，新条目展开态插入，单条展开）
    - `TriggerRow.tsx` — 单条触发器摘要行（类型图标 + describeTrigger + 删除）+ Collapsible 展开态「标签在上、控件在下」小表单（含月日全宽网格、on_task_done shadcn Select）
    - `TriggerControls.tsx` — 触发器编辑共享控件（inputCls / MONTH_GRID / WeekdayChips / PresetChips / Field）
    - `utils.ts` — describeTrigger、formatRelativeFuture、周几 chips、datetime-local 双向转换、WorkspaceOption
  - `history-utils.ts` / `HistoryEntryCard.tsx` — 执行历史格式化与条目卡片（history-panel 使用，随迁至 data-center 根）
  - `parse-history-panel.tsx` — 文章解析历史面板（全局 history.jsonl，手动刷新，无轮询）
  - `memory-section.tsx` — 记忆 tab 容器（收 workspaces props、筛选内置；'all' 时空态也渲染标题行 + 筛选；头部重建索引按钮 rebuildMemoryIndex；内层两节 Tabs）
  - `core-profile-panel.tsx` — 核心画像编辑面板（workspacePath props）
  - `topics-panel.tsx` / `topics-list.tsx` / `topic-editor.tsx` / `memory-types.ts` — 主题记忆列表 + 编辑器（workspacePath props，slug 校验/覆盖确认/删除二次确认）
- `app/stocks/page.tsx` — 自选股行情页面，双栏布局（自选股列表 + 个股详情）
- `app/debug/page.tsx` — 开发调试窗口，集成 AgentChat 测试

## 业务组件（components/）

- `agent-chat/` — AI 聊天模块（\~20 文件）
  - `AgentChat.tsx` — 主组件（\~250行），组合 hooks + 布局 + 右侧工具轨道 + Minimap 集成；从 childrenByParent 派生等待交付展示态：awaitCount 驱动右侧工具轨道的 AwaitingDeliveryIndicator（minimap 同列侧边，点击即中断等待），isWaitingForChildren（run settled ∧ 有 running 直属子会话）仅驱动 ChatInputArea 状态行，主聊天流无等待文案，纯展示不阻塞；历史加载三态独立 UI：loading/屏障未 ready 骨架屏、error 错误卡片（原因摘要 + 重试）、empty 空态文案
  - `ChatInputArea.tsx` — 输入区域（引用芯片、图片预览、textarea、工具栏、斜杠命令菜单、运行中暂停按钮：调 pauseQueryBasedSession，受理到 paused 广播间显示「暂停中…」；状态行 paused 徽标「已暂停 · 发送消息继续」，paused 态输入框正常可用、发送即恢复；awaitingDelivery 态状态行显示「等待子会话交付中 · 可继续对话」，输入框行为同 idle）
  - `MessageItem.tsx` — 单条消息渲染（用户/助手/isMeta消息、长文本折叠、sticky 冻结、分叉/编辑按钮；跨会话注入消息卡默认收起一行标识（来源+类型徽章+首行预览），点击展开全文，按 tag 分色）
  - `ContentBlockItem.tsx` — 内容块路由（text/tool_use/thinking/permission/askUser/compact_boundary）
  - `MessageMinimap.tsx` — 消息小地图（按轮次聚合、视口指示、跳转、hover 展开/固定）；轮次头优先级见 turns.ts，注入头轮预览带类型前缀（▣ 任务执行 / ↩ 交付…）
  - `SearchBar.tsx` — 搜索浮条（Ctrl+F 快捷键、文本匹配高亮、激活项自动滚动）
  - `ThinkingBlock.tsx` — 思考块（compact/detailed 两种展示模式）
  - `StreamingIndicator.tsx` — 运行状态指示器（基于 pendingState：思考中/执行工具/生成中；flushing 态显示插话队列长度；等待交付动效已迁出至 AwaitingDeliveryIndicator，不再承担）
  - `AwaitingDeliveryIndicator.tsx` — 等待子会话交付动效（右侧工具轨道 minimap 同列：Hourglass pulse + 橙色 ping 光环，awaitCount<=0 不渲染；点击=中断等待 handleAbortWait，title 展示运行/已交付/异常计数）
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
  - `minimap-utils.ts` — 消息预览提取工具函数（含注入消息类型前缀 injectedPreviewPrefix）
  - `turns.ts` — 轮次构建（轮次头优先级：真人消息 > task-execution 注入 > 无人值守语境下的其他注入——交付/终态/续跑注入仅当上一轮头也是注入类或尚无轮时开新轮，否则并入当前真人轮；Turn.headerInjected 标记头类型，吸顶与小地图真人语义不变；turns.test.ts 覆盖有人/无人值守切换场景）
  - `transformers.ts` — 消息转换工具（streamReducer 消费主进程事件流，含 message_id 终化）
  - `types.ts` — 类型定义（Message、ContentBlock，含 isMeta/isCompactBoundary 等字段）
  - `utils.ts` — 工具函数（getUserMessageSearchableText 等）
  - `hooks/` — 自定义 hooks（11 个）
    - `useAgentSession.ts` — 会话生命周期（创建/resume/fork/关闭）+ 订阅 pendingCountChanged 暴露 pendingCount
    - `useSessionMessages.ts` — 消息流监听与流式更新
    - `useSessionEvents.ts` — 权限/AskUser/通知事件监听
    - `useMessageHistory.ts` — 历史消息加载（含 compact_boundary/isMeta 处理）；error 不静默清空 transcript，暴露 historyError/retryHistory，loadIdRef 自增 id 处理 retry/切会话/卸载竞态失效
    - `useTranscriptState.ts` — transcript 状态收敛入口（stable/live 双队列 + init 屏障）：初始化屏障 history 到达即 ready（snapshot 迟到走 timedOut merge 重建，2s 定时器兑底为纯保险），loadHistory/applySnapshot/enqueueStreamEvent 收敛消息写入口，暴露 initReady 供骨架屏判定
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
- `TopicPanel.tsx` — 右侧「话题」tab（原 SharedAreaPanel 升级）：话题组三段折叠面板——话题背景（readTopicStateCard 拉条目化状态卡，TopicStateCardSection 渲染：生效话题含确立时间/待确认话题变更卡片带接受-拒绝按钮/六类条目不带会话 id、时间在正文下方单独小字行，分区标题 11px 半粗）+ 共享文件列表（md 点击 openInline 浮窗，非 md 提示去资源管理器看；引用/删除按钮 hover 显示）；订阅 groupDataChanged（共享区写点/状态卡落盘广播）匹配当前组重拉两份数据
- `companion/` — 右侧伴随面板模块（组件只依赖 store + tipc client，无主窗口特有上下文，可被 workbench-window 独立窗口复用）
  - `CompanionPanel.tsx` — 五 tab 容器（文件/附加/话题/终端/浏览器）：props `{ workspaceId, groupId, terminalAnchor?, full? }`（terminalAnchor 终端跟随锚点，工作台窗口传全局焦点会话 id，缺省用主窗口 activeTabId），full=true 独立窗口模式（占满容器、无拖拽把手、忽略折叠与宽度记忆）；面板模式宽度 localStorage 记忆 key `companion-width:{tab}`（240~720 clamp，拖拽结束才写）、左缘拖拽把手、折叠由 ui-store.rightPanelOpen 控制；tab 分发 WorkspaceExplorer / AdditionalFilesPanel / TopicPanel / TerminalPanel / BrowserPanel，tab 状态 ui-store.rightPanelTab（每渲染进程独立实例，主窗口与工作台窗口互不影响）
  - `BrowserPanel.tsx` — 右侧「浏览器」tab 容器：状态行（running/launched 从 browser-store）+ BrowserInterventions 等待人工卡片区 + BrowserPageView 页面视图区 + 动作流分组卡片流（按任务分组：article 手动解析 / agent 会话，运行中任务置顶脉冲；ACTION_ICONS/LABELS 覆盖含 present/await_human 全部动作类型）；拉历史 ensureLoaded（一次性 RPC + seq 竞态合并）
  - `BrowserPageView.tsx` — 页面视图区（Step 6 呈现层 UI）：内嵌 tab 列表（title/host + 状态徽标 + 呈现/收起按钮，呈现按钮调 client.presentEmbeddedTab）+ 呈现中 tab 的占位容器（h-52 div，ResizeObserver + resize 防抖 120ms 上报 getBoundingClientRect 到 reportPageViewBounds，卸载上报 null 触发主进程 detach）；主进程 WebContentsView attach 到占位区 bounds 上（activeTabId/agentTabId 分离：用户切换呈现不影响 agent 操作目标）；数据源 getPageViewState（tabs + presentedTabId + selfWindowId），动作流事件驱动节流刷新
  - `BrowserInterventions.tsx` — 等待人工卡片区（awaiting_human 产品化 UI）：pending 请求卡片（reason 图标 + 标签 + message + URL + 「我已完成，继续任务」按钮 → client.resolveHumanIntervention）；数据源 listHumanInterventions + humanInterventionChanged 全量刷新
  - `TerminalPanel.tsx` — 终端面板（props `{ terminalAnchor? }` 窗口级跟随锚点，缺省回退主窗口 activeTabId；跟随锚点/固定目标/跟随态标题三处统一走 windowAnchor，标题与 pin 目标有效性用 conversations 查找）：头部 h-9 固定/跟随切换（terminal-store followMode/pinnedConversationId）+ 固定态 shadcn Select 会话下拉（选项=conversation-store conversations）；身体 active 存在渲染 `<XtermTerminal key={terminalId}>` 否则空态；挂载时 ensureTerminals() 恢复实例清单，terminals/锚点变化时 reconcileActive() 修剪失效 active（回退链：会话最新→我的最新→null）；底部子 tab 栏左「我的」shell 右「会话」终端（command 短名 + 运行中 Loader/退出 exit N 灰化），tab hover × killTerminal，最右 + openUserShell
  - `XtermTerminal.tsx` — xterm 宿主组件（props `{ terminalId }`）：模块级 entryCache 永不 dispose，tab 切换 attach/detach（自持 host div 搬家，Terminal.open() 只调一次）；挂载 getPtyBuffer 灌历史后接实时流（sink 先注册，历史未返回期数据进 pending 队列灌完 flush 防乱序）；onData→ptyWrite（exited 拦截），ResizeObserver→fit→尺寸变化才 ptyResize；ptyExit 后底部终态条
- `ArticlePreview.tsx` — 网络文章内容预览，选中文字浮动引用按钮（主窗口文章 tab + 独立会话窗口右栏双挂载；引用锚定走 requireReferenceAnchorId，主窗口引用后切回目标会话）
- `ConversationList.tsx` — 对话列表主骨架（单一滚动视图：手动文件夹 → 近期 + 归档 Popover 浮窗）
- `conversation-list/` — 对话列表子组件（拆分；按组渲染）
  - `ConversationRow.tsx` — 通用会话行（所有 section 共用，含 nodeId 必填 / 双层高亮 useNodeHighlight / expandToggle 可选展开箭头（agent 子会话折叠区）/ 操作按钮 absolute 右侧浮层（渐变背景叠在文字上，opacity-0+pointer-events-none 防隐形误触，编辑态隐藏）；agent 派出会话显示 Network 图标、任务执行会话（标题前缀「任务: 」判定）显示 amber 色 ListTodo 图标；文件夹相关 ContextMenu 已上移到 GroupCard）
  - `ManualSection.tsx` — 手动文件夹区（无「手动分组」总标题，文件夹平铺；headless-tree 仅在此用；children\[**root**\] 里的 folderId 节点及其子树，叶子渲染 GroupCard 装 groupId；订阅 section-collapse-store.folderReveal 展开祖先文件夹链）
  - `RecentVirtualGroup.tsx` — 时间分区：⚡ 近期 &lt; 7 天（默认展开）+ 🕐 更早 7~30 天（默认折叠），均按 group.updatedAt 倒序，两段头部共用 SectionHeader；阈值 RECENT_THRESHOLD_MS/OLDER_THRESHOLD_MS 在 group-store（OLDER 与 auto-archive-service 的 30 天过期归档对齐，散落未归档话题全部落在两区内），文案由 RECENT_DAYS/OLDER_DAYS 派生
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
- `NotificationCenter.tsx` — 顶栏消息中心（仅主窗口 header）：Bell 按钮 + 未读徽章（>99 显 99+）+ Popover 下拉邮箱式面板（类型图标/标题/×N 聚合计数/摘要/归属名/相对时间，未读高亮圆点 + 底色，「全部已读」）；挂载即拉初值（重启恢复未读）+ 订阅 notificationsChanged（面板开重拉全量/未开只更徽章）；点击条目跳转即已读：task → 切工作区 + 笔记页任务视图 requestTaskFocus，conversation → 查父会话 openOrFocusConversation（本地 store 优先、getByWorkspaceId 兑底）
- `dashboard/` — 已删除（首页 tab 下线：报告并入笔记面板 report mode，捕捉盒移除）
- `notes/` — 笔记卡片模块（固定「笔记」tab 内容，数据见 services/notes/；四 mode 顶栏：笔记/任务/回收站/报告）
  - `NotesPanel.tsx` — 编排容器：三 mode 顶栏（笔记|任务|回收站，任务 mode 保留 review 数徽章 + 通知深链切 mode）+ 搜索框（笔记走 searchNotes 300ms 防抖 + seq 竞态保护，query+tag 叠加；任务/回收站传 query 给对应面板前端过滤，不发 IPC）+ 笔记 mode 专属 # 标签下拉（TagFilterMenu）与选中标签 chip（可单独点掉）+ 右侧「新建卡片」仅笔记 mode；时间流独占笔记列表区；switchMode 切换清空搜索状态；Ctrl+\ 列表显隐（笔记 aside 与任务 TaskPanel 共用）
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
- `conversation-store.ts` — 对话状态：对话列表、选中对话、分叉参数、编辑重发、对话级模型（setConversationModelSelection）、会话重启触发（sessionRestartTrigger）；loadConversations 并行拉 conversations + tree + groups 后一次写完并同步 group-store；focusConversationById（Tab 焦点联动入口）在活跃会话切换时调 revealTopicInList 展开左侧列表定位话题，并经 expandSubParentIfNeeded 展开 agent 子会话的父折叠区；底部 activeTabId 订阅 async 化焦点联动：真实会话 tab 才 fire-and-forget 上报全局焦点（client.setFocusedConversation，哨兵/空 tab 不上报保持最近焦点语义），tab 属其他工作区时先 `await setWorkspace(目标)` 后 focusConversationById（先切后高亮时序铁律，点 tab/关 tab/独立窗口收回唯一入口）；三个 folder actions 已改名（addGroupToFolder / moveGroupBetweenFolders / removeGroupFromFolder）；导出 CONV_TREE_ROOT 根哨兵；列表刷新统一走 conversationListChanged 事件回环（主进程 service 写点广播，含任务队列建会话 / touch / 改名 / 归档等后台路径），各写 action 内不再手动 loadConversations；`runningConversationIds` / `pendingActionConversationIds` / `pausedConversationIds` 三个 Set 唯一订阅源是后端 `sessionStateChanged` / `sessionClosed`（废弃旧 `conversationRunningStateChanged` 前端订阅，删除乐观直写以避免双源 race）；`aliveConversationIds` Set（第四个）订阅源是后端 `aliveConversationsChanged` 全量广播 + 冷启动 `getAliveConversations` 主动拉初值，语义=内存 ∧（running ∨ 被 bridge 保活），驱动列表竖线存活态
- `group-store.ts` — 会话组状态：groups\[\] + currentGroupId + expandedGroupIds（默认全折叠）+ syncGroups（conversation-store loadConversations 拉完 groups 后同步写入，不碰展开状态）+ expandGroup（reveal 单向展开）/ createGroup / updateGroup / archiveTopic / restoreTopic / deleteTopic；RECENT_THRESHOLD_MS 常量在此；自动归档由主进程定时触发（见 auto-archive-service）
- `section-collapse-store.ts` — 左侧列表分区折叠状态：recentExpanded（「近期」默认展开）/ olderExpanded（「更早」默认折叠）/ folderReveal（nonce 供 ManualSection 订阅后逐层 expand 祖先文件夹链）/ subExpandedConvIds（会话行子会话折叠区，默认全折叠，expandSubConv 供焦点联动单向展开）；revealTopic(groupId) 在活跃会话切换时按 updatedAt 落桶展开对应时间分区与话题卡片，数据源动态 import group/workspace/conversation 三个 store
- `reference-store.ts` — 引用状态：引用文章列表、引用片段（用户选中文字）、会话引用（ConversationReference，含 workspaceId 支持跨工作区，去重按 conversationId）
- `slash-command-store.ts` — 斜杠命令状态：SDK + 自定义命令合并、capabilities 更新
- `settings-store.ts` — 应用设置：加载/保存（整体 save 模式；保存后主进程按 diff 分层生效，快照域标脏受影响 PiSession，无重启链路）
- `ui-store.ts` — UI 状态：设置全屏 overlay（settingsOpen/openSettings/closeSettings，reset 归 false）+ 右侧面板折叠（rightPanelOpen）
- `browser-store.ts` — 浏览器面板状态：动作流事件缓冲（cap 500，seq 竞态合并）+ BrowserStreamStatus + 页面视图区状态 view（tabs/presentedTabId/selfWindowId/hasPageView，getPageViewState 拉 + 动作流事件节流 2s 刷新）+ 等待人工 pending 列表（listHumanInterventions 拉 + humanInterventionChanged 全量刷新）；订阅 browserActionAdded/pagePresentationChanged/humanInterventionChanged 三个广播（2026-09-08 Step 6 扩展）
- `confirm-store.ts` — 全局确认弹窗：confirm() 返回 Promise，showConfirm() 简化版
- `stock-store.ts` — 自选股状态：watchlist/quotes/K线/分时/资金流向/搜索/RateLimiter 状态
- `notes-store.ts` — 笔记卡片前端：notes（created 倒序）/loading/loadedWorkspacePath/activeNoteId + loadNotes（listNotes）/subscribeNotesChanged（notesChanged 广播按 workspacePath 匹配重拉）/setActiveNoteId/createNote（支持 {content, tags} 输入，不自动激活——新建即编辑由 NotesPanel 控制）/updateNote（本地乐观更新，广播兜底）/deleteNote（软删除，成功后本地移除）
- `task-store.ts` — 协作任务前端：groups（TaskGroups 八分组，含 plan）/loading/loadedWorkspacePath/activeTaskId + loadTasks（listCollabTasks）/executeTask（tipc executeCollabTask 内部已 kick 队列，成功即 loadTasks 刷新，失败返 false 由组件 toast）/moveTask（tipc moveCollabTask，plan↔backlog 流转）/subscribeTasksChanged（广播匹配重拉）/setActiveTaskId
- `task-focus-store.ts` — 任务通知深链请求（focusReq {taskId, seq}，seq 递增使同一任务重复通知可再触发；NotesPanel 切任务 mode、TaskPanel 选中任务各自响应）
- `notification-store.ts` — 消息中心前端：notifications + unreadCount + loadNotifications（拉初值）/markRead/markAllRead（本地乐观更新 + IPC，失败回拉兑底）/subscribeNotificationsChanged(isPanelOpen)（广播：面板开重拉、未开只更 unreadCount）
- `session-store.ts` — 多会话标签页：tabs\[\] + activeTabId + sessionWindowIds + lastFocusedNodeId（UI 状态：对话列表节点双层高亮区分"被点击的那一处" vs "已打开的同会话其他节点"）；导出 `NOTES_TAB_ID`/`DATA_CENTER_TAB_ID`/`ARTICLE_TAB_ID` 哨兵（文章 tab 挂载由 article-store.selectedArticle 驱动，选中文章即出现、清空即卸载）（非真实会话）+ `isSentinelTabId()` 判定函数，activeTabId 初始/关末 tab 后回退到 NOTES；`dataCenterTabOpen`（localStorage `data-center-tab-open` 记忆）+ openDataCenterTab/closeDataCenterTab（关闭时 active 在数据中心则回退最近会话 tab 或笔记）；`SessionTab` 无 `isStreaming` 字段运行态一律读 `conversation-store.runningConversationIds`）
- `scheduler-store.ts` — 定时任务前端：tasks（ScheduledTaskWithNextRun，nextRunAt 现算不落盘）/ activity（refreshActivity，10s 轮询由数据中心面板 useVisiblePolling 驱动）/ history（倒序分页：loadHistory(historyTaskId?) + loadMoreHistory，cursor=上页末条 ts）+ 任务 RPC 封装（saveTask/deleteTask/stopTask 失败 toast 后端文案）
- `terminal-store.ts` — 终端面板前端：terminals Map（terminalId → TerminalMeta：conversationId/command/exited/exitCode，不存内容流）+ activeTerminalId + followMode/pinnedConversationId（跟随/固定，pinConversation/setFollowMode）；openUserShell（cwd 取 workspace.path，ptyCreate conversationId:null）/killTerminal/setActive/ensureTerminals（listPtyTerminals 全量 upsert，后开窗口恢复）/reconcileActive；registerDataSink(terminalId, cb) 收流注册口 + dispatchPtyData 按终端路由（XtermTerminal 消费）；模块级订阅 ptyCreated/ptyData/ptyExit（dynamic import @/lib/events）

## 工具函数（lib/）

- `client.ts` — tipc 客户端，window.ipcRenderer 通信入口
- `utils.ts` — cn() 类名合并工具
- `events.ts` — tipc 事件处理入口，监听主进程事件
- `setup-settings-sync.ts` — setupSettingsSync()（src/main.tsx 顶层挂载）：监听 settingsChanged 事件 loadSettings（主题/字号由 store 订阅即时热更；agent 快照域由主进程标脏处理）
- `dogear-sound.ts` — playDogearSound(kind, {force?, volume?})：Web Audio 合成提示音（complete/permission/error 三音型），内部处理 enabled 开关、volume（覆盖参数优先）、backgroundOnly 前台静默与 1200ms 节流；调用方：app/page.tsx 全局 soundCue 监听（主进程提示决策下发）+ 设置页试听按钮
- `model-selection.ts` — 模型选择纯函数：dedupeProfileTiers（按 Profile 提取去重后的 (tier, modelId) 列表）/ sameSelection（结构相等比较）/ resolveModelLabel（selection → 展示名，ModelSelector 与设置页提示文案共用）
- `conversation-sort.ts` — buildConversationTree：组内会话树纯函数（递归 ConversationTreeNode），手动会话按 updated_at 倒序作为根 + agent 派出会话挂派出者下（created_at 升序、支持多层派遣链，parentSessionId 不在组时回落自然序作根）
- `reference-guard.ts` — guardReferenceIntoFocus()：右栏文件/文件夹/附加路径引用前置校验——浏览工作区 ≠ 焦点 tab.workspaceId 时 toast 拒绝（附焦点会话工作区名），HOME tab 无焦点会话放行；WorkspaceExplorer / AdditionalFilesPanel 引用入口共用；requireReferenceAnchorId()：文章引用专用锚定——会话 tab/独立窗口焦点优先，哨兵 tab（文章 tab 等）回退 lastActiveConversationTabId（带工作区匹配守卫），文章选中引用与右键引用整篇共用；jumpToSourceConversation()（async）：笔记/任务详情跳来源会话——已开 tab 聚焦，独立窗口唤起 focus，未开 tab 查会话列表（冷启动先拉取）openTab + selectConversation，跨工作区由焦点联动兑底
- `sdk/index.ts` + `sdk/query.ts` — Claude Agent SDK 的 query 函数封装

## 类型定义（types/）

- `article.ts` — ArticleMeta / Article / QuoteSnippet
- `note.ts` — NoteMeta（id/file/title/created/updated/tags/links）/ Note，主进程镜像在 `electron/main/services/notes/note-types.ts`；旧卡内 todos 类型链（TodoStatus/TodoItem/NoteMeta.todos）已随待办实体退役删除，frontmatter 遇 todos: 块直接忽略
- `task.ts` — 协作任务数据模型：TaskStatus（plan/backlog/queued/running/review/done/rejected/interrupted）/ Task（title/planPath?/originSessionId?/execSessionId?/result?/deletedAt?，lastActiveAt 已废弃读时忽略）/ TaskGroups，主进程真源在 `electron/main/services/task-store.ts`
- `ai.ts` — AIInteraction / AIMessage
- `settings.ts` — ModelTier / ModelSelection / ModelProfile / AppSettings（含 defaultModelSelection 与 parseModelSelection/stateModelSelection 各自独立——parse 为文章解析 AI 兑底、state 为话题状态卡抽取专用，null 时回退默认模型；含 `subAgent = { profiles: SubAgentProfile[] }` 子会话派遣 Profile 清单，SubAgentProfile.enabled 仅非 default 有意义——停用后系统提示词索引不列出、startChild 拒绝；根级 `basicToolPermissions` 七工具映射；`ai.permissionMode` 为 `default | autoExecute` 两态；`ai.effort` 控制推理努力程度）/ DEFAULT_SETTINGS
- `agents.ts` — TaskStatus / TaskType / AgentTask / ForkParams
- `electron-api.ts` — Workspace / WorkspaceFileNode / ExtendedSessionMessage / Citation / Conversation（含 modelSelection/contractMetadata — 后者记录 agent 派出溯源：createdBy / parentSessionId / task）
- `delegation.ts` — Agent 协作契约数据模型（ContractMetadata / ChildSessionState / 契约通道消息类型）
- `stock.ts` — WatchlistItem / StockQuote / KLineDataPoint / TimelinePoint / MoneyFlowPoint / StockSearchResult / DailySnapshot / QUOTE_FIELD_MAP / RateLimiterStatus / Announcement / AnnouncementType / ListAnnouncementsOpts / AnnouncementDetail / CachedAnnouncementEntry
- `usage.ts` — 会话用量数据模型（ConversationUsageEntry / CompactMarker / ContextSnapshot / ConversationUsage / UsageJsonlLine），主进程镜像在 `electron/main/types.ts`
- `scheduler.ts` — 定时任务数据模型（ScheduledTask = CustomScheduledTask，内置任务已全量下线 / Trigger 八种含 on_task_done 任务链 / TaskRunState / RunHistoryEntry / SchedulerActivity / ScheduledTaskWithNextRun / HistoryPage），主进程镜像在 `electron/main/services/scheduler/types.ts`
- `electron.d.ts` — window.ipcRenderer 全局类型声明

## Electron 主进程入口（electron/main/index.ts）

窗口创建与生命周期；渲染层加载统一走 `getRendererPath()`（dev 为 `http://localhost:3000`，生产为 `app://dogear/index.html` 自定义协议）。`app://` 注册为 standard+secure scheme，handler 从 `process.resourcesPath/out/` 响应文件（字体扩展名显式映射 MIME，`.ttf` 等需 `font/ttf` 否则 `@font-face` 拒载；含路径穿越防护）——替代原 `file://` 加载，消除 opaque origin 下 CSS 字体等 CORS 严格资源被拦的问题；主窗口 + debug/stocks/data-center/session-window/workbench-window 各子窗口均为 `${getRendererPath()}#/路由` 拼接；broadcastSettingsChanged 定向发主窗口驱动设置刷新与会话重启

## IPC 路由（electron/main/tipc/）

- `index.ts` — 路由注册中枢，聚合所有子路由
- `windows.ts` — 窗口管理路由：openDataCenterWindow / openWorkbenchWindow；动态 import index.js 避免循环依赖，BrowserWindow 单例（数据中心 1200×800、伴随工作台默认 560×840 + 位置记忆）在 electron/main/index.ts
- `focus.ts` — 全局焦点会话：setFocusedConversation（主窗口切 tab / session-window 激活时上报，写 focused-conversation-service 内存态，值变化才广播 focusedConversationChanged）/ getFocusedConversation（伴随工作台冷启动恢复跟随）
- `pty.ts` — 真 PTY 终端路由：ptyCreate（conversationId 可 null=用户 shell）/ptyWrite/ptyResize/ptyKill/getPtyBuffer（返回快照 buffer+cols+rows+exited+exitCode，后开窗口灌历史）/listPtyTerminals（可按 conversationId 过滤）；另导出 registerPtyBroadcaster（registerTipcHandlers 调用）：把 pty-service 的 PtyEvent 桥接成 ptyCreated/ptyData/ptyExit 三个渲染层广播
- `browser.ts` — 浏览器路由 + 动作流/呈现/等待人工接线：getExtensionStatus / getBrowserActions（历史 + 状态快照）/ getPageViewState（tabs + 本窗口 presentedTabId + hasPageView，context.sender 定窗口）/ listEmbeddedTabs / reportPageViewBounds（bounds|null，null 触发 detach）/ presentEmbeddedTab（渲染层呈现按钮与 agent present 工具共用 presentation.presentTab 后端）/ dismissPresentedTab / listHumanInterventions / resolveHumanIntervention / getSelfWindowId；registerBrowserActionBridge（registerTipcHandlers 调用一次）：setBrowserStreamLaunchedProvider 注入 tab 存在性 + setBrowserActionBroadcaster → browserActionAdded 广播 + setPresentationBroadcaster → pagePresentationChanged + setHumanInterventionBroadcaster → humanInterventionChanged + setBrowserToolsActionListener → recordBrowserAction（2026-09-08 Step 6 重写）
- `agent.ts` — Agent 会话管理（RPC：创建/发送/关闭会话、权限控制）
- `ai.ts` — 通用 AI 接口（chat / summarize，占位实现）
- `article.ts` — 网络文章管理（抓取解析、列表、详情、删除）
- `notes.ts` — 笔记卡片 CRUD（createNote/getNote/listNotes/updateNote/appendNote/deleteNote/restoreNote/purgeNote/listTrashNotes/searchNotes，输入首参 workspacePath）；写操作后主进程广播 notesChanged 事件
- `tasks.ts` — 协作任务路由：listCollabTasks（六分组）/listDeletedCollabTasks/getCollabTask/reviewCollabTask/executeCollabTask（backlog→queued + kick 队列）/deleteCollabTask（软删）/restoreCollabTask/purgeCollabTask
- `notifications.ts` — 消息中心路由：listNotifications / markNotificationRead / markAllNotificationsRead（notification-center-service 单例透传；变更经 notificationsChanged 广播推送，路由仅拉初值与已读操作）
- `conversations.ts` — 对话 CRUD + 分叉（JSON 存储）
- `workspace.ts` — 工作区管理（列表、默认、文件夹选择、文件树）
- `file.ts` — 文件操作（打开文件位置）
- `explorer.ts` — 工作区文件树操作（创建/重命名/移动/复制/删除）
- `stock.ts` — 自选股行情 + 分析（12+RPC：自选股CRUD、批量行情、单股行情+自动快照、K线、分时、资金流向、每日快照查询、搜索、限流状态 + 指标计算、筛选、财务、回测等）
- `usage.ts` — 会话用量查询（getUsage：懒重算 usageSummary 后读 JSONL；getUsageStats 入参 `{workspaceId?, sinceMs}`：不传 workspaceId 时逐工作区聚合 flat，返回 stats 每行带 workspaceId 归属标识，供数据中心用量页时间分页）
- `group.ts` — 会话组 +话题生命周期 +共享区：listGroups / getGroup / createGroup / updateGroup / archiveTopic / restoreTopic / listArchivedTopics / deleteTopic / readTopicStateCard（读 background.md 状态卡供前端话题面板）/ confirmTopicChange（待确认话题变更裁决）/ listSharedFiles / read+write+deleteSharedFile / openSharedAreaInExplorer / autoArchiveStale
- `agent.ts` — Agent 会话管理，路由统一查 `getPiSessionManager()`（）：setSessionModel（接收 ModelSelection，返回 `{ ok:true; needsRestart? } | { ok:false; error }`；同 profile 换 tier 走 PiSession 快速路径，跨 profile 由前端触发会话重启）；`closeQueryBasedSession` = release 语义（refCount-1，归零即销毁），`forceCloseQueryBasedSession` = 强杀（`/clear` 走这条立刻销毁避免后台弹卡片）；`pauseQueryBasedSession` = turn 粒度暂停请求（受理后当前 run 完成进 paused，返回 `{success}` 受理与否或 `{error}`）；路由名保留旧字样是历史兼容，内部实现已纯 pi；broadcaster complete 分支挂 model-failover 钩子——success 走 clearFailoverTriedBySession 清 tried，failed 走 maybeFailoverMainSession 主会话 quota 自动切换（见 `agents/model-failover.ts`）；handleSessionNotification 为系统级提示决策单点——complete 过滤链：非 main / executor 任务轮 / 有 running 子会话（中间轮）/ cancelled 一律静默，failed 通知+error 音、success 通知+complete 音；permission 对 main（含 executor）通知+permission 音；声音经 session-notification-service.playCue 只发主窗口
- `ability.ts` — 能力包路由：getAbilityPacks（注册表 + 段模板 + 工具注册中心 + skill 模板四源聚合，10 包 + 2 系统行为段 + residentToolGroups 常驻工具组清单（dogear-history/dogear-tasks 从 tool-registry 按组名取），前端能力页唯一数据源）/ getAbilityMounts（单包三组反向索引：工作区开关态 / Profile 细闸 / 任务 toolPacksOverride 命中，读时快照）
- `scheduler.ts` — 定时任务（listTasks 含现算 nextRunAt / saveTask 全量校验含触发态合并、on_task_done 引用与环检测、toolPacksOverride 清洗，listTasks 过滤已下线 builtin 存量条目 / deleteTask 拒删 builtin 存量条目（数据保留）/ setTaskEnabled / runTaskNow 手动直跑不看 enabled / stopTask 整停（清队列+取消当前）/ listRunHistory 倒序分页（planId 过滤=任务 id + before cursor）/ getSchedulerActivity 运行快照）
- `renderer-handlers.ts` — main→renderer 事件定义（分析更新、会话消息、权限请求、usageEntryAdded、pendingCountChanged、sessionStateChanged / sessionClosed 跑步机状态原子事件、aliveConversationsChanged 存活会话集合全量广播（驱动列表竖线存活态）、failoverNotice 主会话供应商切换提示条、tasksChanged 协作任务变更、notificationsChanged 消息中心未读数广播（通知中心 service 写点推送，面板开时重拉/未开时只更徽章）、soundCue 提示音播放指令（主进程提示决策单点收敛后下发，只发主窗口，app/page.tsx 结合 backgroundOnly 设置决定是否播）、ptyCreated/ptyData/ptyExit 真 PTY 终端三事件、browserActionAdded 浏览器动作流增量、pagePresentationChanged 页面呈现状态变化（windowId+tabId，渲染层按本窗口高亮）、humanInterventionChanged 等待人工 pending 全量刷新等）；原 manualTaskDone 事件随发送方退役已删定义（2026-09-12 提示收敛）、browserDownloadProgress 事件随 browser-download-service 退役删除（Step 6）

## 业务服务（electron/main/services/）

- `conversation-service.ts` — 对话索引 CRUD + 对话级模型选择（`.dogear/conversations.json`），含 modelSelection 字段；create() 时由 tipc 注入 settings.ai.defaultModelSelection 浅拷贝，createFork() 继承父对话 modelSelection；updateModelSelection 单独维护；listByParent(workspaceId, parentConversationId) 只读查某父会话全部 role='sub' 对话（调度站 getChildrenByParent 持久层补集数据源）；含 usageSummary（applyUsageSummary 增量、recomputeUsageSummaryIfStale 懒重算）；withConversationsTxn 持锁期间 mtime 变化打 error（跨进程覆盖观测）
- `session-id-repair.ts` — sessionId 丢失启动自愈（index.ts 启动时 fire-and-forget）：扫全 workspace 的 null sessionId 会话，按 harness 文件名时间戳与 conversation.createdAt ±2s 对齐回填；不经 JsonlSessionRepo.list（其 cwd 过滤跨环境行为不一致，直接解析文件名）
- `usage/` — 会话 token 用量采集与存储
  - `usage-extractor.ts` — 从 SDK result 提取 ConversationUsageEntry 纯函数（contextWindow 查 `pi/model-catalog.ts` 目录表、modelUsage 缺失合成、工具/子代理聚合）
  - `usage-service.ts` — 用量 JSONL 读写删（`.dogear/usage/{conversationId}.jsonl`，appendEntry/appendCompactMarker/appendContext/readUsage/readUsageSince（轻量扫描聚合计时段轮次）/deleteUsage）
- `memory/` — 会话清洗 + 话题状态卡（读时同步新轨）
  - `session-paths.ts` — 会话路径解析共享 util（getClaudeConfigDir / getSdkSessionsDir / getSessionJsonlPath）：服务 PARSE_ARTICLE 及 `agent.ts` 的 `getSubAgentHistory`/`getSdkSessions`（子代理历史文件路径），与主会话 pi-session/ 的 Harness 会话路径（`pi-session-repository.ts` 的 `getSessionsRoot`）是两套不同的存储位置
  - `transcript-cleaner.ts` — 会话 JSONL 确定性去噪（cleanTranscriptFromLines 纯函数 + cleanTranscript IO，剥工具结果/系统行/思考块，保留用户+助手文字与一行工具骨架，\~20x 压缩）
  - `source-fidelity.ts` — 状态卡引用保真度校验：`buildSessionUuidIndex(workspacePath, sessionIds)` 复用 `cleanMessagesFromLines` 建「sessionId → 去噪后 uuid 集合」索引（每会话只读一次，缺文件映射为 null）；`validateItemSources` 纯函数逐条查，分三种问题——uuid_not_found（编造）/ wrong_session（张冠李戴，回告正确 sessionId）/ session_missing。**校验口径必须与 agent 所见一致**，所以复用同一个去噪函数而非 JSONL 全量 uuid
  - `notes-store.ts` — 组共享区 `_notes/` 目录读写（列出/读取，供组内 agent 优先利用 working agent 的阶段总结）
  - `background-store.ts` — 话题状态卡读写（readTopicStateCard：background.md 新 schema——topic 版本链 + 六类条目区 + sourcesSeen；旧 topic/progress 结构读时自动迁移），落 `<wsData>/groups/<groupId>/background.md`；另导出 getGroupsRootDir/getGroupDir（组目录结构唯一权威源），供读时同步与组内会话查阅
  - `review-skill-service.ts` — 历史 no-op 遗留：跨会话复盘 skill 与旧报告链路均已下线，`ensureReviewSkillInitialized` 保留空实现仅为 index.ts 启动序列兼容
  - 注：工作区主题记忆（memory-service / memory-recall / memory-fs / memory-indexer / memory-loader / memory-types）也在此目录
- `scheduler/` — 定时任务系统（一行一任务，内置任务已全量下线仅剩 custom，存量 builtin 条目由 isRetiredBuiltinTask 过滤隐藏；任务级触发器 OR 语义，分钟级 tick 调度；单例 getSchedulerService 在 index.ts 启动接线 init）：
  - `types.ts` — 数据模型（ScheduledTask = CustomScheduledTask / Trigger 八种含 on_task_done 任务链 / TaskRunState / RunHistoryEntry / SchedulerActivity / ScheduledTaskWithNextRun），渲染层镜像 `types/scheduler.ts`
  - `time-rule-engine.ts` — 时间规则纯函数（validateTrigger / nextDueAt / minNextDueAt / detectMissed / windowOpen / windowCloseAt / describeTrigger 中文摘要）
  - `plan-store.ts` — `.dogear/plans.json` 读写（`{version:2, tasks}` 容器；loadTasks 读全量（含已下线 builtin 存量条目，写路径依赖全量以保数据），模块级 readyPromise 防并发可重试；旧数组格式按任务拆条：on_plan_done 过滤 / 空计划丢弃 / builtin 存量条目原样透传 / runState 丢弃；safe-json 原子写 + 变更互斥队列；isRetiredBuiltinTask 过滤判定 / touchTriggerFired / markOnceFired / updateTaskRunState 细粒度变更）
  - `plan-validate.ts` — 保存校验纯函数（assignTaskIds / mergeFiredState 按 trigger.id 保留旧触发态 / validateTaskForSave（kind !== 'custom' 运行时防御、prompt 与 workspaceId 必填）/ on_task_done 目标存在性校验 + detectTaskCycle 任务链环检测 / KNOWN_TOOL_PACKS + sanitizeToolPacksOverride 过滤未知包名）
  - `scheduler-service.ts` — 调度核心（60s tick 按任务逐触发器求值；窗口状态机开触发关停机；handleAppStart 事件入口 + handleSessionClose(conversationId) 会话自然销毁入口——pi-session-manager 触发点下沉后唯一 on_session_close 来源：quitting 拦截 + 经 conversation-service 解析 workspace 严格相等过滤跨工作区 + fireTask 透传 triggerContext.conversationId 到 executor；启动错过检测记 missed 不补跑；runTaskManual 直调 runner 不看 enabled；task_done 完成事件触发 on_task_done 下游 fireTaskDoneDownstream；stopTask 整停转 runner.requestStop）
  - `run-history-store.ts` — `.dogear/run-history/YYYY-MM.jsonl` 按月追加 + queryHistory 倒序分页（before 语义 cursor）+ 保留 3 个月自动清理
  - `custom-agent-prompt.ts` / `custom-agent-tools.ts` — CUSTOM_AGENT 自定义任务的提示词模板与工具集组装（基础文件/搜索工具 + 常驻 memory 工具 + 可选包：toolPacksOverride 有值时完全替代工作区 enabledToolPacks，白名单 KNOWN_TOOL_PACKS 含 browser/web-mcp（2026-09-13 补齐，fallbackHint 按 browser 包是否启用二态传参），workspace 边界校验，不装 Bash）
  - `runtime/plan-runner.ts` — 单任务执行器（单例 getTaskRunner：按 task.id 防重入 / runState.cursorStartedAt 断点补记 interrupted 历史 / task_done 事件 / requestStop 走 agentTaskId cancelTask，stopRequested 按 stopReason（manual/window）标注 summary；requestStop 可带来源 triggerId，window 超时只停自己触发的运行）
  - `runtime/task-executor.ts` — 任务执行（提交 CUSTOM_AGENT 到 agent-manager Worker 池等待回调，payload 携带 toolPacksOverride，hooks.onAgentTaskId 回填 id 供停止取消，模型 fallback，token 用量提取入历史）
- `conversation-runtime-service.ts` — 会话运行时管理（多附件绑定 desktop/wechat-bot、会话快照、复用 session；detach 链路 detachAttachment / detachByConversationHolder 带可选 source 参数透传到 release——failover 换血传 forced 使其不触发调度器 on_session_close，closeConversation 走 closeSession 强杀同样不触发）
- `contract-channel-service.ts` — 契约通道校验（hasDirectContractChannel：只认直接派出关系，A 派 B 派 C 时 A 无法直连 C；dogear__SendMessage / dogear__StopSession 工具层前置校验）
- `group-service.ts` — 会话组 CRUD（`.dogear/groups/{workspaceId}.json`）：listGroups / getGroup / createGroup / updateGroup / deleteGroup / archiveGroup / restoreGroup / listActiveGroups / touchGroup（会话活动时刷新 updatedAt）；全部写方法尾部广播 conversationListChanged（结构操作 immediate，touchGroup 500ms 去抖）
- `group-shared-service.ts` — 组共享区文件读写（`.dogear/workspaces/{wsId}/groups/{groupId}/shared/`），供 group-tools 和前端 TopicPanel 使用；writeNativeFile / deleteNativeFile 尾部广播 groupDataChanged
- `auto-archive-service.ts` — 自动归档：autoArchiveStaleGroups(wsId) 筛选 updatedAt 超 30 天且不在手动文件夹的活跃组，逐个 archiveGroup；startAutoArchiveTimer 主进程启动跑一次 + 每 24h 一次（归档广播由 group-service 发出）
- `conversation-tree-service.ts` — 手动文件夹树（`.dogear/workspaces/{wsId}/conversation-tree.json`）：children 装 groupId（schemaVersion=2）；listFolders / addGroupToFolder / removeGroupFromFolder / moveGroupBetweenFolders / initializeTree；结构写方法（文件夹 CRUD / 移动 / 组挂载）尾部广播 conversationListChanged（sortGroupsByUpdatedAt 是读路径懒重排，不广播防回环）
- `workspace-json-service.ts` — 工作区 JSON 存储（`.dogear/workspaces.json`）；add / remove 尾部触发 workspace-watcher 增删起停
- `renderer-broadcast.ts` — 主进程→渲染层广播收口：broadcastToWindows 全窗口遍历；broadcastConversationListChanged（immediate / debounced 500ms 尾部去抖两档，会话与组列表域）；broadcastGroupDataChanged（TopicPanel 三数据域）
- `focused-conversation-service.ts` — 全局焦点会话状态（「最近一次被激活的会话」语义，跨窗口共享）：内存态 `{conversationId, workspaceId} | null`，setFocusedConversation 值变化才广播 focusedConversationChanged 到所有窗口（伴随工作台据此跟随，含跨工作区整窗切换）；哨兵 tab 不上报故焦点自然保持，会话删除后悬空焦点由渲染层 find 不到自然空态
- `workspace-watcher.ts` — 工作区文件树监视：每工作区递归 fs.watch 只处理 rename 事件（增删改名，忽略 change），路径段 `.` 开头或 node_modules 丢弃，500ms 尾部去抖后广播 workspaceFilesChanged；随 workspaces.json 增删起停，监听错误静默降级关闭
- `notification-center-service.ts` — 顶部消息中心聚合存储（单例 getNotificationCenterService，`.dogear/notifications.json` 全局一份，测试可 setStoragePathForTest 隔离）：条目 {id,type:'task'|'conversation',dedupeKey,title,summary?,createdAt,read,count,owner:{kind:'system'}|{kind:'conversation',conversationId},taskId?,workspaceId?,ownerLabel?}；add 同源未读聚合（dedupeKey=task:{taskId}:{kind}/conversation:{childId}:{kind}，未读同键刷新 count/时间/摘要，已读后同源新条目）、上限 100 条（超限先丢已读旧条目再丢最旧未读）、markRead/markAllRead；写点广播 notificationsChanged（载荷 unreadCount，动态 import tipc/main 防 bun test 解析炸）；写入点：任务系统级（task-service.reportTaskResult 进 review / task-queue notifyTaskInterrupted 中断×2 + notifyTask 执行失败，owner=system 跳任务面板）+ 子会话事件（delegation-tools 交付 / delegation-bridge notifyTerminalToParent 不可重调终态，均归属父会话跳父会话）；系统 toast（session-notification-service）独立保留不替代
- `settings-service.ts` — 应用设置 JSON 存储（`.dogear/settings.json`，含 permissionMode、basicToolPermissions；导出 normalizeSettings 做幂等历史设置迁移与结构修复，清理遗留 SDK 字段；normalize 尾部挂 settings-types.ts 的 normalizeFailoverChain 维护全局模型故障转移链——类型 FailoverEntry/FailoverConfig（AppSettings.failover）：新供应商追加链尾、删除供应商移出链、tier 失效回退该家首个 piModel、piModels 为空的供应商不进链，链序与 enabled 完全保留）；浏览器搜索设置项 browserProxyServer（空=禁用代理引擎仅 Bing）与 browserSearchEngine（auto/google/bing，默认 auto）也在此维护；SubAgent 能力域字段维护在 settings-types.ts（`SubAgentEnabledAbilities` 双份镜像：`SubAgentProfile.enabledAbilities.{browser,extension,web,…}`，extension/web 非布尔剔除且标记 changed；`createBrowserParseSubAgentProfile` 模板 browser+extension+web 三 true，default 模板 web: true（2026-09-13）；两个内置 Profile 均走 normalize 缺键补齐模式（旧数据只补缺失键，显式 false 是用户关闭不覆盖））；浏览器解析 Profile description 已缩减为两句选型摘要（2026-09-10 browser-consolidation：双通道分流 + 会话独占 + 指引方法论见 browser-exploration skill，全文方法论迁至 builtin skill 模板），normalizeSettings 以 `LEGACY_BROWSER_PARSE_DESCRIPTIONS` 五旧值集合（含 2026-09-08 全量方法论旧文）识别并迁移到新描述，用户自定义描述不动
- `pty-service.ts` — 真 PTY 实例管理（node-pty）：模块级 Map（terminalId → instance + buffer，按 UTF-16 字符 100K 封顶保尾部）；createTerminal（detectShell：Windows 优先 Git Bash，排除 WSL bash.exe，找不到报错提示装 Git for Windows；resolveCwd 经 workspaceRoots 边界校验）/writeTerminal（exited 幂等）/resizeTerminal/killTerminal/killConversationTerminals（doClose 随会话销毁清）/killAll/getBuffer/listTerminals；事件经 setPtyEventBroadcaster 上抛（桥接在 tipc/pty.ts 的 registerPtyBroadcaster）
- `window-state-service.ts` — 窗口位置记忆通用小工具：`.dogear/window-state.json` 按 key 存 {x,y,width,height}（safe-json 原子写），load/saveWindowBounds；当前仅 workbench-window 使用
- `ai-service.ts` — AI 接口占位（chat / summarize）
- `article-service.ts` — 网络文章抓取（V2：平台脚本优先 + Readability 兜底 + AI 失败才介入），微信公众号特殊处理
- `browser/` — 内嵌浏览器宿主（Electron WebContentsView 后台 tab，持久分区 profile，2026-09-08 浏览器统一能力计划落地；Patchright browser-manager 已退役删除）+ 浏览器扩展网关（用户真实浏览器扩展的双向命令通道，P1）：
  - `nm-bridge.ts` — NM host worker 入口（`resources/nm-host/nm-bridge-worker.cjs` 为其打包产物）：stdio ↔ named pipe 双向桥接，浏览器把扩展消息原样转发到 gateway pipe（`scripts/build-nm-manifest.mjs` 生成注册清单，allowed_origins 用 manifest.key 固定扩展 ID）
  - `nm-protocol.ts` — 帧协议（4B LE 长度前缀 + UTF-8 JSON，64MB 上限；`extension/src/nm-protocol.js` 为语义一致的独立副本，不共享文件）：`ProtocolVersion = 3` 协商（P3：加 read_state kind 递增）、6 种 P0 帧 + `command`/`command_result`/`permission_state`、`CommandKind`（observe/click/fill/read_text/**navigate**/**read_state**）与 `CommandErrorCode` 13 值联合类型（含 P2 新增 `navigation_blocked`）；tab_snapshot 帧带 `generation`（P2 代际语义：受控 tab URL 变化时递增，SW 冷启重置 0），navigate 命令帧 params 为 `NavigateCommandParams { targetUrl }`，read_state 命令帧 params 为 `ReadStateCommandParams { path? }`（旧扩展 hello v2 收 stale_protocol 引导重载）
  - `browser-gateway.ts` — NM pipe server 单例（`initBrowserGateway(appVersion)`）：单连接模型（新 hello takeOver 旧连接发 goodbye + rejectAllPending），pending map 管理命令生命周期（30s 超时/断连 disconnected/迟到 command_result 忽略）；`ExtensionStatus`（connected 分支含 extensionVersion/protocolVersion/tabId/title/url/textPreview/extractError/authorizedOrigins/**generation**）经 `setExtensionStatusBroadcaster` 注册制广播；`sendExtensionCommand(kind, params, timeoutMs=30000)` 前置校验链 not_connected → stale_protocol（protocolVersion<2）→ permission_denied（`isOriginAuthorized`：授权 origin 列表或 `<all_urls>` 全放行，url 空/非法 origin 一律拦截）；**P2**：navigate 走 `validateNavigateTarget(targetUrl, authorizedOrigins)` 目标域前置校验（非 http/https / 非法 URL / 目标未授权 → `navigation_blocked` 拒绝且命令帧不发出）并跳过「当前页域 permission_denied」校验（工作区模型：任意页可导航到已授权域），成功后 command_result `data.url` 同步 status.url；拒绝 payload 的 `currentUrl`（拒绝瞬间受控页地址）透传至 CommandError 供工具层文案拼接
  - `browser-task-meta.ts` — 动作流任务元数据 `{ kind: 'article'|'agent', conversationId?, articleId? }`（原 browser-manager.ts 内类型，退役后独立成文件）
  - `embedded/` — 内嵌宿主协议层（服务自建 WebContentsView tab，后台加载不附任何窗口，agent 与抓取服务共用）：
    - `embedded-browser-manager.ts` — 单例 getEmbeddedBrowserManager：openTab（分区 session + PAC 代理 + 诚实 UA，windowOpenHandler 全拦）/closeTab/retain/release（holder 引用计数，TTL 兜底回收）/getTab/listTabs/getView/getTabRecord；attachToWindow(tabId, window, bounds?)/detachFromWindow（呈现能力，attached 同时更新 activeTabId）；getAgentTabId/getActiveTabId(workspaceId)（agent 操作目标与用户呈现目标分离）/promoteToAgentTab/ensureInputReady（滚动/输入前置，未附窗口时屏外附载）/ensureWorkspaceProxy/dispose（before-quit 清理）
    - `types.ts` — Tab 模型 `{ tabId, source('agent-opened'|'user-connected'), workspaceId, view, url, title, generation, state, holders, attachedWindow, bounds }` + EmbeddedPageState 8 态枚举（loading/ready/login_required/verification_required/awaiting_human/rate_limited/changed_layout/crashed）
    - `tab-events.ts` — 导航事件→generation 递增 + loading/ready/crashed 基础状态流转
    - `page-state.ts` — resolvePageState(tab, pageText?) 状态机唯一入口（URL 正则 + 标题/正文关键词集中判定：登录墙/人机验证/限流，规则表与 extension/src/page-state.js 双侧同步）+ pageStateHint（非常规态给 agent 的下一步引导）
    - `cdp-session.ts` — 每tab CDP 会话复用（attachTarget）；`ax-tree.ts`/`ax-observe.ts` — CDP 无障碍语义树观察（observe/find，ref = backendNodeId@generation，全列+安全阀+role 摘要）
    - `actions.ts` — clickTab（键盘激活主路径 + synthetic 兑底，ClickResult.method 标注）/fillTab（native setter 清空 + insertText）；guard_password/guard_submit 语义拦截（ActionGuardError，规则对齐扩展通道）
    - `navigate.ts`/`wait-for.ts`/`press.ts`/`scroll.ts`/`read-state.ts` — 导航（复用 agent tab 或开新 tab + waitTabReady）/条件轮询等待/按键/文档与容器滚动（真实 wheel 优先）/`__INITIAL_STATE__` 读取（顶层概要 + path 下钻）
    - `profile.ts`/`ua.ts`/`proxy.ts` — 持久分区命名/诚实 UA/按域 PAC 代理注入（settings.browserProxyServer）
    - `fetch-page.ts` — 抓取层原语集合：loadFetchTab（超时竞速）/evalInTab/getTabHtml/promoteFetchTab（失败页切给 agent）+ presentTabWindow（验证页/登录墙挂 companion 页面视图呈现，无面板时全屏兑底）+ FetchFailureContext 结构化失败上下文
    - `presentation.ts` — 呈现服务：companion 页面视图区 bounds 上报表 + 每窗口呈现 tab 表；presentTab（工具/渲染层共用后端：tabId 直接呈现 / url 开新 tab 加载后呈现，不占 agent 当前 tab）+ dismissPresentedTab + reportPageViewBounds + presentRecordToCompanion（fetch 层静默呈现）+ setPresentationBroadcaster（pagePresentationChanged 广播）
    - `dev-selftest.ts` — `DOGEAR_EMBEDDED_BROWSER_SELFTEST=1` 门控运行时自测：observe/find/read_text/ref 失效/scroll/fill/guard 拦截/press/read_state/click/navigate/wait_for + search 成功与 parse_empty 结构化失败 + readArticle 冒烟 + awaiting_human 闭环断言
  - `human-intervention.ts` — awaiting_human 产品化（内存态不持久化）：`HumanInterventionRequest { id, tabId, reason(login_required|verification_required|guard_password|guard_submit), message, url, createdAt }`；raiseHumanIntervention（同 tab 去重覆盖）/resolveHumanIntervention（用户点「完成后继续」或状态恢复自动）/resolveInterventionsForTab（navigate 回 ready、wait_for 命中时自动解除）；pending 全量列表广播 humanInterventionChanged + 动作流 await_human 事件留痕
  - `browser-article-service.ts` — readArticleWithBrowser：渲染等待 + 展开全文启发式点击 + 翻页拼接 + DOM 登录墙检测（need_login 页面保留内嵌 tab 并呈现到 companion 页面视图，登录态持久化 profile 记住），错误归类不抛
  - `browser-search-service.ts` — searchWeb(query, opts)：引擎编排（auto 按 browserProxyServer 探测 2s 定链 / 显式引擎），降级链 Google → DDG(html) → Bing cn，验证页（/sorry/）与代理故障检测，逐级降级记录原因，三级全失败才失败；P3 加 `site` 参数（reddit/zhihu 站内引擎，见 site-search.ts）：站内尝试成功 → engine=site + meta 透传，失败自动降级「{query} site:{domain}」喂通用链（degradations 记录站点→引擎，outcome.query 反映实际搜索词）；站内降级态（effectiveQuery 带 site: 语法）对通用引擎结果做 `urlMatchesDomain`（host 精确匹配含子域）域名过滤兜底（Bing 真机无视 site: 语法），剔除非目标域结果（emit 过滤明细），过滤后为空 → 该引擎视为失败走降级/最终诚实失败（message「域名过滤后无匹配」），普通搜索路径不受影响；不抛，错误归类（empty_query/parse_empty/timeout/browser_crash）；serpUrls 参数仅测试注入用（google/ddg/bing/reddit/zhihu 五键），不暴露给工具
  - `serp-parsers.ts` — 三引擎 SERP 解析器（evaluate 内 DOM 查询，new Function 写法）：Google（#search/#rso div.g 多候选 + 广告剔除）、DDG（div.result + uddg 重定向解码 + y.js 广告剔除）、Bing（li.b_algo + b_ad 剔除）；P3：ParsedSerpItem 加 `meta?`（站内互动量一行文本）+ parseRedditSerp（old.reddit 版式：score/评论数/subreddit/时间）/ parseZhihuSerp（DOM 兑底：ContentItem 卡片作者/赞同）/ extractZhihuStateCards（知乎 __INITIAL_STATE__ 通用启发式 walk：type 谓词 + URL 派生去重，深度/节点/卡片上限防护）
  - `browser-action-stream.ts` — 浏览器动作事件汇总出口（navigate/wait/click/observe/parse/read_state/scroll/wait_for/screenshot/close/present/await_human，kind=article|agent，source 区分后端：内嵌浏览器各动作 | 'extension'（扩展工具）| 'save_article' | 'human_intervention'，供伴随面板动作流消费）；BrowserStreamStatus 的 holder 由事件活动推断（最近一次动作 60s 内视为运行中，内嵌模式无 lease 队列）、launched 经 setBrowserStreamLaunchedProvider 注入（保持本模块可在 node 环境 smoke）；extension 动作带 `conversationId`/`urlBefore`/`urlAfter`/`errorCode`/`durationMs`（仅命令耗时，策略延迟不计），语义结果枚举 result：navigated/clicked/filled | error | budget_exceeded | risk_blocked | risk_signal | busy（P3 独占拒绝）| missing_state/path_not_found/not_serializable（P3 read_state 专用）
  - `site-policy.ts` — 站点策略模块（P2，代码级不进 settings）：`SitePolicy { matchOrigins, searchUrlIncludes, delayMs, searchDelayMs, budget{maxNotes,maxSearches}, riskKeywords }`，内置小红书策略（操作间随机 15~45s / 搜索导航 30~90s、单会话预算 20 笔记/5 搜索、12 个风控关键词），`getSitePolicy(url)` origin 精确匹配未配置域返回 null（保持 P1 宽松行为）；`registerSitePolicy` 运行时注册（测试注入缩小参数用）；会话级运行时（模块内 Map）：搜索/笔记预算检查与计数（navigate 搜索 URL 计 1 搜索、read_text 无 ref 计 1 笔记带 ref 分片不计）、`markRiskBlocked` 会话×域名风控标记（命中后该会话对该域名全部扩展工具前置拒绝），进程内存无持久化；P3：`controlledBrowserBlock(url)` 受控浏览器通道封禁扩展绑定站点（readArticle/navigate 入口直接拒绝，双出路文案 2026-09-10：已挂载 dogear__extension__* 工具则改用之；未挂载（主会话默认无）则告知用户改派「浏览器解析」子会话，不重试本通道）
  - `extension-ownership.ts` — 扩展通道会话独占（P3，纯逻辑零 IO）：`acquireChannel(conversationId, now)`（同 owner 续期 / 空闲超 `IDLE_RELEASE_MS`=10min 自动释放后新 owner 可夺取 / 异 owner busy + idleMs）、`releaseChannel`（非持有者无效）、`resetChannel`（断连清零，browser-gateway handleDisconnect 接线）；无 conversationId 的 adhoc 调用不参与独占；busy 不排队直接拒（随机延迟下等待不可预期）
  - `site-search.ts` — 站内搜索引擎（P3）：`SITE_SEARCH_CONFIG`（reddit=old.reddit `sort=top&t=year` / zhihu=搜索页 type=content）、`runSiteAttempt`（navigate → zhihu waitForSelector 渲染等待 → state 优先/DOM 兑底解析，nav_failed/parse_empty 失败归类）；`readZhihuState` 用 CDP `Runtime.evaluate` 直连主世界（patchright 的 page.evaluate 落隔离世界读不到页面脚本写入的 window 全局，生产级发现）；`refineEmptyReason`（2026-09-08 browser-exploration Step 1）：parse_empty 按站点细化降级原因——zhihu 用 `page.locator('text=未搜索到相关内容')` 探测空态（tsconfig.electron 无 DOM lib 不能直访 document，未登录软登录墙服务端置空结果）、reddit 用 `/login/` URL 判据识别登录重定向（硬登录墙 302 → /login/?reason=lor2）；nav_failed 分支同判据，URL 落 /login/ 时提示未登录而非网络异常
  - `site-knowledge-service.ts` — 站点档案存储（2026-09-08 browser-exploration 计划，`.dogear/site-knowledge/{domain}.md` 两区档案：正式地图已验证 + 探索发现未验证由会话追加）：`normalizeDomain`（小写、去 www. 前缀、容忍 URL 输入、合法性校验）、`readSiteKnowledge`（存在性 + 内容，超 8KB 头部截断带提示）、`hasSiteKnowledge`、`appendSiteFinding`（探索发现区追加：单条 ≤500 字、60s 会话内相同内容去重提示已记录、自动补骨架/发现区标题，行前缀 `[日期 · 会话短id]`）；无档案域名是正常态非错误
- `notes/` — 笔记卡片数据层（存储 `<workspacePath>/.dogear/notes/` 一卡一 md，frontmatter 承载元数据，文件为真源）
  - `notes-store.ts` — IO 原语：路径/文件名生成（`<YYYYMMDD-HHmmss>-<shortid8>.md`）/手写 frontmatter 解析序列化（YAML 兼容子集，零依赖，遇 todos: 块直接忽略）/原子写/index.json 维护（不回退 .bak，损坏全量重建）/.trash 移动
  - `notes-service.ts` — CRUD 语义（唯一写入口）：create/get（永远读文件同步刷索引）/list（走索引）/update（tags/links 整体深替换）/append/remove 软删除/restore/purge/listTrash/search（tag 精确 + query 标题正文不区分大小写）；写后广播 notesChanged；note-types.ts 为 types/note.ts 主进程镜像
- `task-store.ts` — 协作任务存储层（`.dogear/tasks.json`，version 2，读时幂等迁移 v1：backlog→plan）：八状态机（rejected=执行前确定性拒绝，interrupted=执行中意外中断交用户手动处置，两者均可被申报回写 review；新边 running→interrupted、rejected→review、interrupted→review/queued/plan/done）+ createTask（upsert：plan 态同标题命中则补 planPath 不新建；planPath 可选=占位）/listTasks/listDeletedTasks（软删过滤，deletedAt 倒序）/listTasksGrouped/getTaskDetail（占位任务 planContent null 无 planError）/reviewTask/markTaskRunning/completeTask/rejectTask/interruptTask（running→interrupted，result=中断原因）/reportTaskResult（按 execSessionId 原子查找 running/interrupted/rejected 迁移 review，未命中返 null）/appendResultNote（结果摘要留痕追加进 result，不改状态）/executeTask（plan/backlog/interrupted→queued）/completeTaskManually（plan/backlog/rejected/interrupted→done）/moveTaskToBacklog（plan→backlog）/moveTaskToPlan（done/rejected/interrupted→plan）/softDeleteTask/restoreTask/purgeTask/recoverInterruptedTasks（无条件 running→interrupted 不自动重跑，返回 {recovered, recoveredTasks}）；原子写 + 文件锁；lastActiveAt 心跳已删不再写入
- `task-service.ts` — 协作任务广播包装层：create/review/markRunning/complete/reject/interrupt/reportResult/appendResultNote/execute/completeManually/cancel/move/delete/restore/purge 透传 task-store 并广播 tasksChanged（reportTaskResult/appendResultNote 仅命中才广播）；notifyTaskReview 进 review 时三通道：系统通知（带 taskId 深链）+ playCue('complete') 提示音 + 通知中心条目；recoverInterruptedTasks 无条件 running→interrupted 返回 {recovered, recoveredTasks}（>0 广播）
- `task-queue.ts` — 任务串行队列执行器（drain 循环一次跑一个 queued 任务）：取任务先验 planPath（缺失或文件不存在 → 拒 rejected「任务尚无 plan 文档」，占位任务拦截）→ origin 会话查询带退避重试（1s/5s/15s，防会话索引跨进程并发写窗口的瞬时缺失误拒；拒绝理由区分：无 originSessionId/重试后仍查不到/无话题）→ 创建执行会话（role='main'）→ markTaskRunning（此后意外中断走 safeInterrupt→interrupted，之前确定性拒绝走 safeReject→rejected）→ 按任务提示词实施（申报制结算：review 唯一入口是执行会话调 dogear__ReportTaskResult，队列不判断成功；轮结束三态——outcome 非 success → safeInterrupt，success 且仍有 running 直属子会话（getChildrenByParent 反查）→ 不结算等注入续跑，无子会话且任务仍 running → safeInterrupt 带申报引导；<task-result> 标签备用约定已删）；超时兜底 session.interrupt 后 60s 仍不收尾则 Promise.race 强制放行解锁队列（sendMessage 挂死不拖死后续）；recoverAndStartTaskQueue 启动无条件 running→interrupted + 逐任务带申报引导句的中断通知（notifyTask/notifyTaskInterrupted 均系统通知+playCue('error')+通知中心三通道）；kick() 唤醒，service 层不 import 队列避免循环依赖，由调用方 tipc/工具层 kick
- `migrate-notes-todos.ts` — 待办实体退役迁移（启动 fire-and-forget，幂等）：todos.json 人待办 → 笔记正文勾选项（带 noteId 且笔记存在 appendNote 并入尾部，否则 createNote 新卡 tags ['待办']；done → `- [x]`、due → 行尾 ` 📅 YYYY-MM-DD`）；跑完 todos.json 原子改名 .migrated 防重跑；单条失败 warn 跳过
- `skill-service.ts` — Skill 管理服务：`listSkills(workspaceId)` 扫三源目录的 SKILL.md（builtin `resources/skill-templates/` 只读模板；custom `.dogear/skills/` 全局目录，与工作区无关；user `~/.claude/skills/`）标注 source + enabled（enabled 按传入 workspaceId 的 enabledSkills，null 时全 false；写入方在能力页 skill 细开关，经 updateWorkspaceConfig 原子双写）
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
- `bigmodel-mcp-service.ts` — GLM Coding Plan 专属 MCP 轻量 client（2026-09-12 接入）：手写 JSON-RPC over streamable HTTP（不引 MCP SDK），两个端点（web_search_prime / web_reader）各自模块级连接状态——lazy initialize + 单飞防并发 + `Mcp-Session-Id` 响应头缓存回传；响应兼容纯 JSON 与 SSE（data: 行拼接取 JSON-RPC 结果）；`callBigmodelTool(endpoint, apiKey, tool, args)` 60s 超时，会话失效（HTTP 400/404/410 或 error 含 session）重置连接 re-init 重试一次；result.isError 透传；附 mock server 协议测试（JSON/SSE/重试/401/isError 五链路）

## Agent 框架（electron/main/agents/）

- `agent-manager.ts` — Worker 线程池管理器，任务队列调度，空闲 Worker 60s 自动回收

- `agent-worker.ts` — Worker 线程执行器。**两个运行时并存**：CUSTOM_AGENT（定时计划自定义任务，工具集按 `services/scheduler/custom-agent-tools.ts` 组装）与 STATE_EXTRACT（话题状态卡增量抽取）走 pi（`pi/run-once.ts`）；`PARSE_ARTICLE` 仍走 Claude Agent SDK——依赖 SDK 的 plugins skill 发现机制，pi 无对应物；主会话已完整迁移到下方 `pi-session/`，不再经过 agent-worker

- `pi/provider.ts` — pi 运行时的 provider 层：`resolvePiModel(appSettings, selection, subAgentFallback, fallback)` 按 profileId 解析出 `{ model, profile }`（`Model.id` 必须是真实模型 id，不是 profile/tier 组合）；`buildPiModels(profile)` 按 profile.piWireApi 造 anthropic-messages / openai-responses 客户端

- `pi/model-catalog.ts` — pi-ai 十个厂商目录（anthropic/openai/deepseek/zai/moonshotai/minimax/qwen-token-plan/xai/google/kimi-coding）合并的上下文窗口查表：`lookupContextWindow(modelId)` / `lookupCatalogEntry` / `FALLBACK_CONTEXT_WINDOW=200_000`；渲染层同源副本 `lib/pi-model-catalog.ts`（tsconfig 隔离无法共享，另有 `resolveModelWindow(entry)` 手填优先解析与 `parseContextInput` K/M 输入解析）；piModels 条目可带 `contextWindow` 手填窗口（主进程 provider 构造/usage 提取均按「手填 &gt; 目录 &gt; 200K」解析）

- `pi/run-once.ts` — pi 的一次性任务执行器：`runOnce({ systemPrompt, prompt, tools, model, profile, signal, maxTurns=30, onLog })`。**不抛出**，失败以 `{ ok:false, error, cancelled? }` 返回。pi 的 loop 故意没有轮次上限，这里在 `subscribe` 里数 `turn_start` 超限调 `agent.abort()`；`tool_execution_end` 带 `isError` 时以 `[tool-error]` 前缀走 onLog（四个 handler 都按该前缀落 WARN 级日志）

- `pi/tool-adapter.ts` — 运行时中立的工具定义层：`defineTool` / `ToolDef` / `toSdkServer`（给 SDK）/ `toPiTools`（给 pi，走 `z.toJSONSchema()`）。工具 handler 一律沿用 `isError: true` 约定，`toPiTools` 负责在 pi 侧翻转成 `throw`。自定义工具名自带 `dogear__` 前缀（与基础工具隔离名字空间），pi 侧不带 `mcp__server__` 前缀

- `pi-session/` — **主会话（及其派遣的子会话）运行时门面**，基于 pi-agent-core 的 AgentHarness：

  - `pi-session.ts` — `PiSession`（EventEmitter）：唯一门面类，`start()` 组装 systemPrompt/工具集/权限映射并创建 `PiHarnessAdapter`；能力拼装统一查注册表——先 `resolveAbilities`（工作区 abilityOverrides ∩ 触发条件 ∩ 子会话 Profile 细闸，见 ability-registry.ts）得 activeAbilities，段注入/agent.md 读取/工具包注册（skill 型双闸 = 包总闸 ∩ enabledToolPacks 细闸）/skill 包级剔除全部消费该结果，extension 单独走 browser 包总闸 gate（enabledToolPacks 残留 extension 静默忽略），dogear-tasks 与 dogear-history（跨会话检索）绑工作区即注册、不在包体系；skill 索引扫三源（builtin 模板 / custom `.dogear/skills/` 全局目录 / user `~/.claude/skills/`）按工作区 enabledSkills 过滤后拼 `<available_skills>`，子会话再按 Profile enabledAbilities 过滤（builtin 源：article-parser 看 article===true、browser-exploration 看 browser===true（2026-09-10 特判，Profile 勾 browser 能力即见双通道调研方法论 skill）、其余看 skills[]；custom 源看 skills[]、user 源看 customSkills[]；工具包挂载含 browser（createBrowserToolDefs 透传 workspacePath 供 save_article 落库）/extension（browser 包生效 ∩ ab.extension===true 双闸 → createExtensionToolDefs）/web-mcp（子会话 Profile enabledAbilities.web===true 细闸 → createWebMcpToolDefs，fallbackHint 按本会话有无 browser 工具三态：主会话 hasBrowser = browser 包生效 ∩ enabledToolPacks 细闸双条件（与实际挂载一致防死链，无则指引派浏览器解析子会话）、子会话按 activeAbilities.has('browser') 二态）能力域分支）；`sendMessage`/`steer`/`interrupt`/`requestPause`/`close`/`setPermissionMode`/`respondPermissionRequest` 覆盖完整生命周期、插话、权限确认、usage 采集；turn 粒度暂停（`requestPause` 置 adapter 标志，当前 run 正常收尾后进 paused 独立状态：`isPaused()` = 标志已置位 && 非 running；paused 态 sendMessage = 清标志 + prompt 即恢复，interrupt = 取消暂停并清插话队列，异常收尾不进 paused 回 idle）；非 steer 发消息前按 `contextWindow×autoCompactPercent%` 阈值自动压缩（emit 'compacting'/'compact_boundary'，失败仅提示不阻断）
  - `pi-session-manager.ts` — `PiSessionManager`（单例 `getPiSessionManager()`）：conversation-runtime-service 唯一入口，引用计数式生命周期（`retain`/`release` 归零即销毁——running 时入 orphan 保活等 settled 后 maybeCollectOrphan 回收，无跑步机保活），另有非 UI 保活计数（`acquireHold`/`releaseHold`，delegation-bridge 在有 running 直属子会话期间对父会话持有，销毁判定 = refCount==0 ∧ !isHeld ∧ !running；调起复活的父会话由 reacquireParentHolds 重挂）；存活集合广播（`getAliveConversationIds` = 内存 ∧（running ∨ isHeld），六触发点 sorted-join diff 变化才发 aliveConversationsChanged 全量广播 + tipc getAliveConversations 冷启动拉初值，驱动列表竖线存活态）；`_destroySession(sessionId, source)` 区分自然销毁/强杀：natural 时对绑定的 conversation 逐个 fire-and-forget 通知调度器 handleSessionClose（on_session_close 触发点，failedover/closeSession/closeAll 均 forced 或不走此路不触发），`bindConversation` 维护 conversationId↔sessionId 映射，订阅 PiSession 事件转发到渲染层
  - `pi-session-repository.ts` — `PiSessionRepository`（单例）：按 workspaceId 缓存 `JsonlSessionRepo` 实例，封装 `create`/`open`/`delete`/`fork`/`getSessionPath`，session 根目录固定 `<configDir>/workspaces/<workspaceId>/sessions/`
  - `pi-harness-adapter.ts` — `PiHarnessAdapter`：构造 `AgentHarness` 并做事件订阅分发，暴露 `prompt`/`steer`/`compact`/`abort` 与暂停标志控制（`requestPause`/`clearPause`/`isPauseRequested`，经 `shouldStopAfterTurn` 回调在 turn 边界生效），是 pi-session.ts 与 Harness 裸类型之间的唯一隔离层（Harness 类型不得外泄）
  - `message-converter.ts` — `convertPiEvent(event)`：把 pi `AgentEvent` 转成前端 `ExtendedSessionMessage`，供 PiSession 实时消息流使用
  - `history-adapter.ts` — `buildSessionHistory(workspaceId, sessionId)`：把 Harness branch entries 转成前端 `HistoryMessage[]`，唯一数据源是 session-history-reader.ts
  - `transcript-adapter.ts` — Harness 版逐字稿清洗：`cleanMessagesFromEntries` 去噪 + 工具骨架化，`readCleanTranscript` 提供 tail/range/uuid 三种切片读取，`buildSessionUuidIndex` 供状态卡引用保真度校验，对齐旧 SDK transcript-cleaner 语义
  - `session-history-reader.ts` — `readSessionBranchEntries(workspaceId, sessionId)`：读取 Harness session 当前 branch 的唯一入口，其他模块不得直接解析 JSONL 或触碰 Harness 内部对象；不走 repository.open 而在 reader 内 fs 逐行解析（校验规则与 branch/compaction 语义复刻上游 jsonl-storage），最后一个非空行解析失败（写入中尾行）丢弃不损历史，非末行损坏维持抛错
  - `permission-mode.ts` — `PiPermissionMode` 类型定义（`default | autoExecute`）
  - `permission-rules.ts` — 基础工具权限判定纯函数：`isBasicToolName`、`getBasicToolPermission`、`decideToolPermission`（autoExecute 放行 / 工具包放行 / 基础工具按快照映射 / 其余 ask）
  - `skill-loader.ts` — 薄封装 pi-agent-core 的 `loadSkills`/`formatSkillInvocation`：`loadSkillIndex` 扫描目录产出 `SkillEntry[]`，拼 `<available_skills>` 索引文本，`createSkillTool` 提供懒加载 Skill 工具
  - `builtin-tools.ts` — `createBuiltinFileTools(options?)`：Read/Write/Edit 复用 pi-agent-core 官方工厂；bash 双轨（`createPtyBashTool`，schema 兼容 command/timeout + run_in_background——falsy 透传委托原版零变化，truthy 调 pty-service.createTerminal 后台起终端立即返回 terminalId）+ read_terminal（无参=本会话终端概览，带 terminalId=stripAnsi 后尾部 8KB 快照）/kill_terminal（校验归属后杀）；conversationId/workspaceRoots 由 pi-session 组装时闭包注入；错误用 throw（AgentHarnessTool 层无 isError 字段，agent-loop 只在 execute throw 时置 isError）
  - `search-tools.ts` — `createSearchToolDefs(workspacePath)`：手写 Glob/Grep 工具，路径边界委托 workspace-boundary.ts
  - `usage-extractor.ts` — pi usage 采集：`accumulatePiUsage`/`extractPiUsageEntry`/`extractPiContextSnapshot`，字段映射对齐旧 SDK 口径供前端 usage 徽章零改动复用
  - `workspace-boundary.ts` — `resolveWithinWorkspace(workspacePath, candidatePath)`：路径边界校验（含符号链接逃逸拦截），供内建/搜索工具与 workspace-execution-env.ts 共用
  - `workspace-execution-env.ts` — `WorkspaceExecutionEnv`（实现 `ExecutionEnv`）：委托官方 `NodeExecutionEnv` 做实际文件 IO/子进程执行，每个带路径参数的方法前加边界校验；`createTempDir`/`createTempFile` 创建的 temp 路径记入白名单（bash 输出溢出暂存的 appendFile/readTextFile 不拦截）

- `delegation-bridge.ts` — **子会话调度站核心状态机**（单例，所有 child 会话的检测/重调/降级都经此；状态只存内存，重启即失）：状态模型（childStates 内存 Map，快照 status ∈ {running, stopped}，另带 delivered 单调交付事实 / 内部 terminalReason 死因 / consecutiveFails 连续失败计数，success 清零上限 3）；检测（wireSession 挂子会话 message 流 + createIdleWatch 滑动无进展计时 + timeout 双计时器，10 分钟无流事件判 hang）；重调（settleTerminal 终态统一结算：transient 在 MAX_RETRY 内自动 resumeChild 复活原会话，quota 错误沿全局 failover 链（settings.failover）findNextFailover 跨供应商降级，开关关闭或链耗尽直接终态通知）；通知（不可重调终态 notifyTerminalToParent 带结构化通知 {errorClass, attempts, modelTried}，经 pushToParentSession 注入父会话——running 时 PiSession.sendMessage 进 steer 排队、idle 时 prompt 立即推进下一轮，即事件驱动等待的「交付/终态自动唤醒」；父会话不在内存时 resumeParentAndDeliver 自动调起（attach 直拉 + reacquireParentHolds 重挂保活到新 sessionId + 注入，settled 后释放 bridge 的 attachment 引用）而非丢弃）；父会话保活（startChild attach 成功后 acquireParentHold——parentHoldSessionId 记录凭证，settleTerminal 不可复活分支 releaseParentHold，保证有 running 直属子会话期间父会话不因引用归零被销毁）；另导出 startChild / stopChild / markChildDelivered / getChildrenByParent（内存为主 + conversation-service listByParent 补集合并，补集按 updatedAt 降序只保留最近 10 条，转 stopped/delivered=false 快照）/ deliverMessage（通用消息投递出口，统一走 pushToParentSession 注入，返回 'queued' | 'target_inactive'）/ abortWaitsForParent（前端「中断等待」按钮：终止该父会话全部运行中子会话，标记 cancelled）/ cleanupLegacyStateFile（启动时一次性删除旧 delegation-state.json 遗留文件）

- `delegation-idle.ts` / `delegation-terminal.ts` / `delegation-resume.ts` / `delegation-lifecycle.ts` — 调度站纯逻辑层：滑动 idle 计时（createIdleWatch，超时可注入）/ 错误分类（classifyDelegationError：quota 关键词表 + MAX_RETRY + isNotifiableTerminal + buildTerminalNotice 通知文案）/ 重调决策（decideResumeOnError + buildResumePrompt 续跑提示词；quota 降级入口是 model-failover.ts 的 findNextFailover，不再从 subAgent.profiles 找 fallback）/ 完成事件分类（classifyChildCompletion → no_delivery/failed/cancelled）

- `model-failover.ts` — 模型故障转移（主/子会话共用一套全局 failover 链）：`findNextFailover(chain, currentProfileId, tried)` 纯链查找（顺位下一个未试且非当前的供应商，当前不在链走链头，全试尽返回 null 耗尽）；`maybeFailoverMainSession` 主会话编排——tipc/agent.ts 的 broadcaster complete(failed) 钩子进入，quota 且 failover.enabled 且链有下一个时 updateModelSelection → detachByConversationHolder('desktop') 销毁旧 session → attachConversation 以新模型重建 → failoverNotice 广播（前端 AgentChat 黄色提示条）→ fire-and-forget 续跑提示，per-conversation failoverTried 防回摆（complete(success) 清空）；子会话不进该编排，delegation-bridge.decideResume 只取 findNextFailover 沿链降级（tried 从 modelTried 解析 profileId 集合）

- `ability-registry.ts` — 能力包注册表（单一真源）：`ABILITY_PACKS` 10 包（prompt-only 三规则 / segment-tools 记忆·笔记·协作 / skill-packs 四包）+ `resolveAbilities`（工作区 abilityOverrides 覆盖 defaultEnabled ∩ 触发条件 ∩ 子会话 Profile 过滤（browser/web-mcp 均按 enabledAbilities 显式 true 细闸，web-mcp 2026-09-13 去 mainOnly 改 Profile 细闸），残留下线 key 静默忽略）+ `SYSTEM_BEHAVIORS`（组上下文/子会话契约两条不可关结构性段；Profile 索引已移除——该段实际受 agent-collab 包开关控制，语义归包详情）；browser 包 toolGroups = ['browser', 'dogear-extension']（扩展通道并入）+ `TOOL_PACK_TO_ABILITY`（可选工具包 → 所属 skill 型包反查，闭合主会话包总闸）+ `buildProfileAbilityMount`（Profile 维度单包判定，供 getAbilityMounts）；只做数据与解析，拼装侧（pi-session）消费其结果；单测 ability-registry.test.ts

- `session-append-templates.ts` — 系统级 append 段模板集中处（MEMORY_GUIDANCE_APPEND / NOTES_DISCIPLINE_APPEND / MAIN_AGENT_DELEGATION_APPEND / subAgentContractFor / buildSubAgentProfileIndex / WEB_RESEARCH_GUIDANCE_MAIN_APPEND + WEB_RESEARCH_GUIDANCE_SUB_APPEND（2026-09-13 联网调研分工段，主版三行动线快档直查→派浏览器解析→本地调研派普通子会话、子版两行无派单指引，web-mcp 或 browser 包任一生效时按 role 注入）），pi-session 拼装按 activeAbilities 条件引用；末尾 getSystemPromptSegments() 收集段模板 + 触发条件说明，供 tipc/ability.ts 的 getAbilityPacks 聚合段全文（原设置页直连同名路由已删）

- `agent-query-config.ts` — 共享的 SDK `query()` 配置构建器 + 设置读取入口（无 electron 依赖，Worker 线程内安全导入）：两类调用方共用——`PARSE_ARTICLE` 用它构建真正的 SDK query() 配置（主会话已迁移到 pi-session/，不再依赖本文件）；`STATE_EXTRACT`/`CUSTOM_AGENT` 等 pi 后台任务只借用 `buildQueryBaseConfig` 读取 `appSettings`，再喂给 `pi/provider.ts` 的 `resolvePiModel`，本身不发起 SDK query()

- `task-types.ts` — 任务类型（SUMMARIZE/READING_ASSIST/PARSE_ARTICLE/CUSTOM_AGENT/STATE_EXTRACT）和消息定义（含 ExtendedSessionMessage、各 Payload 源定义；各 Payload 用统一 modelSelection?: ModelSelection 字段）

- `logger.ts` — 日志工具（mainLogger / workerLogger / createTaskLogger）

- `tools/tool-registry.ts` — 工具注册表（SDK 内置工具 + 自定义工具注册，IPC 查询供设置页/代理编辑页动态加载）

- `tools/article-tools.ts` — 文章阅读工具（dogear__ReadArticle / dogear__ListArticles）

- `tools/browser-tools.ts` — 内嵌浏览器 MCP 工具（dogear-browser server，跟随 browser 能力域，组内 15 工具；原 Patchright 通道，2026-09-08 浏览器统一能力 Step 4/6 起全部走 embedded/ 宿主）：声明式入口 dogear__browser__readArticle（复用 browser-article-service，need_login 页面保留并呈现到浏览器面板 + raise 等待人工；入口对扩展绑定站点 controlledBrowserBlock 直接拒绝）+ dogear__browser__search（复用 browser-search-service，从设置读 browserSearchEngine/browserProxyServer 传入；可选 `site: 'reddit'|'zhihu'` 站内引擎——需要互动量排序时用，站内失败自动降级 site: 通用链，结果带 meta 行；登录态敏感提示：知乎未登录空结果 / Reddit 未登录跳登录页）+ dogear__browser__present（Step 6 交付工具：tabId 呈现已有标签页 / url 开新 tab 加载后呈现到 companion 页面视图区，页面即产物；presented=false 时引导用户打开浏览器面板）+ dogear__browser__save_article（读→存闭环，{title,url,content,author?,siteName?,excerpt?} 直调 saveArticleFromScript，workspacePath 由调用方显式传参——多工作区不落错库）+ dogear__browser__close（声明任务结束，实例由空闲策略回收）+ dogear__browser__screenshot（视口截图存临时 PNG 返回路径）+ 原子探索 9 工具（navigate/observe_page/find/click/fill/scroll/read_text/read_state/wait_for，ref = backendNodeId@generation，实现在 browser-atom-tools.ts 观察类 + browser-action-tools.ts 操作类）；navigate/wait_for 接线 awaiting_human（login_required/verification_required 上报、恢复/命中自动解除）；click/fill guard 拦截产生等待人工卡片；全部动作经 setBrowserToolsActionListener 转发
- `tools/extension-tools.ts` — 浏览器扩展 MCP 工具（dogear-extension server，已并入 browser 能力包作第二工具组「浏览器扩展通道」：主会话 = browser 包总闸 gate（enabledToolPacks 残留 extension 静默忽略），子会话 = browser 包生效 ∩ Profile extension===true 双闸；P2 起 5 工具、P3 加 read_state 成 6 工具、2026-09-08 browser-exploration 加 site_knowledge/site_finding 成 8 工具（实现在 extension-site-tools.ts，deps 注入）；主文件 727 行）：dogear__extension__{navigate,observe_page,click,fill,read_text,read_state,site_knowledge,site_finding} 作用于用户真实浏览器的已连接标签页（页面操作七工具描述首行统一声明「仅限已授权域名、拦截提交类操作、同一时间仅一个会话可用」+ 双链路引导「需登录态站点优先本工具组，公开网页用 dogear__browser__*」；site_knowledge/site_finding 用专属短注「只读写本地站点档案，不碰页面、不受授权域约束」——2026-09-10 browser-consolidation 改，不再注入页面操作 scope note），zod schema 与一期受控浏览器同名同义；**P3 独占 gate**（acquireGate：全部 handler 入口最前，断连 resetChannel → 有 conversationId 时 acquireChannel，busy → result='busy' isError 不排队；action=null 的非页面操作——站点档案读写——busy 不记动作流）；observe_page 链接元素带 href（IDL el.href 绝对 URL 截 400，可传 navigate 直达）；read_state 读页面 __INITIAL_STATE__（双模式：无 path 顶层概要 / path 点分下钻 8000 截断，扩展侧 world:'MAIN' 注入；预算按 conversationId×页面 URL 去重计 1 次，命令成功+风控扫描通过才计数）；执行体统一走 `runCommand` → sendExtensionCommand，失败经 `ERROR_MESSAGES`（13 个 errorCode 全覆盖中文映射）转 isError 不抛异常（navigated_away/ref_expired 拼接 currentUrl、navigation_blocked 非授权类 detail 走「无法导航：{detail}」）；navigate 支持小红书搜索直达 URL 提示，成功文案尾部拼站点档案指针（siteKnowledgePointer：有档案域名提示先读档案，无档案域名提示可用 site_finding 沉淀）；**站点策略门控**（policyGate/navigateGate，顺序：独占 gate → 风控前置拒绝 → 预算检查 → 随机延迟 → 命令 → 结果风控扫描 → 计数；site_knowledge/site_finding 读写站点档案无页面交互，不过 policyGate；observe/read_text/read_state 结果过 riskKeywords 命中即 isError + 会话级域名标记，预算超限返回含已用/剩余额度的结构化文案）；动作流 recordBrowserAction 直调（source='extension'，带 conversationId/urlBefore/urlAfter/errorCode/durationMs）
- `tools/extension-site-tools.ts` — 站点档案 MCP 工具（dogear-extension server 同组，2026-09-08 browser-exploration 计划 Step 3 自 extension-tools 拆出）：`siteKnowledgePointer(url)`（normalizeDomain 后判断 `.dogear/site-knowledge/{domain}.md` 存在性，返回 navigate 成功文案尾部指针——有档案提示先读档案；无档案也返回一句冷启动引导「本站尚无站点档案，探索后可用 site_finding 沉淀发现」——2026-09-10 browser-consolidation 改，此前无档案返回 null 零引导）+ `createSiteToolDefs(deps)`（deps 注入 readSiteKnowledge/appendSiteFinding）：dogear__extension__site_knowledge（读站点档案，无档案域名正常空态非错误）/ dogear__extension__site_finding（追加探索发现区：单条 ≤500 字、60s 内相同内容去重、isError 中文文案不抛）

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

- `tools/web-mcp-tools.ts` — GLM 联网 MCP 工具（dogear-web-mcp server，能力页「联网搜索」包）：bigmodel__webSearch（webSearchPrime，search_query+count）/ bigmodel__webReader（webReader，url）；走 GLM Coding Plan 专属 MCP 额度（bigmodel-mcp-service），API 直出快档与浏览器工具互补；每次调用 loadSettings 读 webMcpApiKey，未配置返回 isError 提示不抛异常；包注册在 ABILITY_PACKS 'web-mcp'（无 skill；子会话走 enabledAbilities.web Profile 细闸，default/浏览器解析内置模板预勾）；createWebMcpToolDefs 按 fallbackHint 三态生成描述尾段（'browser-tools' 本会话有 browser 工具保留改用指引 / 'browser-subagent' 主会话无 browser 工具改指引派浏览器解析子会话 / 'none' 子会话不提浏览器），AbilityTab 对无 Skill 包的开关直接联动 enabledToolPacks 细闸（2026-09-12 新增联动机制，有 Skill 的包仍由 skill 开关联动）


- `tools/group-tools.ts` — 会话组共享区 MCP 工具（dogear-group server：dogear__ListGroupFiles 默认列清单（relPath+大小+修改时间）、传 relPath 读单文件全文 / dogear__SaveSharedNote；供 working agent 主动写 `_notes/` 阶段总结）

- `tools/reference-tools.ts` — 跨会话检索 / 组协作引用两组 MCP 工具（2026-09-12 拆组）：常驻组 dogear-history「跨会话检索」（createHistorySearchToolDefs(workspaceId)：dogear__ListTopics 零模型列工作区全部话题 + dogear__ReadReferenceSession 读去噪原文（可尾切/区间切，可选 workspaceId 跨工作区定位）——主会话与子会话绑工作区即注册，不可关不随包）+ 协作组 dogear-reference（createReferenceToolDefs：dogear__ReadGroupBackground 读本组 background.md 结构化字段（默认精简返回：版本链只记计数、已完成只留最近 8 条，full: true 取全量）/ dogear__ListSiblingSessions 列组内兄弟会话——主会话条件 = 有组 ∩ agent-collab 包生效，子会话 = 有组 ∩ Profile reference===true；跨会话检索动线 ListTopics → ReadGroupBackground → ReadReferenceSession）

- `tools/delegation-tools.ts` — Agent 协作 MCP 工具（dogear-delegation server）：

  - 主会话工具集：`dogear__CreateSession` / `dogear__CreateSessionBatch` / `dogear__SendMessage` / `dogear__ListLinkedSessions` / `dogear__ResumeSession` / `dogear__StopSession`
  - `dogear__CreateSession(task, outputPath, title?, profile?, model?)` / `dogear__CreateSessionBatch(items[])` — model 为模型 ID 单字符串，bridge.resolveModelByTier 在所有完整 ModelProfile 的 piModels 里解析出 profileId+tier（找不到则报错并列出可用模型）；模型优先级 spec.model &gt; profile.modelSelection &gt; 主会话模型 &gt; 全局默认
  - 子会话工具集：`dogear__SendMessage` / `dogear__ListLinkedSessions`（无 Create\*/Resume/Stop，不能派孙子）
  - `dogear__SendMessage(toSessionId, message, options?)` — options.delivery=true 标记交付；工具层先过 `hasDirectContractChannel` 校验（仅直接派出关系）；目标停机时双向自动调起：自己派出的子会话走 resumeChildAndDeliver，派出自己的父会话走 bridge.resumeParentAndDeliver；均不命中才回「本次消息未能送达」警告
  - `dogear__ResumeSession(sessionId)` — 调起中断/失败的子会话续跑（复用原会话消息历史不新建副本，走 bridge.resumeChild；仅限本进程运行时跟踪中的子会话，重启后内存跟踪丢失则报错）；重试/quota 耗尽的终态通知文案会引导用它
  - 子会话交付 = `dogear__SendMessage(父sessionId, summary, { delivery: true })`，内部触发 bridge.markChildDelivered 同步 childStates 状态机与 UI 事件
  - 事件驱动等待（无挂起式等待工具）：主会话派单后输出收尾语结束回合；子会话交付/回复/终态经 bridge.pushToParentSession 注入为父会话新输入（running 时 steer 排队、idle 时 prompt 立即生效），等待期间用户插话时效与普通对话相同；UI 由 childrenByParent 派生「等待子会话交付中」展示态，不阻塞输入



> 话题状态卡链路（新轨，2026-09-11 topic-state-sync 上线；同日 state-extract-exclude-self 上线）：会话开启时 state-extract-trigger 检测滞后会话起 STATE_EXTRACT 任务（agent-worker 走 pi `runOnce`，emit_state_increment 产出结构化增量，纯代码合并落 `<wsData>/groups/<groupId>/background.md` 状态卡）；读时同步：dogear__ReadGroupBackground 经 ensureGroupFresh 现场补齐滞后会话后返回唯一最新卡（含【未能同步】明示段）；抽取触发与未提炼列表（getStaleConversations 的 excludeConversationId 参数链，注册处 conversationId → createReferenceToolDefs/buildGroupContextPrompt → ensureGroupFresh）一律排除调用者自身，自身内容由下一个会话开局补抽；开局注入的【指引】句仅在有前人状态（有话题或除自己外仍有未提炼会话）时注入，组内首个会话零浪费开局；跨话题检索动线 dogear__ListTopics → dogear__ReadGroupBackground → dogear__ReadReferenceSession（均挂 dogear-reference server）。旧组提炼（group_digest）/首页报告（review）链路已整体下线，digest.md / dashboard.md 为遗留数据保留。


> 模型选择链路：对话创建时 tipc 把 settings.ai.defaultModelSelection 浅拷贝到 conversation.modelSelection（fork 则继承父对话）→ ChatInputArea 输入框工具栏的 ModelSelector（按 Profile 分组、按 modelId 去重、空选时红字「请先选择模型」+ textarea/send 全 disable）→ 用户切换时 conversation-store.setConversationModelSelection 写库 + 同步顶层镜像 → useSendMessage 发送前 reconcile：null 拦截 toast、有变更则 client.setSessionModel(selection)；同 profile 换 tier 走 PiSession 快速路径，跨 profile 后端返回 needsRestart → triggerSessionRestart + 让用户重发；插话路径（pendingState!='idle'）跳过 reconcile 沿用会话原模型。usePendingState 派生 idle/running/flushing；StreamingIndicator flushing 态显示「队列还有 N 条插话待回复…」。

## 浏览器扩展（extension/，独立交付物，不进 tsc/eslint 工程）

- `manifest.json` — MV3：permissions 仅 nativeMessaging/activeTab/scripting/storage，**无静态 host_permissions**；`optional_host_permissions: ["<all_urls>"]`（商店审核友好申请形态，popup 手势按 origin 授权）；key 固定扩展 ID（jpabfficjncbbbkkdgjkhkmpmgehbfaa，与 NM 注册 allowed_origins 一致）
- `popup.{html,js}` — 连接/授权 UI：connect 按钮（tabs.query active tab → runtime.connectNative）+ 授权区（originFromUrl 白名单 http/https/ftp/file，非 http(s) scheme 显示「此页面无法按域名授权」；已授权显示「已授权 ✓ + 撤销」；request/remove 均在 click handler 手势内直调，完成后 sendMessage(dogear_permission_changed) 通知 SW，3s 轮询 getAll 兑底刷新）
- `src/background.js` — SW 命令分发中枢：hello（protocolVersion:2）建连 → 收 command 走 handleCommand（stale_tab → 未知 kind stale_protocol → tab_closed → navigated_away → 注入执行）→ `executeScriptWithTimeout` 8s 超时竞赛（点击导航会销毁注入上下文，executeScript 永不 settle，必须外层兑底）→ click 丢失结果走 resolveLostClickResult URL 检测兑底（已导航 = 成功 verification:'lost'）→ command_result 回推（ok 严格布尔 + 12 值 errorCode + 中文文案）；observe/read_text 成功后顺带回推 tab_snapshot；`sendPermissionState`（permissions.getAll 归一化 → storage.local 冗余 → port.postMessage permission_state，连接时与 welcome 后双推 + onAdded/onRemoved + popup 通知多触发源）
- `src/dom-actions.js` — 四纯 DOM 注入函数（executeScript 序列化约束：函数体零模块作用域引用）：observeFn（选择器组 → 可见性 → region 三分 → text_filter → 清旧 ref 重打 `data-dogear-ref` e1..eN 120 上限）/ clickFn（guard_submit 三类拦截：button[type=submit]、input[type=submit|image]、form 内无 type button；400ms settle 验证 urlBefore/After + elementGone + 正文字数）/ fillFn（guard_password：自身 password 或祖先 form 内存在 password；contenteditable 分支；三原型 native setter + input/change 事件派发（React 受控组件必需）；回读不一致 value_mismatch）/ readTextFn（带 ref 读元素 / 无 ref 读正文容器最长者，8000 截断）
- `src/nm-protocol.js` — 帧编解码器（与 electron/main/services/browser/nm-protocol.ts 语义一致，不共享文件）
- 授权链路：popup 手势 permissions.request（optional_host_permissions）→ SW getAll 归一化 → permission_state 帧 → gateway authorizedOrigins（命令前置校验纵深防御，扩展侧 executeScript 注入失败二次拦截 permission_denied）→ 设置页只读 chip；授权列表存 storage.local 兑底（SW 冷启重连后自动恢复；gateway 重连即重置授权列表，依赖扩展重推）

## 测试基建（resources/）

- `resources/browser-eval/` — 浏览器模块冒烟脚本集（runner 一律 node 执行，从 dist 导入跑前先 build:electron；`DOGEAR_CONFIG_DIR` 临时目录隔离；2026-09-08 浏览器统一能力 Step 6 随 Patchright 退役删除了 run-pipeline/run-agent 管线评测集与 mock 页，内嵌链路回归由 `DOGEAR_EMBEDDED_BROWSER_SELFTEST=1 bunx electron .` 运行时自测承接）：
  - 冒烟脚本 10 个：site-policy 45 / extension-ownership 18 / nm-protocol 6 / nm-navigate 15 / nm-read-state 14 / nav-tracker 15 / stale-protocol 5 / profile-migration 15 / site-knowledge 26 / extension-site-tools 16，全 PASS 口径
  - `electron-hooks.mjs` + `electron-stub.mjs` — node 环境 import dist 所需的 electron 模块 mock（module register hook）

## 数据存储（`.dogear/` 目录）

- `settings.json` — 应用设置（ModelProfile、Thinking、permissionMode 等）
- `notifications.json` — 顶部消息中心条目（`{version:1, entries}` 容器，最多 100 条，全局一份；notification-center-service.ts safe-json 原子写）
- `workspaces.json` — 工作区索引（id、名称、路径、默认标记）
- `conversations.json` — 对话索引（id、标题、`sessionId: string | null`——Harness 会话稳定标识、`workspaceId`、`groupId`/`role`、分叉信息、modelSelection、usageSummary）
- `plans.json` — 定时任务存储（`{version:2, tasks}` 容器，一行一任务：触发器含 lastFiredAt/once.fired，runState 仅 cursorStartedAt 断点；内置任务已全量下线不再 seed（存量 builtin 条目由消费侧过滤隐藏、拒删）；读到旧数组格式自动按任务拆条迁移；scheduler/plan-store.ts 经 safe-json 原子写）
- `run-history/YYYY-MM.jsonl` — 计划运行历史（任务级条目 + missed 错过条目，按月分文件，保留 3 个月自动清理；scheduler/run-history-store.ts）
- `conversations/` — 旧 SDK 主会话历史（迁移归档后的只读备份，不再回放/恢复，仅归档说明引用；新会话历史见下方 `workspaces/{workspaceId}/sessions/`）
- `usage/{conversationId}.jsonl` — 会话 token 用量明细（每行一条 entry 或 compact marker，删除对话/工作区时联动清理）
- `workspaces/{workspaceId}/sessions/` — 主会话（及子会话）的 Harness JSONL 会话文件，`pi-session-repository.ts` 的 `JsonlSessionRepo` 按其 cwd 编码子目录 + 时间戳文件名布局管理；`conversations.json` 的 `sessionId` 字段指向这里，不保存绝对路径
- `workspaces/{workspaceId}/groups/{groupId}/digest.md` — 组级摘要卡遗留数据（旧组提炼链路产物，已停止读写，文件保留；新轨状态卡在同目录 background.md）
- `workspaces/{workspaceId}/groups/{groupId}/background.md` — 组背景（结构化 frontmatter：topic / progress / keyDecisions / openQuestions）
- `workspaces/{workspaceId}/digests/_archive/{sessionId}.md` — 迁移前旧的会话级摘要卡备份（旧 `digests/` 仅剩 \_archive）
- `workspaces/{workspaceId}/dashboard.md` — 首页报告遗留数据（旧报告链路产物，已停止生成，文件保留）
- `workspaces/{workspaceId}/smart-categories.json` — 智能分类遗留数据（分类链已下线，主进程不再读写，文件保留）
- `workspaces/{workspaceId}/groups/{groupId}/shared/` — 组共享区（working agent 用 group-tools 读写；`_notes/` 子目录放阶段总结供组内 agent 参考）
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