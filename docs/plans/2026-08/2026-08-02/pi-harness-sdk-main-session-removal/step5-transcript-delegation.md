---
step: 5
title: Transcript、组摘要与 Delegation 迁移
status: done
---

## 目标

将会话逐字稿、组摘要、引用保真度和跨会话协作从 sdkSessionId / SDK JSONL 收敛到 Harness sessionId 与统一的 transcript adapter。

## 依赖上下文（接力棒输入）

- 前置 step 产出：Conversation 的 `sessionId` 是新主会话唯一持久化标识；Harness repository 可以打开 session 并读取当前 branch 的 entries。
- 历史 adapter 已定义 Harness message / compaction 的展示转换，但 transcript 需要面向摘要和 source fidelity 的稳定、可追溯 UUID 口径。
- 当前 SDK transcript 链路集中于 `electron/main/services/memory/session-paths.ts`、`transcript-cleaner.ts`、`group-digest-scanner.ts`、`source-fidelity.ts` 和 `agents/tools/digest-tools.ts`。
- 当前 delegation 协议、bridge 和工具以 `sdkSessionId` 作为跨会话地址，集中于 `electron/main/agents/delegation-bridge.ts` 与 `electron/main/agents/tools/delegation-tools.ts`。
- 旧归档会话必须排除在 dirty scan、摘要、引用校验和 delegation 之外。
- 已知现状缺口：`pi-session.ts` 的 `getSdkSessionId()` 目前硬编码返回 `undefined`（注释仍是 Step 2A 之前"pi 无持久化 session_id"的过时描述，未随 Step 2A 引入的 Conversation `sessionId` 更新）。这导致当前所有走 pi 的主会话调用 `CreateSession` 派子会话时，`delegation-bridge.ts` 因 `parent.sdkSessionId` 恒为空而放弃写 `contractMetadata`（仅 warn 日志，不报错），协作溯源实际失效。本步骤需要在切换协议命名的同时修复这一点：Harness 会话创建后应让 `getSdkSessionId()`（或其更名后的等价方法）返回真实的 Harness `sessionId`。
- **补充（2026-08-04 已提前完成）**：上一条列出的 delegation 协议路由/角色/sessionId 双写问题已经在独立计划 `docs/plans/2026-08/2026-08-04/delegation-pi-session-routing-fix/plan.md` 中修复并端到端验收通过，不需要在本 step 重复处理。具体完成内容：
  - `PiSessionConfig` 新增 `role: 'main' | 'sub'` 字段并正确透传给 `dogear-delegation` 工具包组装逻辑（子会话现在拿到受限工具集：只有 `SendMessage`/`WaitForMessage`/`ListLinkedSessions`，没有 `CreateSession`/`CreateSessionBatch`/`StopSession`）。
  - `PiSession.getSdkSessionId()` 已改为返回真实 Harness `sessionId`（`this.config.harnessSessionId ?? undefined`），不再恒为 `undefined`。
  - `conversation-runtime-service.ts` 的 `attachConversation` 已把 `conversation.role` 传给 `PiSessionConfig.role`；Harness session 创建成功后同时双写 `conv.sessionId` 和 `conv.sdkSessionId`（两字段保持同值，字段名均未改动/未合并）。
  - `delegation-bridge.ts` 的 `wireSession`/`startChild`/`stopChild`/`deliverMessage` 已全部从 `QueryBasedSession`/`getQueryBasedSessionManager()` 切换到 `PiSession`/`getPiSessionManager()`，不再有 SDK 运行时依赖；不会触发的 `session_init` 死代码监听已删除。
  - 端到端手测已验证：`CreateSession` 不再报"session 拉起失败"；子会话工具集角色限制生效；`SendMessage`/`WaitForMessage` 双向收发正常（含 delivery 与普通消息两种路径）；`StopSession` 正常中断（状态变为 `cancelled`）；`ListLinkedSessions` 在子会话侧只能看到直接派出者，看不到祖父/兄弟会话。
  - **本 step 仍需处理、未被上述计划覆盖的范围**：`sdkSessionId` → `sessionId` 的字段/协议改名（`ChildStateSnapshot`、`delegation-tools.ts`、`conversation-service.ts` 等处仍保留原字段名，改名牵连约 71 个文件，含前端展示，留给本 step 视情况处理）；`onChildSessionInit`/`sdkSessionIdWaiters`/`waitForChildSdkSessionId` 这套现在已是死代码路径的异步等待机制尚未精简（可选：收敛成同步读取并删除相关 Map）；transcript/组摘要/`reference-tools.ts`/`source-fidelity.ts` 的 Harness 适配完全未动，仍是本 step 的核心范围。

## 计划改动

- [x] 建立运行时中立且仅面向 Harness 的 transcript adapter：从当前 Harness branch 读取消息，生成组摘要所需的去噪文本、稳定 source UUID 和 mtime/version 信息。
- [x] 确定 Harness entry/message 的 source UUID 策略：优先保留 Harness entry ID；若前端块需要更细粒度 UUID，建立可重复推导的映射，禁止每次读取随机生成。
- [x] 将 CleanTranscript、ReadReferenceSession、source-fidelity 和 session 路径解析统一改调用该 adapter，删除它们对 SDK session JSONL 文件格式的假设。
- [x] 修改 group-digest-scanner 及相关 trigger：只扫描非归档、拥有 Harness sessionId 的 main Conversation；mTime/脏判定读取 Harness session 文件或 repository 提供的元数据。
- [ ] ~~将 delegation 领域命名和协议中的 sdkSessionId 改为 sessionId~~ ——**主会话决定推迟不做**：`conv.sdkSessionId`/`conv.sessionId` 现已保持同值（Step2/Step4 已保证），双字段不影响功能正确性；改名牵连约 71 个文件（含前端展示），风险/收益比差，`step4-e2e-verification.md` 也已把它列为"视情况处理"的遗留项。
- [x] 调整 delegation bridge：Harness 会话创建后可立即获得 sessionId，不再等待 SDK `session_init`；CreateSession/CreateSessionBatch 同步返回可通信 sessionId。——**已由独立计划 `delegation-pi-session-routing-fix` 提前完成并验收**（`wireSession()` 已同步检查 `getSdkSessionId()` 并立即 `onChildSessionInit`），本 step 未重复改动，仅核实现状。
- [ ] ~~迁移 SendMessage、WaitForMessage、ListLinkedSessions、StopSession 的 schema、提示词和错误文案~~ ——依附于上面的字段改名，一并推迟。
- [x] 更新引用会话、组背景和子会话摘要相关工具，确保其按 Harness transcript 正确读取父/兄弟会话。——`reference-tools.ts` 内部实现已切到 Harness + 已转 `ToolDef` 形态并挂载到 `pi-session.ts`（`role==='sub'` 时），但**运行时尚未真正生效**：`PiSessionConfig.parentConversationId` 目前无任何调用方填真实值（`conversation-runtime-service.ts` 的 `attachConversation` 从未传它），子会话此刻仍会静默拿不到 `dogear-reference`，见下方"待办"。
- [x] 执行 `bun run build:electron`；手动验证（组摘要可处理新 pi 会话、source fidelity 可查证真实 UUID、创建子会话后可立即收发和停止）**未做**，只做了构建级验证。

## 实施回填（做完后填）

### 实际改动

- 与计划差异：
  1. 范围主动收窄：delegation 命名改造（字段改名 + SendMessage 等工具 schema 迁移）判断为风险/收益比差，决定推迟；delegation bridge 同步创建 sessionId 已由另一独立计划提前完成，本步骤未重复处理。
  2. 任务描述里推测 `buildSessionUuidIndex` 的调用方是 `group-digest-store.ts`，实际 grep 后确认是 `group-digest-tools.ts`，已按实际情况修正。
  3. 顺带发现并修复一个独立缺口：`dogear-reference` 工具包（`ReadReferenceSession`/`ReadGroupBackground`/`ListSiblingSessions`）此前从未被挂载到 pi 子会话工具集（Step 2F 明确排除在外），导致 `CreateSession` 派出的子会话完全拿不到这三个工具。已把 `reference-tools.ts` 从 SDK 专属的 `createSdkMcpServer`/`tool()` 形态转成中立 `ToolDef`（新增 `createReferenceToolDefs`），并在 `pi-session.ts` 里按 `role==='sub' && parentConversationId` 条件挂载。**但这个开关目前打不开**——见下方"待办"。
- 改动文件清单：
  - 新建 `electron/main/agents/pi-session/transcript-adapter.ts`：唯一处理 Harness `SessionTreeEntry`/`MessageEntry` 的逐字稿清洗实现，导出 `cleanMessagesFromEntries`（纯函数）、`readCleanTranscript(workspaceId, sessionId, options?)`、`buildSessionUuidIndex(workspaceId, sessionIds)`。
  - 重写 `electron/main/services/memory/transcript-cleaner.ts`：整体改为薄转发层，指向 `transcript-adapter.ts`；删除 `cleanMessagesFromLines`/`cleanTranscriptFromLines`/`cleanTranscript`（非 read 版）及 `getSessionJsonlPath` 依赖。
  - 删除 `electron/main/services/memory/transcript-cleaner.test.ts`：测的纯函数已删除，测试随之失去意义，按项目"不维护单元测试"约定直接删除。
  - `electron/main/services/memory/source-fidelity.ts`：`buildSessionUuidIndex` 改成从 `transcript-adapter.ts` 直接转发导出，删除本地基于 `getSessionJsonlPath`/`cleanMessagesFromLines` 的实现。
  - `electron/main/services/memory/group-digest-scanner.ts`：`findDirtyGroups`/`findDirtyGroup` 两处 mtime 判定改用 `await getPiSessionRepository().getSessionPath(wsId, sessionId)` 替代 `getSessionJsonlPath`。
  - `electron/main/agents/tools/digest-tools.ts`、`review-tools.ts`、`group-digest-tools.ts`：调用方改传 `workspaceId`（原来传 `workspacePath`）。
  - `electron/main/agents/tools/reference-tools.ts`：整体从 `createSdkMcpServer`/`tool()` 改写为 `defineTool`/`ToolDef[]`，新增 `createReferenceToolDefs(opts)`；`ReadReferenceSession` 改传 `workspaceId`；`ListSiblingSessions` 的 mtime stat 改用 `getPiSessionRepository().getSessionPath()`；原 `createReferenceTools(opts)` 保留签名，内部改薄壳转发，`query-based-session.ts` 调用方未改。
  - `electron/main/agents/pi-session/pi-session.ts`：新增挂载 `dogear-reference`（`role==='sub' && parentConversationId` 条件）。
  - 未改动：`electron/main/services/memory/session-paths.ts`（仍被 `getSubAgentHistory`/`getSdkSessions`(SDK Task 子代理历史) 和 `migration-p3.ts` 使用，与本计划无关，不能动）、`background-store.ts`（不涉及 session transcript）、`delegation-bridge.ts`/`delegation-tools.ts`（按决定不碰）。

  构建：`bun run build:electron` 独立复核通过（0 报错）。

### 给下一步的接力棒

- transcript adapter 的公开接口、UUID 与 mtime 口径：见 `pi-session/transcript-adapter.ts`——`uuid` = Harness `MessageEntry.id`（与 Step4 `history-adapter.ts` 的 `sdkUuid` 同一概念，两条链路 id 一致可互相关联）；mtime/originalBytes 来自 `repository.getSessionPath()` 定位的真实落盘文件 `fs.stat`。
- 已迁移的摘要/引用工具：`CleanTranscript`（digest-tools.ts）、`ReadReferenceSession`/`ListSiblingSessions`（reference-tools.ts）、`TraceSource`（review-tools.ts）、`SaveGroupDigest` 的引用校验（group-digest-tools.ts + source-fidelity.ts）、组卡脏检查（group-digest-scanner.ts）——全部已切到 Harness repository，不再依赖 SDK JSONL 路径规则。
- delegation 的最终 sessionId 协议与同步创建行为：未改协议命名（`sdkSessionId` 字段保留），同步创建行为已由独立计划完成，本 step 未变动。
- 已删除的 SDK transcript/delegation 依赖：`transcript-cleaner.ts` 的 SDK JSONL 解析全部删除；`delegation-bridge.ts`/`delegation-tools.ts` 未删除任何依赖（未碰）。
- 下个 step 入口：Step 6「移除 SDK 主会话代码并验收边界」。
- 待办或已知限制：
  1. **`dogear-reference` 挂载开关目前打不开**：`PiSessionConfig.parentConversationId` 字段存在，但从 `conversation-runtime-service.ts` 的 `attachConversation()` 到 `piSessionManager.createSession()` 这条链路上**从未有人传入真实值**。子会话的 `contractMetadata.parentSessionId`（`conversation-service.ts` 定义）存的是父会话的 Harness sessionId，不是父会话的 `conversationId`，要接线需要：① 反查"哪个 Conversation 的 sessionId 等于 contractMetadata.parentSessionId"，或 ② 更直接地在 `delegation-bridge.ts` 的 `startChild()` 给子 Conversation 的 `contractMetadata` 补一个 `parentConversationId` 字段（`startChild()` 本身此刻就直接持有这个值）再透传下去。两种方案都会碰 `conversation-service.ts` 的 schema 或 `delegation-bridge.ts`，本 step 明确决定不碰这两处，因此这是一个已知的、尚未生效的半成品开关，需要专门排期处理（不建议归入 Step 6，Step 6 是"移除 SDK 代码 + 验收边界"，性质不同）。
  2. `onChildSessionInit`/`sdkSessionIdWaiters`/`waitForChildSdkSessionId` 死代码路径未清理（`delegation-pi-session-routing-fix` 计划已列为可选待办，本 step 同样未碰）。
  3. 组摘要脏检查、`CleanTranscript`/`TraceSource` 对真实 pi 会话的实际读取效果未做端到端手测，仅构建级验证。
  4. `createDigestTools`（`digest-tools.ts` 的 SDK wrapper）确认无调用方，是既有死代码，本 step 未清理。
