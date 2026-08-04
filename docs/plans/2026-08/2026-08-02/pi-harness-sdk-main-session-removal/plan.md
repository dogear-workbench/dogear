# Pi Harness 主会话迁移与 SDK 主会话移除实施计划

**目标**：将 Dogear 主会话从 Claude Agent SDK 完整迁移到 `@earendil-works/pi-agent-core` 的 AgentHarness，旧 SDK Conversation 一次性冻结归档；Claude Agent SDK 仅保留给 `PARSE_ARTICLE` 后台任务使用。

**架构思路**：保留 `PiSession` 作为 Dogear 运行时门面，内部改由 AgentHarness 驱动，避免 Harness 的 session tree、hook 与存储类型泄漏到 TIPC 和渲染层。新 Conversation 仅保存 Harness 的中立 `sessionId`，会话文件位于 `.dogear/workspaces/<workspaceId>/sessions/`。不转换旧 SDK JSONL；启动迁移时将既有 Conversation 全部归档，保留其磁盘文件备份但不再回放、恢复或纳入后续摘要。

**涉及模块**：
- `package.json`、pi AgentHarness 依赖及其 API 验证
- `electron/main/agents/pi-session/`：Harness repository、运行时适配、历史转换、hook 与 fork
- `electron/main/services/conversation-service.ts`、`conversation-runtime-service.ts`：Conversation schema、迁移、会话生命周期
- `electron/main/tipc/agent.ts`、`electron/main/tipc/conversations.ts`：通用历史读取、会话删除、fork 等 IPC
- `components/agent-chat/hooks/useMessageHistory.ts` 与归档会话占位 UI
- `electron/main/services/memory/`：Harness transcript adapter、组摘要/source fidelity
- `electron/main/agents/delegation-bridge.ts`、`electron/main/agents/tools/delegation-tools.ts`：会话通信 ID 迁移
- SDK 主会话专属代码清理；`PARSE_ARTICLE` 的 SDK worker 链路保留

## 步骤索引

- [x] [Step 1: 验证 Harness 依赖与会话仓库](./step1-harness-repository.md) — 接入并验证 Harness API，建立按工作区隔离的 create/open/delete/fork 仓库边界。
- [x] [Step 2A: Conversation 与 Harness Session 生命周期](./step2a-conversation-harness-lifecycle.md) — 为新 Conversation 建立 sessionId 的创建、回写与恢复闭环。
- [x] [Step 2B: Harness 消息与状态适配](./step2b-harness-message-state-adapter.md) — 用 adapter 替换裸 Agent，保持消息、插话、状态与 usage 语义。
- [x] [Step 2C: Harness 权限与关闭语义](./step2c-harness-permission-close.md) — 将完整权限状态机迁入 tool_call hook，并收敛中断、关闭和落盘顺序。
- [x] [Step 2D: Harness 主会话回归验收](./step2d-harness-regression.md) — 构建并人工验证 Harness 主会话完整产品流程。
- [x] [Step 2E: 可选工具包 ToolDef 中立化改造](./step2e-toolpack-neutralization.md) — 把 article/stock-quote/stock-analysis/stock-announcement/stock-picking 五个工具工厂改造成中立 ToolDef 形态，供 PiSession 消费。
- [x] [Step 2F: PiSession 工具包接入与权限批量免确认](./step2f-pisession-toolpack-wiring.md) — 让 PiSession 按 enabledToolPacks/groupId 挂载工具包并对齐旧 SDK 的批量免确认体验。
- [x] [Step 3: 旧会话归档迁移与 runtime 收敛](./step3-conversation-migration.md) — 归档既有 SDK Conversation，移除残余 SDK runtime 生命周期分支并完成一次性迁移。
- [x] [Step 4: 历史、删除与 Fork 的 TIPC/UI 适配](./step4-history-delete-fork.md) — 以 Conversation 为入口读取 Harness 历史，完成归档占位、删除和原生分叉。
- [x] [Step 5: Transcript、组摘要与 Delegation 迁移](./step5-transcript-delegation.md) — 让摘要、引用校验与跨会话协作使用 Harness sessionId 和统一 transcript adapter。
- [x] [Step 6: 移除 SDK 主会话代码并验收边界](./step6-sdk-main-cleanup.md) — 删除 SDK 主会话路径，确认 SDK 仅服务 PARSE_ARTICLE，完成构建与关键流程验收。

## 全局决策

- 范围为“移除 SDK 主会话”：`@anthropic-ai/claude-agent-sdk` 暂不从依赖中卸载，`PARSE_ARTICLE` 仍可使用其 query、plugin 和 skill 发现能力。
- 不做 SDK JSONL → Harness JSONL 转换，不维护双格式 Conversation 历史读取兼容。
- 启动一次性迁移时，现有全部 Conversation（包括尚无 SDK session 的空对话）统一写入 `archivedAt` 和 `archiveReason: 'sdk-main-session-removed'`；旧 SDK JSONL 留盘作为不可操作备份。
- 新 Conversation 的持久会话标识为 `sessionId: string | null`，不保存绝对路径；`null` 表示首次发送前尚未创建 Harness session。Step 2A 先落地该字段及其 runtime create/open 回写闭环，Step 3 再执行旧 Conversation 的一次性归档。
- AgentHarness 的接入必须经 `pi-harness-adapter.ts` 隔离；Harness 事件、Session 与 Session Tree 类型不得泄漏出 `electron/main/agents/pi-session/`。
- Harness 的 session entry / transcript 读取只能经 `electron/main/agents/pi-session/` 内的共享 reader；Step 4 的 UI history adapter 与 Step 5 的 memory transcript adapter 可各自转换数据，但不得分别解析 Harness session 文件或 tree。
- Step 2B 至 2C 不允许降低现有 PiSession 的权限确认、编辑工具参数、插话、消息、状态或 usage 语义；任一 API 差异必须通过 adapter 显式适配。
- 新 Harness session 根目录固定为 `<configDir>/workspaces/<workspaceId>/sessions/`，不得写入用户真实 workspace；采用上游 `JsonlSessionRepo` 的 cwd 编码子目录与时间戳文件名布局，Conversation 仅持久化其稳定 `sessionId`。
- `PiSession` 是 Dogear 的运行时门面；TIPC、store 和 React 组件不得使用 `AgentHarness`、`SessionTreeEntry`、`leafId` 等 Harness 类型。
- 前端历史读取以 Conversation 为入口，不再传递或暴露底层 session 文件 ID；归档旧会话只显示冻结说明，不回放 SDK JSONL。
- Harness 自动 compaction 不在首个迁移闭环启用；先完成持久化、恢复、历史与 fork，再单独设计上下文压缩策略。
- 跨会话通信使用 Harness `sessionId` 作为运行时地址，Conversation `id` 仍是业务主键；delegation 的旧 `sdkSessionId` 协议及其 SDK runtime 创建路径统一由 Step 5 迁移，Step 3 仅移除主 Conversation runtime 对它的依赖。
- 每步完成后运行相关类型检查/构建；主进程改动至少执行 `bun run build:electron`，最终执行 `bun run build`。
- 旧 Step 2（`step2-pi-session-harness.md`）已由 Step 2A～2D 取代，仅作历史记录，不纳入执行状态与步骤索引。
- Step 3 验收时发现规划缺口：PiSession 自 Step 1 起只挂了内建文件工具与常驻记忆工具，从未接入 article/stock-quote/stock-analysis/stock-announcement/stock-picking/dogear-group/dogear-delegation/dogear-memory-review 等工具包，而 Step 3 会把所有主会话强制切到 PiSessionManager，若不先补齐会导致主会话功能倒退。插入 Step 2E、2F 补齐后再继续 Step 3；`dogear-reference` 确认仍只装子会话，不纳入本次补齐范围。
- 新增工具包在 pi 侧统一按"工具包粒度批量免确认"接入权限判定（Step 2F 落地），对齐旧 SDK `allowedTools` 通配符体验，不接受逐工具确认的降级方案。
- Step 3 完成后发现 delegation 协议在 Pi 运行时下已生产损坏（`getSdkSessionId()` 硬编码 undefined、`PiSessionConfig` 缺 role、`delegation-bridge.ts` 仍硬编码查 `QueryBasedSessionManager`），已提前拆出独立计划 `docs/plans/2026-08/2026-08-04/delegation-pi-session-routing-fix/plan.md` 修复并端到端验收通过（详见 `step5-transcript-delegation.md` 依赖上下文一节的补充说明）。Step 5 的 delegation 路由/角色/sessionId 双写部分已完成，剩余范围收窄为 transcript/组摘要/`reference-tools.ts`/`source-fidelity.ts` 的 Harness 适配（仍依赖 Step4 的共享 reader）以及 `sdkSessionId`→`sessionId` 的协议改名（视情况处理，最终决定推迟不做）。
- Step 5 完成后发现另一个未生效的半成品开关：`dogear-reference` 工具包已补挂载到 `pi-session.ts`（`role==='sub' && parentConversationId` 条件），但 `PiSessionConfig.parentConversationId` 从未被 `conversation-runtime-service.ts` 的 `attachConversation()` 真正赋值——子会话的 `contractMetadata` 只存了父会话的 Harness `parentSessionId`，没有存 `parentConversationId`，要接线需要改 `delegation-bridge.ts` 的 `startChild()`（补充 `parentConversationId` 到 contractMetadata 或 Conversation 记录）或在 runtime 侧反查，两者都超出 Step 5 "不碰 delegation-bridge.ts" 的边界，留作独立待办，不纳入 Step 6（Step 6 是移除 SDK 代码 + 边界验收，性质不同）。

## 完成总结

主会话从 Claude Agent SDK 完整迁移到 `@earendil-works/pi-agent-core` 的 AgentHarness（`electron/main/agents/pi-session/` 下的 `PiSession`/`PiSessionManager` 门面），旧 SDK 主会话实现 `query-based-session.ts`（约 2400 行）及其唯一的 TIPC 分流分支已全部删除；`@anthropic-ai/claude-agent-sdk` 现在 100% 收敛于 `PARSE_ARTICLE` 后台任务调用链（+ 少量类型引用），未再保留任何主会话运行时依赖。

Step 6 收尾阶段额外发现并清理了一条计划外的独立 SDK 死链路（`TaskType.CHAT_SESSION` + `chat-skill.ts`，前端零调用方），并补齐了 `.claude/rules/codebase-map.md` 里此前从未记录过的 `pi-session/` 整个目录索引、重写了描述已过时的 `session-runtime.md`。已知遗留候选项（`agent-manager.ts` 的 sessionCallbacks 死分支、`renderer-handlers.ts` 六个无发送方的事件类型、微信 bot 消息徽章功能因运行时切换而失效、`attachConversation` 的晚加入快照重播未实现）详见 `step6-sdk-main-cleanup.md` 的接力棒段落，均判断为风险/收益不匹配本次"移除 SDK 主会话"的范围，建议后续另开计划处理。
