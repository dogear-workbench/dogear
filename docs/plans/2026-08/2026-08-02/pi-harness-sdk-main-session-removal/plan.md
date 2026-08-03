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
- [ ] [Step 2: Harness 驱动 PiSession](./step2-pi-session-harness.md) — 先接入最小 Conversation sessionId/workspaceId 生命周期，再以 Harness 替换裸 Agent，完成创建、恢复与运行时协议适配。
- [ ] [Step 3: 旧会话归档迁移与 runtime 收敛](./step3-conversation-migration.md) — 归档既有 SDK Conversation，移除残余 SDK runtime 生命周期分支并完成一次性迁移。
- [ ] [Step 4: 历史、删除与 Fork 的 TIPC/UI 适配](./step4-history-delete-fork.md) — 以 Conversation 为入口读取 Harness 历史，完成归档占位、删除和原生分叉。
- [ ] [Step 5: Transcript、组摘要与 Delegation 迁移](./step5-transcript-delegation.md) — 让摘要、引用校验与跨会话协作使用 Harness sessionId 和统一 transcript adapter。
- [ ] [Step 6: 移除 SDK 主会话代码并验收边界](./step6-sdk-main-cleanup.md) — 删除 SDK 主会话路径，确认 SDK 仅服务 PARSE_ARTICLE，完成构建与关键流程验收。

## 全局决策

- 范围为“移除 SDK 主会话”：`@anthropic-ai/claude-agent-sdk` 暂不从依赖中卸载，`PARSE_ARTICLE` 仍可使用其 query、plugin 和 skill 发现能力。
- 不做 SDK JSONL → Harness JSONL 转换，不维护双格式 Conversation 历史读取兼容。
- 启动一次性迁移时，现有全部 Conversation（包括尚无 SDK session 的空对话）统一写入 `archivedAt` 和 `archiveReason: 'sdk-main-session-removed'`；旧 SDK JSONL 留盘作为不可操作备份。
- 新 Conversation 的持久会话标识为 `sessionId: string | null`，不保存绝对路径；`null` 表示首次发送前尚未创建 Harness session。Step 2 先落地该字段及其 runtime create/open 回写闭环，Step 3 再执行旧 Conversation 的一次性归档。
- 新 Harness session 根目录固定为 `<configDir>/workspaces/<workspaceId>/sessions/`，不得写入用户真实 workspace；采用上游 `JsonlSessionRepo` 的 cwd 编码子目录与时间戳文件名布局，Conversation 仅持久化其稳定 `sessionId`。
- `PiSession` 是 Dogear 的运行时门面；TIPC、store 和 React 组件不得使用 `AgentHarness`、`SessionTreeEntry`、`leafId` 等 Harness 类型。
- 前端历史读取以 Conversation 为入口，不再传递或暴露底层 session 文件 ID；归档旧会话只显示冻结说明，不回放 SDK JSONL。
- Harness 自动 compaction 不在首个迁移闭环启用；先完成持久化、恢复、历史与 fork，再单独设计上下文压缩策略。
- 跨会话通信使用 Harness `sessionId` 作为运行时地址，Conversation `id` 仍是业务主键；所有旧 `sdkSessionId` 协议命名随迁移收敛。
- 每步完成后运行相关类型检查/构建；主进程改动至少执行 `bun run build:electron`，最终执行 `bun run build`。
