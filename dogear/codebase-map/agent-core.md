# Agent 核心域（agent-core）

Agent 运行时：pi-session 门面、Worker 后台任务、工具注册、skill 加载、能力包注册表、权限、子会话派遣（delegation）、协作任务后端、模型故障转移。

## 运行时（electron/main/agents/）

- `agent-manager.ts` — Worker 线程池管理器（任务队列调度，空闲 60s 回收）；仅承载文章解析（PARSE_ARTICLE，其余后台任务均走 headless 会话链）
- `agent-worker.ts` — Worker 执行器：接收任务后分发给 `tasks/` 处理，自身只保留 Worker 生命周期/MessagePort/取消协议；任务走 pi `runOnce`
- `tasks/` — 任务 handler：task-context（handler 共享上下文类型）/parse-article-task（文章解析，article-parse-tools MCP 工具抓取；runOnce collectMessages 收集消息流水，终态经 tasks/parse-trace.ts 写留痕）/parse-trace.ts（formatParseTraceMd 留痕格式化 + writeParseTrace 写文章目录 history/run-*.md，吞错返回虚拟路径）
- `pi/provider.ts` — 按 profileId 解析 `{ model, profile }` + 按 piWireApi 造 anthropic-messages/openai-responses 客户端
- `pi/model-catalog.ts` — 十厂商上下文窗口查表；渲染层同源副本 `lib/pi-model-catalog.ts`（tsconfig 隔离无法共享）；窗口解析「手填 > 目录 > 200K」
- `pi/run-once.ts` — pi 一次性任务执行器：不抛出（`{ok:false}` 返回），turn 上限自数 turn_start；collectMessages 开启时 agent_end 同步收集消息流水（buildTranscript：user/assistant 全文+工具调用名与参数截断+工具结果截断），各返回分支透出 transcript
- `pi/tool-adapter.ts` — 运行时中立工具定义层：defineTool/toSdkServer/toPiTools（isError 约定在 pi 侧翻转成 throw）

## pi-session（主会话及子会话运行时门面）

- `pi-session.ts` — PiSession 唯一门面：生命周期/插话/权限/turn 粒度暂停（0.99.2 纯 terminate 收尾）/自动压缩（contextWindow×autoCompactPercent 阈值），无人值守接管三件套（takeOverForUnattended 记录原模式切 autoExecute / restoreFromUnattended 恢复（用户手动切过则不动）/ resolveAllPendingPermissions 批量放行）；interrupt/doClose 经 awaitAdapterOrAbandon 做 30s（ABORT_TIMEOUT_MS）超时遗弃兑底（abort 与 adapter close 共用，close 会 seal lane，中断后继续会话只在 interrupt 路径，不做 close），防终态收尾无限挂；工具集拼装与 skill 三源索引拆在 tool-assembly.ts
- `vision-shunt.ts` — 识图转派：主会话消息含图且当前模型 supportsVision≠true 时，静默用视觉模型（ai.visionModelSelection 或首个 supportsVision 模型）runOnce 识图，`<image_description>` 描述块注入主会话；模型视觉能力标记在 pi/provider.ts 的 piModels.supportsVision（缺省 false 保守）
- `content-blocks.ts` — splitContentBlocks 纯函数（Anthropic 形状 base64 image 块 → pi-ai ImageContent）
- `tool-assembly.ts` — 工具集拼装：按能力包/工具包/Profile 过滤组装全部工具组（含 skill 工具与三源扫描目录过滤：builtin/custom/user）
- `pi-session-config.ts` — PiSessionConfig 会话配置类型（conversationId/modelSelection/工作区路径/enabledToolPacks/groupId/role/executor/parentConversationId/skillsOverride——executor 场景专用权威 skill 清单，非子会话会话生效时绕过工作区 enabledSkills 与包总闸）
- `tool-usage-classify.ts` — 工具使用记录归类纯函数：classifyToolPack（toolPackMap 反查 → basic/search/tool-search/skill → null）与 resolveToolUsageSessionType（executor > schedulerTask > role）；pi-session 装配 onToolUsage 闭包时调用，写 recordToolUsage（adapter 侧 onToolUsage 回调异常只 warn）
- `pi-session-manager.ts` — 单例：引用计数生命周期（retain/release 归零销毁）+ 非 UI 保活计数（acquireHold）、存活集合广播（六触发点 diff）、销毁时通知调度器 handleSessionClose；孤儿保活布防超龄复核（orphanTimers，ORPHAN_GRACE_MS=10min，到期 refCount 0/无 hold/仍 running 才强销）
- `pi-session-repository.ts` — 按 sessionId 直查会话目录（pi-durable 目录制 `sessions/<sessionId>/{main.jsonl, session.json, doc-*.jsonl}`，repo 按会话目录 main.jsonl 定位，open/getSessionPath/fork/relocate/delete 走此路径；检索用批量定位：一次收集工作区全部会话 main.jsonl 的路径与大小）；session 根目录 `<configDir>/workspaces/<id>/sessions/`；relocateSession 跨工作区搬运（目录整体搬移+session.json cwd 改写）
- `storage-migrator.ts` — 存量 harness 会话（0.99.2 v3/v4 平铺 JSONL）→ pi-durable 目录布局一次性转换
- `legacy-session-format.ts` — 旧格式自持解析（storage-migrator 专用，不 import 旧库符号）
- `session-meta.ts` — 会话目录 sidecar 元数据（session.json：创建时间/工作区路径/数字 id）
- `pi-harness-adapter.ts` — AgentHarness（0.99.2）与 pi-session 的唯一隔离层：await AgentHarness.create 异步工厂 + lane 持有、事件按类型注册后映射转发（run_start/run_end/tool_*/compaction_end）、prompt/steer/compact/abort/close 带 BACKGROUND_CONTEXT 下沉 lane、settled 双信号去重、close() 配对 repo openSessions 生命周期
- `message-converter.ts` — pi AgentEvent → 前端 ExtendedSessionMessage（每会话一个 createMessageConverter 实例：块快照按已发送长度折算差量，message_end 按终态 entry 兑底尾部缺块，批内输出按 contentIndex 排序）
- `history-adapter.ts` — branch entries → HistoryMessage[]（数据源唯一为 session-history-reader）
- `transcript-adapter.ts` — 逐字稿去噪+工具骨架化、tail/range/uuid 切片读取、buildSessionUuidIndex
- `session-history-reader.ts` — 读 session branch 唯一入口（不走 repository.open，fs 逐行解析容错尾行）
- `permission-mode.ts` / `permission-rules.ts` — 权限类型 / 判定纯函数（autoExecute 放行 → PERMISSION_ASK_TOOLS 逐次确认（浏览器交互三工具+dogear__GitRevert）→ 工具包放行 → 快照映射 → 其余 ask）
- `skill-loader.ts` — loadSkills 封装：扫目录产 SkillEntry[]、拼 `<available_skills>`、懒加载 Skill 工具；loadAllSkillEntries 三目录共享索引（builtin/custom/user，会话装配、定时任务 sanitize 与挂载装配共用）
- `skill-scanner.ts` — skill 目录扫描器（skill-loader 底层）
- `builtin-tools.ts` — Read/Write/Edit + bash 双轨（同步路径缺省 600s 超时 SYNC_BASH_DEFAULT_TIMEOUT_S，run_in_background 委托 pty-service）+ read_terminal/kill_terminal
- `search-tools.ts` — 手写 Glob/Grep（路径边界委托 workspace-boundary；`.dogear` 数据目录默认跳过，需搜其中内容时显式指 path）
- `workspace-paths.ts` — 会话文件边界唯一计算来源：computeBasePaths = [workspacePath, ...additionalPaths, configDir] 大小写不敏感去重；configDir 顶层禁写清单 buildWriteExcludedPaths（notes/memory/workspaces/usage 等，应用数据走 dogear__* 工具）
- `usage-extractor.ts` — pi usage 采集（字段映射对齐前端 usage 徽章口径）
- `workspace-boundary.ts` — 路径边界校验（含符号链接逃逸拦截）
- `workspace-execution-env.ts` — ExecutionEnv 包装：每个带路径方法前加边界校验，temp 路径记白名单
- `list-files.ts` — ExecutionEnv.listFiles 本地实现（gitignore-aware 有界列举）

## 派遣与故障转移

- `delegation-bridge.ts` — 子会话调度站核心状态机（单例，状态仅内存）：滑动 idle 检测/超时 hang、终态统一结算（transient 自动 resume、quota 沿 failover 链降级、尾部 isRunning 守卫强杀僵死 run）、不可重调终态注入父会话（steer 排队/idle 直推）、父会话保活（parentHold）、startChild/stopChild/getChildrenByParent/deliverMessage/abortWaitsForParent
- `delegation-idle.ts` / `delegation-terminal.ts` / `delegation-resume.ts` / `delegation-lifecycle.ts` — 调度站纯逻辑层：idle 计时 / 错误分类与通知文案 / 重调决策与续跑提示词 / 完成事件分类
- `model-failover.ts` — 全局 failover 链：findNextFailover 纯链查找；maybeFailoverMainSession 主会话编排（quota→换血重建→failoverNotice 广播→续跑），子会话只沿链降级不进编排
- `unattended-retry.ts` — 无人值守退避重试编排：failover 链耗尽且 ai.unattended 开启时按 1m/5m/15m 退避（acquireHold 保活防回收），到期重置 tried + 注入 failover continue 续跑；重试预算耗尽放弃——维持报错终态 + 飞书直连推送（feishuNotifyOutlet.pushDirect）；计数不因 failover 重新接管清零（防「耗尽→重试→切链」循环），success/cancelled/开关关闭清零；feishu-notify-outlet 的 pushDirect 为不进通知中心的直连出口
- `contract-channel-service.ts`（services/）— 契约通道校验：只认直接派出关系，SendMessage/StopSession 工具层前置
- `conversation-runtime-service.ts`（services/）— 会话运行时管理：多附件绑定（desktop/feishu-bot）、attach options 透传 skillsOverride 与 enabledToolPacksOverride（undefined=跟随工作区）、release 带 forced 语义（failover/强杀不触发调度器 on_session_close）
- `tools/delegation-tools.ts` — 派遣工具：CreateSession(Batch)/SendMessage（delivery 标记、停机自动调起）/ListLinkedSessions/ResumeSession/StopSession；子会话无 Create*/Resume/Stop（不能派孙子）

## 能力包与 skill

- `ability-registry.ts` — 能力包注册表单一真源：ABILITY_PACKS 14 包（core-profile 与会话组包均已退役：前者职责由全局规则与主题记忆接住，后者随共识文档链下线——协作工具归 agent-collab 包）+ AbilityPack.category 三分类（system/context-memory/extension，ABILITY_CATEGORIES 有序常量供能力页/场景页分组）+ resolveAbilities（overrides∩触发条件∩Profile 子开关，残留下线 key 静默忽略；传 sceneOverride 时包开关走 scenePackEnabled 三级回退 sceneOverrides[scene]→abilityOverrides→defaultEnabled，memory 对子会话归场景层不查 Profile 闸；hasUserGitRepo 可选参为物理可用性探测——workspacePath/.git 存在即算，由调用方传入，场景页同款探测在 tipc/ability-scene.ts detectUserGitRepo）+ TOOL_PACK_TO_ABILITY 反查；code-workflow 包 8 skill（code-discipline=工程纪律单一来源，staged-execution=纯分步编排，实施链双核；ui-prototype=UI 改版讨论的可交互单文件 HTML 原型工作流，活文档纪律，交付 docs/design/<topic>-demo.html；其余 brainstorming/codebase-map/doc-sync/staged-impl/systematic-debugging）；会话分流为独立包 shunt（段+dogear-shunt 工具组，主会话+有工作区+属组触发，executor 拼装侧排除）；workspace-git 包（dogear-git 7 工具+git 历史意识段，有工作区且路径下有 .git 才生效——git 纪律从快照语义拆出，主/子会话同条件）；workspace-snapshot 包（dogear-snapshot 快照安全网 2 工具+安全网指引段，category system，绑定工作区即生效，不依赖用户 git 仓库）；memory 包工具组为主题记忆三件+偏好层三件（Recall/Save/ForgetMemory；画像工具随 core-profile 退役）；skill-admin 包（label「Skill 管理」，category system/segment-tools，描述「自定义 skill 的管理工具（创建/查看/更新/删除），低频能力默认关」，dogear-skill 四工具挂载，mainOnly 默认关：主会话随包闸（deferred 按需拉起），子会话 Profile 独立体系不查包；custom 源 skill 索引注入已与包闸解耦，enabledSkills 勾选即注入）
- `tipc/ability-scene.ts`（tipc/）— 场景维度能力数据底座：挂载矩阵构建（按包看场景，含系统行为详情 SYSTEM_MOUNTS_PACK_KEY；detectUserGitRepo 探测 .git 传入 resolveAbilities，保持格子展示与实际装载一致；矩阵中定时自定义任务行按 sceneOverrides.scheduler 三级回退展示，scheduler 键被执行链消费（定时任务运行会话））+ buildSceneOverview 场景总览（两层配置模型五行：四 matrix 行三态格子 switchable/forced/excluded + 一 summary 行提示词展示；定时自定义任务行 system 组六开关+shunt/scheduler 结构排除+首格基础工具 forced 合成格，开关真源 sceneOverrides.scheduler；「自定义 Skill」第四分类动态行（custom/skills 目录条目，skill 级勾选写 enabledSkills），sub/scheduler 扩展组撤格子换 groupNotes 一句话+跳转，executor 行单段通用执行模板+extensionNote；开关真源 main=abilityOverrides、sub/executor/scheduler-custom=sceneOverrides 对应键）；getSceneOverview IPC 载体，tipc/ability.ts re-export 其类型保持前端 import 兼容
- `session-append-templates.ts` — 系统级 append 段模板集中处（记忆/笔记纪律/岔题分流引导/派遣契约（含派遣成本判断节：探索类派子会话、单点修改主会话直做）/联网调研分工/git 历史意识/应用数据目录认知等），pi-session 按 activeAbilities 条件注入；应用数据目录段为系统行为、无条件注入（不归能力包）
- `skill-service.ts`（services/）— listSkills 扫三源目录标注 source+enabled；saveCustomSkill 覆盖式保存（新建 = builtin/全局重名检测 + 目录名撞车防护后建目录，已存在 = 复用 writeCustomSkill 校验写回，frontmatter 由 name/description 参数拼装）；deleteCustomSkill 按 name 解析删自定义整目录（builtin 无删除路径）
- `skill-template-service.ts`（services/）— builtin skill 模板服务（模板源 resources/skill-templates/，pi-session 直接扫描不复制进工作区）——skill-loader 三源之 builtin 的实际落点
- `tools/tool-registry.ts` — 工具注册表（SDK 内置+自定义，IPC 供设置页动态加载）
- `tools/skill-tools.ts` — 自定义 skill 管理四工具（dogear-skill 组，主会话随 skill-admin 包闸挂载（deferred 按需拉起）、子会话 Profile 独立体系不查包，权限随组免确认：SaveSkill 覆盖式保存 / GetSkill 读全文 / ListCustomSkills 带 enabled / ForgetSkill 删除；新建 skill 默认未启用，需场景页开启包并勾选才进 skill 索引）
- `tools/group-tools.ts` — 组共享区工具（ListGroupFiles/SaveSharedNote）
- `tools/reference-tools.ts` — 跨会话检索常驻组（dogear-history：ListTopics 可跨工作区/ReadReferenceSession/SearchSessions 多词检索两层漏斗——结论文件命中排前附内容与源会话指针、过程会话命中排后附片段与结论预览，after/before 时间过滤）+ 兄弟会话组（dogear-sibling：ListSiblingSessions）
- `tools/task-tools.ts` — 协作任务六工具（CreateTask/ListTasks/UpdateTask/DeleteTask/ExecuteTask/ReportTaskResult；CreateTask 必填 execProfile 标注任务类型，判断标准=任务要动代码即填 code-impl（分步与否由 plan 文档形态决定，执行会话按形态自行选用），调研/整理类填 default；UpdateTask 修正 title/planPath/execProfile 三字段（仅 plan/backlog 可改，改名查 plan 态撞名），DeleteTask 软删除无状态限制（回收站可恢复）；ListTasks/ExecuteTask 返回透出类型）
- `tools/git-tools.ts` — git 工具两函数两组（共用 gitAction/clip 等辅助，按「是否依赖用户 git 仓库」拆线）：createGitToolDefs（dogear-git，workspace-git 包，7 工具：只读五件套 Status/Diff/Log/Show/Blame + GitCommit/GitRevert 挂权限 ask）+ createSnapshotToolDefs（dogear-snapshot，workspace-snapshot 包，2 工具 GitSnapshotList/GitSnapshotRestore，描述不依赖 git 包工具）；无远端操作；服务层在 services/git-service/
- `tools/memory-tools.ts` — dogear-memory 主题记忆与偏好层六工具（Recall/Save/ForgetMemory + Save/List/ForgetPreference）定义文件：SaveMemory 写入前强制相似查重（命中拦截提示复用 slug 覆盖，forceNew 显式坚持才另起）；偏好层操作 config/preferences.md（常驻注入会话开局，同 scope 相似拦截 + replace 覆盖 + 100 行/60 条熔断拒绝写入）
- `tools/memory-checkup-tools.ts` — dogear-memory-admin 体检工具（dogear__MemoryCheckup）：纯代码检测重复对/死重/孤儿索引/垃圾文件/使用统计，无歧义直接修、有歧义出报告；挂定时任务场景（每周体检 builtin 任务，memory-checkup.ts ensureMemoryCheckupTask 启动幂等补建，报告经 CreateNote 落待议卡片）
- 功能工具定义分域：浏览器/扩展/联网 → browser.md；股票 → stocks.md；笔记/文章 → articles.md

## 协作任务后端（services/）

- `task-store.ts` — 任务存储（configDir `workspaces/{wsid}/tasks.json`，路径唯一入口 workspace-data-root.ts，全函数第一参 workspaceId；createTask/getTaskDetail 额外收工作区根做 planPath 解析）：八状态机（plan/backlog/queued/running/review/done/rejected/interrupted）、upsert 创建、申报制回写 reportTaskResult；Task.execProfile（default/code-impl，存量无字段=default，default 不落盘）；planPath 存工作区相对路径（写侧 toStoredPlanPath 归一化、读侧 resolvePlanPath 还原，存量绝对路径原样兼容；version 2→3 迁移仅 bump 版本，不再读时相对化）；文件可被同步引擎按实路径 `workspaces/{wsid}/tasks.json` 条目级合并直写（不经 withFileLock，与 plans.json 既有竞态模式一致）
- `task-service.ts` — 广播包装层（tasksChanged）；进 review 三通道通知（系统通知+提示音+通知中心）
- `task-queue.ts` — 串行队列执行器：planPath 预检→origin 会话带退避查询（origin 仅作 modelSelection/workspaceId 来源，不再依赖其 groupId）→创建执行会话（挂 hidden「任务」承载组 getOrCreateHiddenGroup，与定时「定时」组分工）→申报制结算（review 唯一入口是执行会话申报，队列不判断成功）；执行提示词走 buildExecutionPrompt 通用模板（code-impl 追加 plan 形态二选一规则行，见 task-execution-prompt.ts）；skill 按 EXEC_PROFILE_SKILLS 查表恒传 skillsOverride（'code-impl': ['code-discipline', 'staged-execution'] 双挂载，执行会话按 planPath 文档形态自行选用、仅增索引成本；default 空清单=基础版；走 skillsOverride 绕过工作区 enabledSkills 与包总闸）；超时 Promise.race 强制放行；真串行：executeOne 跑到任务终态才返回（第一轮后 superviseUntilTerminal 看护循环占用队列，等待源=执行会话轮 complete 事件+60s tick+rewire 动态重挂 session 监听，有 running 子会话即继续等，轮结束未申报且无子会话→interrupted，2h 断链保险丝防注入丢失/waitForIdle 挂死堵死队列），冲突单位是 git 工作区而非文件故不并行
- `task-execution-prompt.ts` — buildExecutionPrompt 任务执行提示词单一来源（task-queue 入队与场景页 executor 行静态展示共用）：通用模板+非空 mountedSkills 挂载行；可选 execProfile 分支——code-impl 注入按 plan 文档形态二选一规则行（stepN-*.md 分步 → staged-execution 编排逐 step 派子会话；设计文档/单文档 → 本会话直接实施，全程 code-discipline），default/缺省渲染基础版（场景页预览恒 default 形态）
- `executor-session-migrator.ts` — 启动一次性索引迁移（幂等，sessionId 自愈之后挂载）：hidden「任务运行」组更名「定时」（组 id 不变）；存量 executor 会话（executor===true 且 schedulerTaskId==null）及 agent 派出链（与 buildConversationTree 同口径，sessionId 传递闭包含孙层）改挂「任务」承载组——纯索引迁移只改 conversations.json 的 groupId，会话物理文件零移动；迁移后广播 conversationListChanged

## 其他

- `agent-query-config.ts` — 共享 SDK query() 配置构建器（无 electron 依赖，Worker 内安全）
- `task-types.ts` — 任务类型与消息定义（仅 PARSE_ARTICLE；CUSTOM_AGENT/SUMMARIZE/READING_ASSIST/STATE_EXTRACT 均已下线）
- `types/delegation.ts` — 协作契约数据模型

## 注意

- 主会话（及子会话）已完整走 pi-session，agent-worker 只承载后台任务（旧 SDK 会话实现已随迁移整体移除）
- 会话存储唯一入口 pi-session-repository.ts（`workspaces/<id>/sessions/`）；configDir `conversations/` 旧 SDK 目录已物理删除（同步引擎 RETIRED_SYNC_DIRS 退役防线恒排除，防旧版本对端推回复活）
- session-history-reader 是读 branch 唯一入口，其他模块不得直接解析 JSONL 或触碰 Harness 内部对象
- 工具 handler 一律 `isError: true` 不抛异常（pi 侧由 tool-adapter 翻转）；自定义工具名带 `dogear__` 前缀
- Model.id 必须是真实模型 id，不是 profile/tier 组合
- 协作任务结算为申报制：review 唯一入口是执行会话调 dogear__ReportTaskResult
- delegation 状态仅存内存，重启即失（旧 state 文件启动时清理）

## 数据流

- 主会话执行：Renderer → tipc.attachConversationRuntime → conversationRuntimeService → getPiSessionManager().createSession/retain → PiSession.start() → PiHarnessAdapter → AgentHarness → 工具调用 → message-converter → sessionMessage 等事件广播 → Renderer
- 子会话交付：子会话 SendMessage(delivery:true) → bridge.markChildDelivered → pushToParentSession 注入父会话（running 时 steer 排队、idle 时立即推进）→ 事件驱动等待，无挂起式等待工具
