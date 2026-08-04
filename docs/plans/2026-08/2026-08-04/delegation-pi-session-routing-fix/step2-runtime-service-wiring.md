---
step: 2
title: conversation-runtime-service 接线 role 与双写 sdkSessionId
status: pending
---

## 目标

让 `attachConversation` 把 conversation 的 role 传给新的 `PiSessionConfig.role`；让 Harness session 创建成功后，`conv.sdkSessionId`（delegation 协议读的持久化字段）和 `conv.sessionId`（Harness 原生持久化字段，Step2A 已经在正确写）保持同值——这是 `contractMetadata` 溯源和 `conversationService.getBySessionId` 反查失效的根因（`sdkSessionId` 从 Step3 起没有任何写入路径，永远是 `null`）。

## 依赖上下文（接力棒输入）

- 前置 step 产出：`PiSessionConfig` 已有 `role: 'main' | 'sub'` 字段；`PiSession.getSdkSessionId()` 现在返回真实值。
- 当前关键文件状态：`electron/main/services/conversation-runtime-service.ts`
  - `attachConversation`（第 50-116 行）第 73-84 行 `piSessionManager.createSession({...})` 目前没有传 `role`。
  - `conversation` 对象在第 56 行已经 `await conversationService.getById(workspaceId, conversationId)` 取到，其 `role: 'main' | 'sub'` 字段直接可用（`conversation-service.ts:103`）。
  - `onHarnessSessionCreated` 回调（第 80-81 行）目前只调用 `conversationService.updateSessionId(workspaceId, conversationId, harnessSessionId)`。
  - `conversationService.updateSdkSessionId(workspaceId, id, sdkSessionId)`（`conversation-service.ts:414`）已经存在且实现完整，只是**从 Step3 起没有任何调用方**（全仓库 grep 确认，只有 tipc 定义没有调用点）——不是要新写一个函数，是要新增一次调用。
- 关键决策回顾：`conv.sessionId` 和 `conv.sdkSessionId` 本次不合并成一个字段（避免牵连 71 个文件的改名），改为在唯一的写入时机（Harness session 创建成功）双写两个字段，保持值同步。

## 计划改动

- [ ] `conversation-runtime-service.ts:73-84` `piSessionManager.createSession({...})` 补充 `role: conversation.role ?? 'main'`（`Conversation.role` 是 `?:` 可选字段，默认值按 `conversation-service.ts:351` 的既有约定用 `'main'`）。
- [ ] `conversation-runtime-service.ts:80-81` `onHarnessSessionCreated` 回调改成同时调用 `updateSessionId` 和 `updateSdkSessionId`（两次 await 或 `Promise.all`，值都是同一个 `harnessSessionId`）。
- [ ] 确认 `conversationService.updateSdkSessionId` 的签名（`workspaceId, id, sdkSessionId: string`）与调用处参数类型完全匹配，不需要改这个函数本身。
- [ ] `bun run build:electron` 确认无类型错误。

## 实施回填（做完后填）

### 实际改动

- 与计划差异：
- 改动文件清单：

### 给下一步的接力棒

- `attachConversation` 传 role 的最终写法：
- 双写 `sessionId`/`sdkSessionId` 的最终实现位置和调用方式（是否 Promise.all、失败时的处理）：
- 下个 step 入口：`delegation-bridge.ts` 现在可以放心假设"存活 conversation 的 `parent.sdkSessionId` 有值"，去改造会话查找路由。
- 待办或已知限制：（例如：已经归档的旧 SDK conversation 的 `sdkSessionId` 不受本次改动影响，保持原值不变，这是预期行为）
