# 子会话 Delegation 在 Pi 运行时下的路由修复 实施计划

**目标**：修复 Step3（主会话切至 `PiSessionManager`）之后子会话协作（`CreateSession`/`SendMessage`/`WaitForMessage`/`StopSession`/`ListLinkedSessions`）已经断裂的问题，让子会话在 Pi 运行时下能正常创建、正确获得受限工具集、正常收发消息与溯源。

**背景**：这是主计划 `docs/plans/2026-08/2026-08-02/pi-harness-sdk-main-session-removal/plan.md` Step5（Transcript、组摘要与 Delegation 迁移）范围内"delegation 协议修复"部分的提前实施。Step5 原计划把该部分和 transcript/组摘要适配（依赖 Step4 产出的共享 reader）捆在一起做；这次单独拆出来先做，因为它不依赖 Step4，且现状是**已经生产损坏**（不是这次改动引入的新风险）。

**架构思路**：不引入新概念，只修复三处已经存在但没接好线的"应该有值却是 undefined/硬编码"的地方——不新增抽象，不做字段改名（`sdkSessionId` 字段名在 `ChildStateSnapshot`/`delegation-tools.ts`/`conversation-service.ts` 中全部保留原名，只修正其取值来源和写入时机）。排除的选项：整体把 `sdkSessionId` 改名为 `sessionId`（牵连 71 个文件，含前端展示，本次不做，留给主计划 Step5 视情况处理）。

**涉及模块**：
- `electron/main/agents/pi-session/pi-session.ts`：`PiSessionConfig` 角色字段、`start()` 角色透传、`getSdkSessionId()` 真实取值
- `electron/main/services/conversation-runtime-service.ts`：`attachConversation` 透传 role、`onHarnessSessionCreated` 双写 `sessionId`/`sdkSessionId`
- `electron/main/agents/delegation-bridge.ts`：会话查找从 `QueryBasedSessionManager` 改为 `PiSessionManager`

## 步骤索引

- [x] [Step 1: PiSession 角色感知与真实 sessionId 暴露](./step1-pisession-role-sessionid.md) — 修 `PiSessionConfig` 缺 role 导致子会话拿错工具集；修 `getSdkSessionId()` 硬编码 undefined。
- [x] [Step 2: conversation-runtime-service 接线 role 与双写 sdkSessionId](./step2-runtime-service-wiring.md) — 让 `attachConversation` 把 conversation.role 传给 PiSession；让 harness session 创建后 `conv.sdkSessionId` 和 `conv.sessionId` 保持同值。
- [ ] [Step 3: delegation-bridge 会话查找路由改造](./step3-delegation-bridge-routing.md) — 把硬编码的 `getQueryBasedSessionManager()` 全部换成 `getPiSessionManager()`，清掉不会触发的 `session_init` 监听死代码。
- [ ] [Step 4: 端到端验收与主计划文档同步](./step4-e2e-verification.md) — 手测完整子会话协作链路；在主计划 Step5 文档里记录本次提前完成的范围。

## 全局决策

- 不改动任何已存在的字段名、方法名、工具 schema 字段名（`sdkSessionId` 在所有层保留原名）；只修正取值来源和写入时机。
- `PiSessionConfig` 新增的 `role: 'main' | 'sub'` 字段与 `Conversation.role` 语义一致，直接透传，不做二次映射。
- `Conversation.sdkSessionId` 与 `Conversation.sessionId` 从本次改动起应保持同值（都是 Harness 的持久化 sessionId）；不删除 `sdkSessionId` 字段，也不去重构 `conversation-service.ts` 已有的读写 API 形状。
- `delegation-bridge.ts` 改造后假定所有存活 conversation 的运行时都是 `PiSession`（Step3 已把旧 SDK Conversation 全部归档），不再保留对 `QueryBasedSession`/`QueryBasedSessionManager` 的兼容分支。
- 不涉及 transcript、组摘要、`reference-tools.ts`、`source-fidelity.ts` 的改动——这些仍然按主计划依赖 Step4 的共享 reader，留在主计划 Step5 收尾。
- 每步完成后至少执行 `bun run build:electron`（本次改动均在主进程），Step4 做完整链路手测。
- 完成后需要在主计划的 `step5-transcript-delegation.md` 的"依赖上下文"一节补充说明：delegation 协议路由/角色/sessionId 双写部分已提前完成，避免重复劳动。
