---
step: 1
title: sessionId 写入逻辑修改 + onHarnessSessionCreated 回调删除
status: done
---

## 目标

消除 sessionId 被空壳覆盖的根因：删除 onHarnessSessionCreated 回调，改为 attachConversation 在 create 后直接写一次。

## 依赖上下文（接力棒输入）

- 设计文档：[design.md](./design.md)
- 当前 bug 根因：`conversation-runtime-service.ts:92-96` 的 `onHarnessSessionCreated` 回调无条件覆盖 sessionId
- PiSession.start() 的 open/create 分支：`pi-session.ts:215-222`

## 计划改动

### `electron/main/agents/pi-session/pi-session.ts`

- [x] `PiSessionConfig` 接口删除 `onHarnessSessionCreated` 字段
- [x] `start()` 的 create 分支删除 `await this.config.onHarnessSessionCreated(info.id)`，只保留 `this.config.harnessSessionId = info.id`
- [x] `getSdkSessionId()` 改名或保留 → 保留原名，step 2 统一命名

### `electron/main/services/conversation-runtime-service.ts`

- [x] `attachConversation` 的 createSession 调用删除 `onHarnessSessionCreated` 参数
- [x] 在 `session.start()` 返回后，新增 `isRestore` 标记，create 路径直接调 `conversationService.updateSessionId(workspaceId, conversationId, session.getSdkSessionId()!)`
- [x] 恢复路径 start() 失败时 catch 抛用户友好错误「会话历史文件缺失或损坏，无法恢复会话」

### `electron/main/agents/delegation-bridge.ts`

- [x] `startChild` 里调 `attachConversation` 后，session ID 已经由 attachConversation 写入 conversations.json，无需额外处理（确认无代码改动）

## 实施回填（做完后填）

### 实际改动

**pi-session.ts**：
- `PiSessionConfig` 接口删除 `onHarnessSessionCreated` 字段
- `start()` create 分支删除回调调用，只保留 `this.config.harnessSessionId = info.id`

**conversation-runtime-service.ts**：
- 新增 `const isRestore = !!conversation.sessionId` 区分新建/恢复
- createSession 调用删除 `onHarnessSessionCreated` 参数（含 updateSessionId + updateSdkSessionId 双写）
- catch 块：`if (isRestore) throw new Error('会话历史文件缺失或损坏，无法恢复会话')`
- start() 成功后 create 路径调 `updateSessionId`（只写 sessionId，不写 sdkSessionId）
- `created = !isRestore`（恢复会话不算 created）

**delegation-bridge.ts**：无代码改动，确认不依赖回调

**验证**：lint 0 errors / tsc 无类型错误

### 给下一步的接力棒
- `onHarnessSessionCreated` 回调已从源码彻底删除，`PiSessionConfig` 不再有该字段
- `updateSdkSessionId` 的调用点已从 attachConversation 移除，但 `sdkSessionId` 字段定义、`updateSdkSessionId()` 方法、delegation-bridge / delegation-tools / conversation-service 等处的 sdkSessionId 引用全部保留 → step 2 的清除目标
- `getSdkSessionId()` 方法名仍保留（返回 `config.harnessSessionId`），step 2 统一命名
- `isRestore` 变量可在 attachConversation 内复用，step 2 如需进一步区分可参考
