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
- `app/stocks/page.tsx` — 自选股行情页面，双栏布局（自选股列表 + 个股详情）
- `app/agent-monitor/page.tsx` — Agent Worker 池状态监控仪表板
- `app/debug/page.tsx` — 开发调试窗口，集成 AgentChat 测试

## 业务组件（components/）

- `agent-chat/` — AI 聊天模块（从原 AgentChat.tsx 拆分，~20 文件）
  - `AgentChat.tsx` — 主组件（~250行），组合 hooks + 布局 + 右侧工具轨道 + Minimap 集成
  - `ChatInputArea.tsx` — 输入区域（引用芯片、图片预览、textarea、工具栏、斜杠命令菜单）
  - `MessageItem.tsx` — 单条消息渲染（用户/助手/isMeta消息、长文本折叠、sticky 冻结、分叉/编辑按钮）
  - `ContentBlockItem.tsx` — 内容块路由（text/tool_use/thinking/permission/askUser/compact_boundary）
  - `MessageMinimap.tsx` — 消息小地图（按轮次聚合、视口指示、跳转、hover 展开/固定）
  - `SearchBar.tsx` — 搜索浮条（Ctrl+F 快捷键、文本匹配高亮、激活项自动滚动）
  - `ThinkingBlock.tsx` — 思考块（compact/detailed 两种展示模式）
  - `StreamingIndicator.tsx` — 运行状态指示器（思考中/执行工具/生成中）
  - `AskUserQuestionCard.tsx` — AskUser 问题卡片（单选/多选）
  - `PermissionRequestCard.tsx` — 权限请求卡片（允许/拒绝/始终允许）
  - `CitationBadge.tsx` — 引用徽章
  - `CollapsibleBlock.tsx` — 可折叠块基础组件
  - `SubAgentPanel.tsx` — 子 Agent 面板
  - `SubAgentBlock.tsx` — 子 Agent 块
  - `highlight.ts` — 搜索高亮工具（mark 黄底 + active 橙底 ring）
  - `minimap-utils.ts` — 消息预览提取工具函数
  - `transformers.ts` — 消息转换工具（历史回放末尾调 injectTaskSummary 吸附任务汇总块）
  - `task-aggregator.ts` — Task* CRUD 聚合纯函数（aggregateTasks / injectTaskSummary），把分散的 TaskCreate/TaskUpdate 合成单个 task_summary 虚拟块
  - `types.ts` — 类型定义（Message、ContentBlock，含 isMeta/isCompactBoundary/task_summary 等字段）
  - `utils.ts` — 工具函数（getUserMessageSearchableText 等）
  - `hooks/` — 自定义 hooks（11 个）
    - `useAgentSession.ts` — 会话生命周期（创建/resume/fork/关闭）
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
- `ConversationList.tsx` — 对话列表（headless-tree 拖放树，支持文件夹/重命名/分叉标记/归档）
- `WorkspaceSwitcherPopover.tsx` — 顶部导航栏工作区切换器（选择/添加，里程碑 1.5 Step A2.4）
- `WelcomeFirstRun.tsx` — 零工作区首次启动引导卡片（里程碑 1.5 Step A2.4）
- `WorkspaceRuleDialog.tsx` — 工作区规则 Dialog（.claude/CLAUDE.md 编辑器，里程碑 1.5 Step A2.6）
- `EmptyFocusState.tsx` — 无聚焦对话时的占位（里程碑 1.5 Step A2.5）
- `MarkdownRenderer.tsx` — Markdown 渲染器，GFM + 代码高亮
- `ConfirmDialog.tsx` — 全局确认弹窗（基于 shadcn AlertDialog，由 confirm-store 驱动）
- `StatusPulse.tsx` — 状态脉冲指示器（蓝色=等待确认，橙色=运行中），支持 sm/md 两种尺寸
- `ArticleParseHistoryPanel.tsx` — 网络文章解析历史面板，追踪 script/readability/ai 状态
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
- `conversation-store.ts` — 对话状态：对话列表、选中对话、分叉参数、编辑重发、人设关联（updateConversationPersona）、会话重启触发（sessionRestartTrigger）
- `reference-store.ts` — 引用状态：引用文章列表、引用片段（用户选中文字）
- `slash-command-store.ts` — 斜杠命令状态：SDK + 自定义命令合并、capabilities 更新
- `settings-store.ts` — 应用设置：加载/保存/重启会话（整体 save 模式）
- `ui-store.ts` — UI 状态：设置 overlay 开关、右侧面板折叠（rightPanelOpen）
- `confirm-store.ts` — 全局确认弹窗：confirm() 返回 Promise，showConfirm() 简化版
- `stock-store.ts` — 自选股状态：watchlist/quotes/K线/分时/资金流向/搜索/RateLimiter 状态

## 工具函数（lib/）

- `client.ts` — tipc 客户端，window.ipcRenderer 通信入口
- `utils.ts` — cn() 类名合并工具
- `events.ts` — tipc 事件处理入口，监听主进程事件
- `sdk/index.ts` + `sdk/query.ts` — Claude Agent SDK 的 query 函数封装

## 类型定义（types/）

- `article.ts` — ArticleMeta / Article / QuoteSnippet
- `ai.ts` — AIInteraction / AIMessage
- `settings.ts` — ThinkingConfig / Persona / ModelProfile / AppSettings / DEFAULT_SETTINGS / BUILTIN_DEFAULT_SYSTEM_PROMPT
- `agents.ts` — TaskStatus / TaskType / AgentTask / ForkParams
- `electron-api.ts` — Workspace / WorkspaceFileNode / ExtendedSessionMessage / Citation / Conversation（含 persona_id/temp_prompt）
- `stock.ts` — WatchlistItem / StockQuote / KLineDataPoint / TimelinePoint / MoneyFlowPoint / StockSearchResult / DailySnapshot / QUOTE_FIELD_MAP / RateLimiterStatus
- `usage.ts` — 会话用量数据模型（ConversationUsageEntry / CompactMarker / ContextSnapshot / ConversationUsage / UsageJsonlLine），主进程镜像在 `electron/main/types.ts`
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
- `digest.ts` — 会话摘要卡巡检（listDigests / readDigest / triggerDigest 手动提炼 / get+setDigestModelTier 档位 / get+setDigestProfileId 独立模型方案 / getDigestActivity 提炼活动轮询 / get+setDigestPrompt 提示词读写 / cancelDigest 取消任务）
- `renderer-handlers.ts` — main→renderer 事件定义（分析更新、会话消息、权限请求、usageEntryAdded 等）

## 业务服务（electron/main/services/）

- `conversation-service.ts` — 对话索引 CRUD + 人设关联（`.dogear/conversations.json`），含 personaId/tempPrompt 字段 + usageSummary（applyUsageSummary 增量、recomputeUsageSummaryIfStale 懒重算）
- `usage/` — 会话 token 用量采集与存储
  - `usage-extractor.ts` — 从 SDK result 提取 ConversationUsageEntry 纯函数（含 MODEL_CONTEXT_WINDOWS 兜底表、modelUsage 缺失合成、工具/子代理聚合）
  - `usage-service.ts` — 用量 JSONL 读写删（`.dogear/usage/{conversationId}.jsonl`，appendEntry/appendCompactMarker/appendContext/readUsage/deleteUsage）
- `memory/` — 会话清洗 + 提炼闭环（里程碑 2 Phase A）
  - `session-paths.ts` — 会话路径解析共享 util（getClaudeConfigDir / getSdkSessionsDir / getSessionJsonlPath，agent.ts 复用）
  - `transcript-cleaner.ts` — 会话 JSONL 确定性去噪（cleanTranscriptFromLines 纯函数 + cleanTranscript IO，剥工具结果/系统行/思考块，保留用户+助手文字与一行工具骨架，~20x 压缩）
  - `digest-store.ts` — 摘要卡读写（DigestCard 序列化/解析、saveDigest/readDigest/listDigests）+ 留底干净稿（_cleaned/）；落 `<configDir>/workspaces/<wsId>/digests/`
  - `digest-prompt.ts` — 提炼提示词模板（DEFAULT_DIGEST_PROMPT + loadDigestPrompt 播种 `<configDir>/digest-prompt.md` + saveDigestPrompt 写入，设置页可编辑）
  - `digest-scanner.ts` — 脏检查（isDirty 纯函数按 JSONL mtime vs 卡 sourceMtime；findDirtySessions / scanAllWorkspaces）
  - `digest-trigger.ts` — 提炼编排（串行队列并发=1 + in-flight 去重；triggerScanAll / triggerScanByConversation；提交 DIGEST_SESSION 任务）+ 提炼活动采集（current / queueDepth / recent 环形缓冲 / lastScan，classifyOutcome 判 saved/no-card/error，getDigestActivity 供前端轮询）
  - 注：里程碑1 的工作区主题记忆（memory-service / memory-recall / memory-fs / index）也在此目录
- `conversation-runtime-service.ts` — 会话运行时管理（多附件绑定 desktop/wechat-bot、会话快照、复用 session）
- `workspace-json-service.ts` — 工作区 JSON 存储（`.dogear/workspaces.json`）
- `settings-service.ts` — 应用设置 JSON 存储（`.dogear/settings.json`，含 permissionMode、personas、defaultSystemPrompt、permissionRules.allow/deny；导出 appendPermissionAllowRules 供权限请求"始终允许"持久化）
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
  - `index.ts` — barrel export

## Agent 框架（electron/main/agents/）

- `agent-manager.ts` — Worker 线程池管理器，任务队列调度，空闲 Worker 60s 自动回收
- `agent-worker.ts` — Worker 线程执行器，与 Claude Agent SDK 交互
- `query-based-session.ts` — 基于 query() 的会话（支持 resume/fork/skills/MCP/权限/人设/临时提示词），systemPrompt 统一 preset+append 模式
- `task-types.ts` — 任务类型（SUMMARIZE/CHAT_SESSION/PARSE_ARTICLE/DIGEST_SESSION）和消息定义（含 ExtendedSessionMessage、DigestSessionPayload 源定义）
- `logger.ts` — 日志工具（mainLogger / workerLogger / createTaskLogger）
- `tools/tool-registry.ts` — 工具注册表（SDK 内置工具 + 自定义工具注册，IPC 查询供设置页/代理编辑页动态加载）
- `tools/article-tools.ts` — 文章阅读工具（ReadArticle / ListArticles）
- `tools/stock-tools.ts` — 自选股工具（SearchStock / GetStockQuote / GetKLineData / GetTimeline / GetWatchlist / ModifyWatchlist）
- `tools/stock-analysis-tools.ts` — 股票分析工具（新增，7个）
  - CalcIndicators：计算技术指标（MA/EMA/MACD/RSI/KDJ/BOLL/ATR 等）
  - ScreenStocks：全市场条件筛选（基本面/技术指标/公式）
  - GetFinancials：财务数据查询（营收/净利润/ROE 等）
  - CompareIndustry：行业内对比分析
  - DetectSignals：技术信号检测（MACD金叉/RSI超卖 等）
  - EvalFormula：执行用户自定义公式（screener/signal/score）
  - SimpleBacktest：简单策略回测
- `tools/digest-tools.ts` — 会话提炼 MCP 工具（dogear-memory-digest server：CleanTranscript 去噪+留底 / ReadExistingDigest / SaveDigest）
- `skills/chat-skill.ts` — 对话技能（ChatSession / ChatSessionManager）

> 会话提炼链路：脏检查（digest-scanner）三触发点（启动扫/夜间03点/关会话）→ digest-trigger 串行起 DIGEST_SESSION 任务（采集活动状态含 taskId 供「会话摘要」设置 Tab 轮询 + 停止）→ agent-worker.handleDigestSessionTask 一次性 query（模型按 digestProfileId 指定的独立方案 + digestModelTier 档位重建凭证 env，缺省回退主会话 activeProfile，方案不完整即返回明确 error，haiku 不传 effort；query 接 AbortController，cancelDigest → cancelTask 真正中断）→ agent 自调 digest-tools 三工具 → 摘要卡落 `<configDir>/workspaces/<wsId>/digests/<sessionId>.md`

## 数据存储（`.dogear/` 目录）

- `settings.json` — 应用设置（ModelProfile、Thinking、permissionMode 等）
- `workspaces.json` — 工作区索引（id、名称、路径、默认标记）
- `conversations.json` — 对话索引（id、标题、sdkSessionId、workspaceId、分叉信息、personaId、tempPrompt、usageSummary）
- `conversations/` — SDK 会话历史（Agent SDK 自动管理）
- `usage/{conversationId}.jsonl` — 会话 token 用量明细（每行一条 entry 或 compact marker，删除对话/工作区时联动清理）
- `workspaces/{workspaceId}/digests/{sessionId}.md` — 会话摘要卡（frontmatter + 概述 + 想法/注意/决策条目带回溯 uuid）
- `workspaces/{workspaceId}/digests/_cleaned/{sessionId}.md` — 提炼留底干净逐字稿（质量排查用）
- `digest-prompt.md` — 会话提炼提示词模板（全局单份，首次缺失自动播种，可编辑）
- `stocks/watchlist.json` — 自选股列表
- `stocks/formulas.json` — 用户公式存储（screener/signal/score 三种类型）（新增）
- `stocks/kline/{market}.{code}.jsonl` — K线历史数据（JSONL，每行一条 KLineDataPoint）
- `stocks/daily/{market}.{code}.jsonl` — 每日快照数据（JSONL，getQuote 时自动采集，按 tradeDate 去重）

## 关键数据流

- **IPC 通信**：Renderer → tipc.invoke() → Main tipc handler → service（JSON 文件读写） → renderer events 回传
- **Agent 执行**：Renderer → tipc.createQueryBasedSession → QueryBasedSession → query() SDK → MCP Tools → sessionMessage events → Renderer
- **工作区文件树**：workspace/getFiles → articleService.listArticleTree + workspaceFsService.scan → 合并返回
- **自选股行情**：Renderer → stock-store → tipc/stock → stockService（通过 RateLimiter 防护）→ 腾讯/东方财富/新浪 API → 返回解析后数据（getQuote 同时 fire-and-forget 写入每日快照 JSONL）
- **股票分析**（新增）：AI 调用分析工具 → TypeScript handler → Python Bridge → Python 计算层（指标/筛选/公式/回测）→ 返回结果给 AI
