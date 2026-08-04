---
step: 4
title: 历史、删除与 Fork 的 TIPC/UI 适配
status: done
---

## 目标

让前端通过 Conversation 读取 Harness 历史，正确呈现旧会话冻结状态，并完成 Harness session 的删除与原生 fork 闭环。

## 依赖上下文（接力棒输入）

- 前置 step 产出：Conversation 已有 `sessionId`、旧会话可通过 archiveReason 识别、主会话只由 PiSessionManager 驱动。
- Harness repository 提供 open/delete/fork；其实际 API、树路径与 entry 格式以 Step 1 回填为准。
- Harness entry 读取必须复用 `pi-session/` 内的共享 reader；本步骤的 UI history adapter 仅负责将 reader 输出转换为前端消息，Step 5 的 memory transcript adapter 复用相同 reader。
- 当前历史入口为 `getSdkSessionHistory`，相关 renderer hook 为 `components/agent-chat/hooks/useMessageHistory.ts`。
- 全局决策：前端和 TIPC 不得暴露 Harness 类型；旧 SDK 归档会话不回放 JSONL。

## 计划改动

- [x] 新建或替换为以 `{ conversationId, workspaceId }` 为输入的通用会话历史 TIPC；由主进程读取 Conversation 并通过 Harness repo 还原当前 branch 的可展示历史。
- [x] 实现 Harness history adapter：将 message entry 转为既有前端消息格式；compaction 仅映射为已有 compact boundary 或简洁元消息；model_change、label、custom 等非展示 entry 默认不进入消息流。
- [x] 对缺少 sessionId 的新空会话返回空历史；对 `archiveReason: 'sdk-main-session-removed'` 返回明确的 legacy archived 状态，而非错误或空白歧义。
- [x] 修改 `useMessageHistory` 和必要的 AgentChat 容器调用点，以 conversationId 请求历史；增加旧归档会话的冻结占位，禁用发送、编辑重发、分叉等操作入口。
- [x] 修改 Conversation 删除链路：新 Harness 会话先调用 repository delete，成功后再删除 Conversation metadata；repository delete 失败则保留 metadata 并返回错误。旧归档会话只删除 metadata，默认不删除旧 SDK JSONL 备份。
- [x] 改造 Fork：第一版只从 repository 可无歧义定位的当前 leaf fork，除非现有 UI 已传递稳定 entry 定位信息；先完成 repository fork 并取得新 sessionId，再创建新 Conversation metadata。
- [x] 确保 fork 产生的 sessionId 写入新 Conversation，原对话和分支各自独立恢复；Conversation metadata 创建失败时尝试删除新 session，并将 session 清理失败作为明确错误记录，避免 metadata 指向不存在的 session 或静默孤儿文件。
- [x] 执行 `bun run build`，手动验证新会话恢复、旧会话归档占位、删除、当前末端 fork 和分叉后独立发送。

## 实施回填（做完后填）

### 实际改动

- 与计划差异：
  1. Fork 定位精度优于计划兜底——`MessageItem` 分叉按钮只在 `message.sdkUuid` 存在时出现，history-adapter 已把该消息合并写入的最后一个 Harness `SessionTreeEntry.id` 塞进 `sdkUuid`；`createFork` 用 `{ entryId, position: 'at' }` 精确截断分叉点，不需要退化到"复制全部 entries"这条路。
  2. 删除三处替换后确认零调用方的死代码：`createQueryBasedSession`/`getSdkSessionHistory`（tipc/agent.ts）、`historyTransformer` 及其 4 个专属 helper（transformers.ts）。
  3. `forkPending` 字段保留但标 `@deprecated`，不做存量迁移——Step3 归档迁移已把所有旧 Conversation（含任何 fork_pending 状态）冻结进 `archived_legacy` 分支，该字段不会再被任何运行时逻辑读取。
  4. 顺手修复隐藏 bug：`conversation-store.ts` 的 `forkConversation` 原本 gate 在 `parentConv.sdk_session_id`（Step3 迁移后对所有 pi 会话恒为 `null`，导致分叉功能已对所有会话失效），改为检查 `session_id`。
  5. `deleteConversation` 删 Harness session 文件前，先检查 `PiSessionManager` 是否有该会话的活跃内存实例，有则先 `closeSession()` 再删文件（计划未明确要求，参照现有 `/clear` 强杀模式补充的防御性动作）。
- 改动文件清单：
  - 新建 `electron/main/agents/pi-session/session-history-reader.ts` — 共享 reader，唯一允许直接碰 Harness `Session`/`SessionTreeEntry` 类型的地方；`readSessionBranchEntries(workspaceId, sessionId)` 内部 `repository.open()` + `session.getBranch()`。
  - 新建 `electron/main/agents/pi-session/history-adapter.ts` — 消费共享 reader，输出中立 `HistoryMessage[]`（映射规则见下）。
  - `electron/main/tipc/agent.ts` — 新增 `getConversationHistory({conversationId, workspaceId})`；删除 `createQueryBasedSession`/`getSdkSessionHistory`。
  - `electron/main/tipc/conversations.ts` — 重写 `createFork`（同步 Harness fork + 回滚）、`deleteConversation`（先删 Harness session 再删 metadata）；删除 `clearForkPending`。
  - `electron/main/tipc/conversation-runtime.ts` — `attachConversationRuntime` 去掉死参数 `resume/forkSession/resumeSessionAt/clearForkFields`。
  - `electron/main/services/conversation-service.ts` — `createFork()` 新增 `sessionId` 参数直写、不再产生 `forkPending: true`；`ConversationCompat`/`toCompat()` 新增 `archiveReason`/`archive_reason`；删除 `clearForkPending`/`clearForkFields`。
  - `electron/main/services/conversation-runtime-service.ts` — `AttachConversationOptions` 只剩 `webContentsId`。
  - `electron/main/services/wechat/wechat-bot-controller.ts` — 修掉一处传 `{ resume: sdkSessionId }` 的调用点。
  - `types/electron-api.ts`、`components/ConversationList.tsx` — `Conversation` 类型补 `session_id?`/`archive_reason?`。
  - `stores/conversation-store.ts` — 删除 `ForkParams`/`forkParams`/`setForkParams`；`forkConversation` 改查 `parentConv.session_id`。
  - `components/agent-chat/hooks/useMessageHistory.ts` — 整体重写，改用 `client.getConversationHistory`，暴露 `historyStatus`/`archivedAt`。
  - `components/agent-chat/hooks/useAgentSession.ts` — 删除 forkParams/fork_pending 分支；新增 `archived` 参数跳过 attach。
  - `components/agent-chat/hooks/useSendMessage.ts` — 删除 fork_pending 首次发送分支。
  - `components/agent-chat/AgentChat.tsx` — `isArchivedLegacy` 驱动冻结提示条 + 禁用发送/分叉。
  - `components/agent-chat/transformers.ts` — 删除 `historyTransformer` 及专属 helper。

  构建验证：`bun run build:electron`（0 错误）、`bun run build`（0 错误）、`bun run lint`（0 错误，72 warning，均为既有 `any`）均由子会话与主会话独立复核通过。**均为构建级验证，未做完整 Electron 应用手动交互测试**（归档占位、分叉、删除三个交互路径待后续实测）。

### 给下一步的接力棒

- 通用历史 IPC 名称、输入输出类型：`getConversationHistory({conversationId, workspaceId})` 返回 `{status:'archived_legacy', archivedAt} | {status:'empty', messages:[]} | {status:'ok', messages: HistoryMessage[]} | {status:'error', error}`。
- Harness entry → UI 消息的映射规则：`message` entry 的 `role='user'` → user Message（图片走 data URL）；`role='assistant'` → 按 text/thinking/toolCall 拆 `HistoryContentBlock`，`toolResult` entry 按 `toolCallId` 回填对应 `tool_use` 块的 `toolOutput/isError`；连续 assistant entry（中间夹 toolResult 不算打断）合并进同一条消息，`sdkUuid` 取最后一条 entry id；`compaction` entry → `isCompactBoundary:true` 的空助手消息；`model_change`/`thinking_level_change`/`active_tools_change`/`branch_summary`/`custom`/`custom_message`/`label`/`session_info`/`leaf` 一律跳过。
- 归档占位的组件和禁用入口：未单独抽组件，内联在 `components/agent-chat/AgentChat.tsx` 的 `isArchivedLegacy` 分支（琥珀色提示条 + 输入区只读提示条 + `MessageItem` 的 `onFork` 传 `undefined`）；`Conversation.archive_reason` 已透出类型层，其他 UI（如 ConversationRow）若需要显示归档标记可直接复用该字段。
- 删除与 fork 的实际事务/回滚顺序：
  - 删除：`getById` → 判定 `isLegacyArchived` → 非 legacy 且有 `sessionId` 则先关活跃内存实例（若有）再 `repository.delete()`，失败直接返回错误保留 metadata → 成功/legacy/无 sessionId 都继续走原有 `conversationService.deleteConversation()` 删 metadata + usage + 空组清理。
  - Fork：校验父对话 `sessionId` 非空 → `repository.fork(workspaceId, parent.sessionId, forkMessageSdkUuid ? {entryId, position:'at'} : {})` 拿 `forkedSessionId`，失败直接返回无残留 → 解析/创建 groupId → `conversationService.createFork()` 落 metadata（`sessionId` 直写），失败则 `repository.delete()` 回滚孤儿 session，回滚失败仅 `console.error` 记录 workspaceId+forkedSessionId，无二次兜底。
- 下个 step 入口：Step 5「Transcript、组摘要与 Delegation 迁移」——`pi-session/session-history-reader.ts` 是共享 reader，Step5 的 memory transcript adapter 若需读同一份数据，应把新 adapter 放进 `pi-session/` 目录内直接调用该 reader（或另建一个面向 memory 场景的转换函数），不得从目录外直接 import `SessionTreeEntry[]`。
- 待办或已知限制：
  1. fork 回滚失败无二次兜底/告警通道，需人工翻日志清理孤儿 session 文件。
  2. `ConversationIndex.forkPending` 字段未做存量 JSON 物理清理（标了 `@deprecated`，但理论上已不会被读取）。
  3. `wechat-bot-controller.ts` 的 `switchBotSession(conversationId, sdkSessionId?)` 第二参数现在完全未使用，未顺手清理避免扩大改动面。
  4. compaction 映射逻辑只有类型层面推导，无真实 compaction 数据验证过（全局决策：自动 compaction 本轮不启用）。
  5. `getSubAgentHistory`（SDK Task 子代理历史）与 `PARSE_ARTICLE` 未受影响，仍走 SDK。
  6. 未手动跑通 Electron 应用交互（归档占位显示、发消息历史还原、分叉、删除四个场景待后续实测）。
