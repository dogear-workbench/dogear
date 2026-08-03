# Pi Harness 主会话适配设计

**背景**：现有 `PiSession` 基于裸 `Agent`，其权限、插话、状态和 usage 逻辑直接依赖裸 Agent 的事件、`beforeToolCall` 与运行状态。`AgentHarness` 的持久化模型和运行时 API 不兼容，不能直接替换构造调用。

**目标**：主会话切换为 `AgentHarness` 和持久化 Harness Session，同时保持 `PiSession` 对 TIPC、渲染层和上层服务暴露的事件、方法和产品语义不变。

## 架构

在 `electron/main/agents/pi-session/` 增加仅主进程使用的 Harness 适配层。`PiSession` 仍是 Dogear 的运行时门面，负责模型、工具、权限状态与对外 EventEmitter 事件；适配层负责构造 `AgentHarness`、订阅 Harness/Agent 事件，并转换为 Dogear 消息、队列与 settled 状态。

不再将 Harness 类型、Session Tree 或 leaf ID 暴露给 conversation runtime、TIPC、store 或 React。Conversation 只保存中立的 `sessionId: string | null`；该 ID 由 repository create/open 使用。

不采用“先持久化、后再补权限”的降级路径。Harness 替换步骤只有在消息、状态、usage 和权限保持完整语义后才可验收。

## 模块边界

- `conversation-service.ts`：新增 Conversation `sessionId` 字段、创建默认值、更新方法与兼容输出。
- `conversation-runtime-service.ts`：将 workspaceId、已有 sessionId 和创建回调传入 PiSession；首次创建成功后回写 Conversation。
- `pi-session.ts`：保留公共方法、EventEmitter 名称、权限规则和产品语义；改由适配层驱动。
- `pi-harness-adapter.ts`：封装 `AgentHarness`、Harness Session、事件映射、队列状态和关闭同步。
- `pi-session-repository.ts`：作为唯一 Harness Session create/open/delete/fork 边界。

## 数据流

1. 新 Conversation 创建时持久化 `sessionId: null`。
2. runtime attach Pi Conversation 时，将 `workspaceId` 和已保存 sessionId 传入 PiSession。
3. PiSession 启动时通过 repository open 已有 Session，或 create 新 Session；create 成功后立即调用回调写入 Conversation sessionId。
4. adapter 以 Session、models、tools、system prompt 构造 AgentHarness。
5. adapter 将底层 Agent 消息事件映射为 `ExtendedSessionMessage`，并将 Harness `queue_update`、`settled`、`save_point` 转换为 Dogear pending/state/关闭同步事件。
6. `tool_call` hook 在执行工具前走 PiSession 权限状态机；前端响应可允许、拒绝、记忆授权或修改 `event.input`。

## 错误处理与边界

- 传入 sessionId 但 repository open 失败时，启动失败，不自动新建替代 Session，避免 Conversation 指向的历史静默丢失。
- create 成功但 Conversation 回写失败时，启动失败并保留 Harness 文件，由后续诊断处理，避免无索引孤儿会话继续运行。
- abort、close 和 release 必须拒绝所有挂起权限请求，并清空 Harness 队列；关闭前以 settled/save_point 或 waitForIdle 确保已完成内容落盘。
- 自动 compaction 在本迁移中不启用；不调用 `compact()`，也不注册 compaction 策略。
- API 适配必须以安装包 d.ts 和实际构建验证为准；不得按裸 Agent 的 API 假设 Harness 有同名属性。

## 未决问题

- `AgentHarnessEvent` 中底层 Agent event 的精确结构需要在实施时通过类型检查与运行验证确认，以决定 `convertPiEvent()` 是复用还是拆分。
- `tool_call` 的 input 是否在 hook 返回后被执行器按引用使用，需要以编辑工具参数场景做人工验证；若不共享引用，需使用上游支持的显式改写接口后再完成该步骤。
