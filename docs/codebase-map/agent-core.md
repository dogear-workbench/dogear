# Agent 核心域（agent-core）

Agent 运行时：pi-session 门面、Worker 后台任务、工具注册、skill 加载、能力包注册表、权限、子会话派遣（delegation）、协作任务后端、模型故障转移。

## 运行时（electron/main/agents/）

- `agent-manager.ts` — Worker 线程池管理器（任务队列调度，空闲 60s 回收）
- `agent-worker.ts` — Worker 执行器：接收任务后按类型分发给 `tasks/` 四模块处理，自身只保留 Worker 生命周期/MessagePort/取消协议；全部任务走 pi `runOnce`
- `tasks/` — 任务 handler 四模块：task-context（handler 共享上下文类型）/parse-article-task（文章解析，article-parse-tools MCP 工具抓取）/state-extract-task（状态卡抽取）/custom-agent-task（自定义 Agent + SUMMARIZE/READING_ASSIST；定时任务挂载 skill 走正常加载：skillsOverride 过滤三目录索引，<available_skills> 索引进 systemPrompt + Skill 工具懒加载全文）
- `pi/provider.ts` — 按 profileId 解析 `{ model, profile }` + 按 piWireApi 造 anthropic-messages/openai-responses/openai-completions 客户端
- `pi/model-catalog.ts` — 十厂商上下文窗口查表；渲染层同源副本 `lib/pi-model-catalog.ts`（tsconfig 隔离无法共享）；窗口解析「手填 > 目录 > 200K」
- `pi/run-once.ts` — pi 一次性任务执行器：不抛出（`{ok:false}` 返回），turn 上限自数 turn_start
- `pi/tool-adapter.ts` — 运行时中立工具定义层：defineTool/toSdkServer/toPiTools（isError 约定在 pi 侧翻转成 throw）

## pi-session（主会话及子会话运行时门面）

- `pi-session.ts` — PiSession 唯一门面：生命周期/插话/权限/turn 粒度暂停/自动压缩（contextWindow×autoCompactPercent 阈值）；工具集拼装与 skill 三源索引拆在 tool-assembly.ts
- `vision-shunt.ts` — 识图转派：主会话消息含图且当前模型 supportsVision≠true 时，静默用视觉模型（ai.visionModelSelection 或首个 supportsVision 模型）runOnce 识图，`<image_description>` 描述块注入主会话；模型视觉能力标记在 pi/provider.ts 的 piModels.supportsVision（缺省 false 保守）
- `content-blocks.ts` — splitContentBlocks 纯函数（Anthropic 形状 base64 image 块 → pi-ai ImageContent）
- `tool-assembly.ts` — 工具集拼装：按能力包/工具包/Profile 过滤组装全部工具组（含 skill 工具与三源扫描目录过滤：builtin/custom/user）
- `pi-session-config.ts` — PiSessionConfig 会话配置类型（conversationId/modelSelection/工作区路径/enabledToolPacks/groupId/role/executor/parentConversationId/skillsOverride——executor 场景专用权威 skill 清单，非子会话会话生效时绕过工作区 enabledSkills 与包总闸）
- `pi-session-manager.ts` — 单例：引用计数生命周期（retain/release 归零销毁）+ 非 UI 保活计数（acquireHold）、存活集合广播（六触发点 diff）、销毁时通知调度器 handleSessionClose
- `pi-session-repository.ts` — 按 workspaceId 缓存 JsonlSessionRepo；session 根目录 `<configDir>/workspaces/<id>/sessions/`；relocateSession 跨工作区搬运（header 改写+双倒缓存失效）
- `pi-harness-adapter.ts` — AgentHarness 构造与事件分发，与 Harness 裸类型之间唯一隔离层
- `message-converter.ts` — pi AgentEvent → 前端 ExtendedSessionMessage
- `history-adapter.ts` — branch entries → HistoryMessage[]（数据源唯一为 session-history-reader）
- `transcript-adapter.ts` — 逐字稿去噪+工具骨架化、tail/range/uuid 切片读取、buildSessionUuidIndex
- `session-history-reader.ts` — 读 session branch 唯一入口（不走 repository.open，fs 逐行解析容错尾行）
- `permission-mode.ts` / `permission-rules.ts` — 权限类型 / 判定纯函数（autoExecute 放行 → PERMISSION_ASK_TOOLS 逐次确认（浏览器交互三工具+dogear__GitRevert）→ 工具包放行 → 快照映射 → 其余 ask）
- `skill-loader.ts` — loadSkills 封装：扫目录产 SkillEntry[]、拼 `<available_skills>`、懒加载 Skill 工具；loadAllSkillEntries 三目录共享索引（builtin/custom/user，会话装配、定时任务 sanitize 与挂载装配共用）
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
- `conversation-runtime-service.ts`（services/）— 会话运行时管理：多附件绑定（desktop/feishu-bot）、attach options 透传 skillsOverride、release 带 forced 语义（failover/强杀不触发调度器 on_session_close）
- `tools/delegation-tools.ts` — 派遣工具：CreateSession(Batch)/SendMessage（delivery 标记、停机自动调起）/ListLinkedSessions/ResumeSession/StopSession；子会话无 Create*/Resume/Stop（不能派孙子）

## 能力包与 skill

- `ability-registry.ts` — 能力包注册表单一真源：ABILITY_PACKS 13 包（core-profile 已整链路删除，职责由全局规则与主题记忆接住）+ AbilityPack.category 三分类（system/context-memory/extension，ABILITY_CATEGORIES 有序常量供能力页/场景页分组）+ resolveAbilities（overrides∩触发条件∩Profile 子开关，残留下线 key 静默忽略；传 sceneOverride 时包开关走 scenePackEnabled 三级回退 sceneOverrides[scene]→abilityOverrides→defaultEnabled，memory 对子会话归场景层不查 Profile 闸）+ TOOL_PACK_TO_ABILITY 反查；会话分流为独立包 shunt（段+dogear-shunt 工具组，主会话+有工作区+属组触发，executor 拼装侧排除）；workspace-git 包（git 工具组+git 历史意识段，有工作区才生效，主/子会话同条件）；memory 包工具组仅剩主题记忆三工具（Recall/Save/ForgetMemory，画像工具随 core-profile 退役）
- `tipc/ability-scene.ts`（tipc/）— 场景维度能力数据底座：挂载矩阵构建（按包看场景，含系统行为详情 SYSTEM_MOUNTS_PACK_KEY）+ buildSceneOverview 场景总览（两层配置模型七行：五 matrix 行三态格子 switchable/forced/excluded + 两 summary 行提示词展示；扩展细则仅 code-workflow 有子开关，personal 行排除格不渲染、sub/scheduler 扩展组撤格子换 groupNotes 一句话+跳转，executor 行单段通用执行模板+extensionNote；开关真源 main=abilityOverrides、sub/executor/scheduler-custom=sceneOverrides 对应键、personal=personal config）；getSceneOverview IPC 载体，tipc/ability.ts re-export 其类型保持前端 import 兼容
- `session-append-templates.ts` — 系统级 append 段模板集中处（记忆/笔记纪律/岔题分流引导/派遣契约/联网调研分工/git 历史意识/应用数据目录认知等），pi-session 按 activeAbilities 条件注入；应用数据目录段为系统行为、无条件注入（不归能力包）
- `skill-service.ts`（services/）— listSkills 扫三源目录标注 source+enabled
- `tools/tool-registry.ts` — 工具注册表（SDK 内置+自定义，IPC 供设置页动态加载）
- `tools/group-tools.ts` — 组共享区工具（ListGroupFiles/SaveSharedNote）
- `tools/reference-tools.ts` — 跨会话检索常驻组（ListTopics 可跨工作区/ReadReferenceSession/ReadTopicCard 直读话题状态卡）+ 组协作组（ReadGroupBackground/ListSiblingSessions）
- `tools/task-tools.ts` — 协作任务四工具（CreateTask/ListTasks/ExecuteTask/ReportTaskResult；CreateTask 可选 execProfile 标注任务类型，agent 按「计划为分步实施文档且要动代码」判断填写，ListTasks/ExecuteTask 返回透出类型）
- `tools/git-tools.ts` — git 九工具组（dogear-git，workspace-git 能力包）：只读五件套 Status/Diff/Log/Show/Blame + GitCommit/GitRevert（挂权限 ask）/GitSnapshotList/GitSnapshotRestore；双层语义=用户 Git 仓库正式历史+自动快照安全网，无远端操作；服务层在 services/git-service/
- `tools/fork-session-tool.ts` — 岔题分流工具组（dogear-shunt）：dogear__ForkSession 平级新会话/新话题组，仅收到 <shunt> 标签时调用，无父子契约不等交付，orphan 保活
- 功能工具定义分域：浏览器/扩展/联网 → browser.md；股票 → stocks.md；笔记/文章 → articles.md

## 协作任务后端（services/）

- `task-store.ts` — 任务存储（`.dogear/tasks.json`）：八状态机（plan/backlog/queued/running/review/done/rejected/interrupted）、upsert 创建、申报制回写 reportTaskResult；Task.execProfile（default/code-impl，存量无字段=default，default 不落盘）；planPath 存工作区相对路径（version 2→3 迁移，读写侧 ensureMigrated 链式归一，工作区根外异常历史路径保持绝对，读侧 join 本端工作区根）；文件可被同步引擎经 `__ws-external__` 虚拟条目条目级合并直写（不经 withFileLock，与 plans.json 既有竞态模式一致）
- `task-service.ts` — 广播包装层（tasksChanged）；进 review 三通道通知（系统通知+提示音+通知中心）
- `task-queue.ts` — 串行队列执行器：planPath 预检→origin 会话带退避查询→创建执行会话→申报制结算（review 唯一入口是执行会话申报，队列不判断成功）；执行提示词统一走 buildExecutionPrompt 通用模板+非空 mountedSkills 挂载行（语境差异由 skill 全文承载），code-impl 传 skillsOverride=['staged-execution']（走 skillsOverride 绕过工作区 enabledSkills 与包总闸）；超时 Promise.race 强制放行

## 其他

- `group-context-builder.ts` — 会话组上下文提示词构建（pi-session 与任务执行会话共用）
- `agent-query-config.ts` — 共享 SDK query() 配置构建器（无 electron 依赖，Worker 内安全）
- `task-types.ts` — 任务类型与消息定义（SUMMARIZE/READING_ASSIST/PARSE_ARTICLE/CUSTOM_AGENT/STATE_EXTRACT）
- `types/delegation.ts` — 协作契约数据模型

## 注意

- 主会话（及子会话）已完整走 pi-session，agent-worker 只承载后台任务（旧 SDK 会话实现已随迁移整体移除）
- 会话存储唯一入口 pi-session-repository.ts（`workspaces/<id>/sessions/`）；项目根 `conversations/` 旧目录只读归档不再回放
- session-history-reader 是读 branch 唯一入口，其他模块不得直接解析 JSONL 或触碰 Harness 内部对象
- 工具 handler 一律 `isError: true` 不抛异常（pi 侧由 tool-adapter 翻转）；自定义工具名带 `dogear__` 前缀
- Model.id 必须是真实模型 id，不是 profile/tier 组合
- 协作任务结算为申报制：review 唯一入口是执行会话调 dogear__ReportTaskResult
- delegation 状态仅存内存，重启即失（旧 state 文件启动时清理）

## 数据流

- 主会话执行：Renderer → tipc.attachConversationRuntime → conversationRuntimeService → getPiSessionManager().createSession/retain → PiSession.start() → PiHarnessAdapter → AgentHarness → 工具调用 → message-converter → sessionMessage 等事件广播 → Renderer
- 子会话交付：子会话 SendMessage(delivery:true) → bridge.markChildDelivered → pushToParentSession 注入父会话（running 时 steer 排队、idle 时立即推进）→ 事件驱动等待，无挂起式等待工具
