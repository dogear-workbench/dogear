---
step: 4
title: B3 新建/打开会话立即初始化
status: done
---

## 目标

新建会话时立即 attach（初始化 session），消除 isSessionReady 窗口期。切换到旧会话时如果 session 不在内存则 attach。用户点发送时 session 已 ready。

## 依赖上下文（接力棒输入）

- 前置 step 产出：[step1-keepalive.md] B1 保活后切换对话不会销毁 session，re-attach 复用已有 session
- 关键文件：
  - `stores/conversation-store.ts` — `newConversation()` L382，`selectConversation()` L328
  - `components/agent-chat/hooks/useAgentSession.ts` — effect L53 依赖 `[conversationId, archived, topicStateReady, historyLoaded, sessionRestartTrigger, onLiveSnapshot]`，attach 后 `setIsSessionReady(true)` L102
  - `components/agent-chat/hooks/useSendMessage.ts` — `handleSend()` L300 `if (!sessionId || !isSessionReady) return` L306
- 当前新建会话流程：newConversation() → selectConversation（切 UI）→ useAgentSession effect 异步链 → attach → ready
- 当前子会话创建流程（delegation-bridge.ts startChild）：后端串行 create + attach + sendMessage，不经过前端 effect 链
- pi `repo.create()` 会立即创建 JSONL 文件，不存在延迟初始化的技术限制

## 计划改动

- [x] `conversation-store.ts`：`newConversation()` 改为 create conversation → `client.attachConversationRuntime()` → 拿到 sessionId 写回 → `selectConversation()`
- [x] `useAgentSession.ts`：attach 不再依赖 topicStateReady/historyLoaded（这两个是 UI 层判断，不应阻塞 session 初始化）；或改为 effect 在 conversationId 变化时立即 attach，topicState/history 只控制 UI 渲染
- [x] 评估 `pendingSendAfterRestart` 是否仍需要（窗口期消失后理论上不需要，但跨 profile 模型切换重启仍可能用到——保留不动）
- [x] 评估 `handleSend` 的 `!isSessionReady` 分支是否仍需要兜底（保守起见保留，但正常流程不应命中）
- [ ] 验证：新建会话后立即发送 → 正常运行；切换到旧会话 → 立即 ready

## 实施回填（做完后填）

### 实际改动
- 与计划差异：
  - 引入 `PreAttachedSession` store 字段传递预 attach 结果（attachmentId + snapshot + sessionState 等），useAgentSession effect 消费后复用，避免两个 attachment 泄漏。计划只写了“拿到 sessionId 写回”，实际需要传递完整 attach 返回值。
  - `pendingSendAfterRestart` 和 `handleSend !isSessionReady` 分支均保留不动（按计划保守评估）。
  - AgentChat.tsx 移除了不再使用的 `historyLoaded` 变量解构。
- 改动文件清单：
  - `stores/conversation-store.ts`：新增 `PreAttachedSession` 接口 + `preAttachedSession` 字段 + `setPreAttachedSession` setter + `newConversation()` 预 attach 逻辑 + reset 补齐
  - `components/agent-chat/hooks/useAgentSession.ts`：移除 `topicStateReady`/`historyLoaded` 参数和 effect 依赖；新增 preAttachedSession 消费分支（复用预 attach、跳过重复 IPC）
  - `components/agent-chat/AgentChat.tsx`：移除传给 `useAgentSession` 的 `topicStateReady`/`historyLoaded` 参数

### 给下一步的接力棒
- 关键签名 / 数据结构：
  - `PreAttachedSession` 接口存于 `stores/conversation-store.ts`，包含 conversationId/attachmentId/sessionId/permissionMode/snapshot/pendingPermissionRequests/sessionState
  - `useConversationStore.getState().preAttachedSession` — newConversation 写入，useAgentSession 消费清空
  - useAgentSession effect 依赖简化为 `[conversationId, archived, sessionRestartTrigger, onLiveSnapshot]`
- 下个 step 该从哪里继续：Step 5 (O1 切换闪烁) useMessageHistory
- 待办或已知限制：
  - 预 attach 路径不消费 pendingSendAfterRestart（新建对话不可能有 pending send；restart 走正常路径消费）
  - 两个 ExtendedSessionMessage 类型定义（task-types vs electron-api）有既有 tsc 不兼容，用 as 断言绕过
  - 需人工验证：新建会话后立即发送；切换旧会话后立即 ready
