# Agent 核心域（agent-core）

Agent 运行时：pi-session 门面、Worker 后台任务、工具注册、skill 加载、能力包注册表、权限、子会话派遣（delegation）、协作任务后端、模型故障转移。

## 运行时（electron/main/agents/）

- `agent-manager.ts` — Worker 线程池管理器（任务队列调度，空闲 60s 回收）
- `agent-worker.ts` — Worker 执行器：CUSTOM_AGENT/STATE_EXTRACT 走 pi `runOnce`；PARSE_ARTICLE 走 Claude SDK（依赖其 plugins skill 发现）
- `pi/provider.ts` — 按 profileId 解析 `{ model, profile }` + 按 piWireApi 造 anthropic-messages/openai-responses/openai-completions 客户端
- `pi/model-catalog.ts` — 十厂商上下文窗口查表；渲染层同源副本 `lib/pi-model-catalog.ts`（tsconfig 隔离无法共享）；窗口解析「手填 > 目录 > 200K」
- `pi/run-once.ts` — pi 一次性任务执行器：不抛出（`{ok:false}` 返回），turn 上限自数 turn_start
- `pi/tool-adapter.ts` — 运行时中立工具定义层：defineTool/toSdkServer/toPiTools（isError 约定在 pi 侧翻转成 throw）

## pi-session（主会话及子会话运行时门面）

- `pi-session.ts` — PiSession 唯一门面：能力拼装查 resolveAbilities、skill 三源索引（builtin 模板 `resources/skill-templates/`/custom `.dogear/skills/`/user `~/.claude/skills/`）、生命周期/插话/权限/turn 粒度暂停/自动压缩（contextWindow×autoCompactPercent 阈值）
- `pi-session-manager.ts` — 单例：引用计数生命周期（retain/release 归零销毁）+ 非 UI 保活计数（acquireHold）、存活集合广播（六触发点 diff）、销毁时通知调度器 handleSessionClose
- `pi-session-repository.ts` — 按 workspaceId 缓存 JsonlSessionRepo；session 根目录 `<configDir>/workspaces/<id>/sessions/`；relocateSession 跨工作区搬运（header 改写+双倒缓存失效）
- `pi-harness-adapter.ts` — AgentHarness 构造与事件分发，与 Harness 裸类型之间唯一隔离层
- `message-converter.ts` — pi AgentEvent → 前端 ExtendedSessionMessage
- `history-adapter.ts` — branch entries → HistoryMessage[]（数据源唯一为 session-history-reader）
- `transcript-adapter.ts` — 逐字稿去噪+工具骨架化、tail/range/uuid 切片读取、buildSessionUuidIndex
- `session-history-reader.ts` — 读 session branch 唯一入口（不走 repository.open，fs 逐行解析容错尾行）
- `permission-mode.ts` / `permission-rules.ts` — 权限类型 / 判定纯函数（autoExecute 放行 → 工具包放行 → 快照映射 → 其余 ask）
- `skill-loader.ts` — loadSkills 封装：扫目录产 SkillEntry[]、拼 `<available_skills>`、懒加载 Skill 工具
- `builtin-tools.ts` — Read/Write/Edit + bash 双轨（run_in_background 委托 pty-service）+ read_terminal/kill_terminal
- `search-tools.ts` — 手写 Glob/Grep（路径边界委托 workspace-boundary；`.dogear` 数据目录默认跳过，需搜其中内容时显式指 path）
- `workspace-paths.ts` — 会话文件边界唯一计算来源：computeBasePaths = [workspacePath, ...additionalPaths, configDir] 大小写不敏感去重；configDir 顶层禁写清单 buildWriteExcludedPaths（notes/memory/workspaces/usage 等，应用数据走 dogear__* 工具）
- `usage-extractor.ts` — pi usage 采集（字段映射对齐前端 usage 徽章口径）
- `workspace-boundary.ts` — 路径边界校验（含符号链接逃逸拦截）
- `workspace-execution-env.ts` — ExecutionEnv 包装：每个带路径方法前加边界校验，temp 路径记白名单

## 派遣与故障转移

- `delegation-bridge.ts` — 子会话调度站核心状态机（单例，状态仅内存）：滑动 idle 检测/超时 hang、终态统一结算（transient 自动 resume、quota 沿 failover 链降级）、不可重调终态注入父会话（steer 排队/idle 直推）、父会话保活（parentHold）、startChild/stopChild/getChildrenByParent/deliverMessage/abortWaitsForParent
- `delegation-idle.ts` / `delegation-terminal.ts` / `delegation-resume.ts` / `delegation-lifecycle.ts` — 调度站纯逻辑层：idle 计时 / 错误分类与通知文案 / 重调决策与续跑提示词 / 完成事件分类
- `model-failover.ts` — 全局 failover 链：findNextFailover 纯链查找；maybeFailoverMainSession 主会话编排（quota→换血重建→failoverNotice 广播→续跑），子会话只沿链降级不进编排
- `contract-channel-service.ts`（services/）— 契约通道校验：只认直接派出关系，SendMessage/StopSession 工具层前置
- `conversation-runtime-service.ts`（services/）— 会话运行时管理：多附件绑定（desktop/wechat-bot）、release 带 forced 语义（failover/强杀不触发调度器 on_session_close）
- `tools/delegation-tools.ts` — 派遣工具：CreateSession(Batch)/SendMessage（delivery 标记、停机自动调起）/ListLinkedSessions/ResumeSession/StopSession；子会话无 Create*/Resume/Stop（不能派孙子）

## 能力包与 skill

- `ability-registry.ts` — 能力包注册表单一真源：ABILITY_PACKS 13 包 + resolveAbilities（overrides∩触发条件∩Profile 子开关，残留下线 key 静默忽略）+ TOOL_PACK_TO_ABILITY 反查；会话分流为独立包 shunt（段+dogear-shunt 工具组，主会话+有工作区+属组触发，executor 拼装侧排除）
- `session-append-templates.ts` — 系统级 append 段模板集中处（记忆/笔记纪律/岔题分流引导/派遣契约/联网调研分工/应用数据目录认知等），pi-session 按 activeAbilities 条件注入；应用数据目录段为系统行为、无条件注入（不归能力包）
- `skill-service.ts`（services/）— listSkills 扫三源目录标注 source+enabled
- `tools/tool-registry.ts` — 工具注册表（SDK 内置+自定义，IPC 供设置页动态加载）
- `tools/group-tools.ts` — 组共享区工具（ListGroupFiles/SaveSharedNote）
- `tools/reference-tools.ts` — 跨会话检索常驻组（ListTopics 可跨工作区/ReadReferenceSession/ReadTopicCard 直读话题状态卡）+ 组协作组（ReadGroupBackground/ListSiblingSessions）
- `tools/task-tools.ts` — 协作任务四工具（CreateTask/ListTasks/ExecuteTask/ReportTaskResult）
- `tools/fork-session-tool.ts` — 岔题分流工具组（dogear-shunt）：dogear__ForkSession 平级新会话/新话题组，仅收到 <shunt> 标签时调用，无父子契约不等交付，orphan 保活
- 功能工具定义分域：浏览器/扩展/联网 → browser.md；股票 → stocks.md；笔记/文章 → articles.md

## 协作任务后端（services/）

- `task-store.ts` — 任务存储（`.dogear/tasks.json`）：八状态机（plan/backlog/queued/running/review/done/rejected/interrupted）、upsert 创建、申报制回写 reportTaskResult
- `task-service.ts` — 广播包装层（tasksChanged）；进 review 三通道通知（系统通知+提示音+通知中心）
- `task-queue.ts` — 串行队列执行器：planPath 预检→origin 会话带退避查询→创建执行会话→申报制结算（review 唯一入口是执行会话申报，队列不判断成功）；超时 Promise.race 强制放行

## 其他

- `services/memory/session-paths.ts` — 旧 SDK 会话路径 util（服务 PARSE_ARTICLE 与子代理历史查询）
- `agent-query-config.ts` — 共享 SDK query() 配置构建器（无 electron 依赖，Worker 内安全）
- `task-types.ts` — 任务类型与消息定义（SUMMARIZE/READING_ASSIST/PARSE_ARTICLE/CUSTOM_AGENT/STATE_EXTRACT）
- `types/agents.ts` / `types/delegation.ts` — Agent 任务类型 / 协作契约数据模型

## 注意

- 主会话（及子会话）已完整走 pi-session，agent-worker 只承载后台任务
- 两套会话存储位置：`memory/session-paths.ts`（旧 SDK 子代理历史）vs `pi-session-repository.ts`（Harness 会话），不可混用
- session-history-reader 是读 branch 唯一入口，其他模块不得直接解析 JSONL 或触碰 Harness 内部对象
- 工具 handler 一律 `isError: true` 不抛异常（pi 侧由 tool-adapter 翻转）；自定义工具名带 `dogear__` 前缀
- Model.id 必须是真实模型 id，不是 profile/tier 组合
- 协作任务结算为申报制：review 唯一入口是执行会话调 dogear__ReportTaskResult
- delegation 状态仅存内存，重启即失（旧 state 文件启动时清理）

## 数据流

- 主会话执行：Renderer → tipc.attachConversationRuntime → conversationRuntimeService → getPiSessionManager().createSession/retain → PiSession.start() → PiHarnessAdapter → AgentHarness → 工具调用 → message-converter → sessionMessage 等事件广播 → Renderer
- 子会话交付：子会话 SendMessage(delivery:true) → bridge.markChildDelivered → pushToParentSession 注入父会话（running 时 steer 排队、idle 时立即推进）→ 事件驱动等待，无挂起式等待工具
