---
step: 2
title: 删除 sdkSessionId 字段及全部引用
status: pending
---

## 目标

清除 sdkSessionId 这个 SDK 时代遗留字段，消除双写混乱的根源。

## 依赖上下文（接力棒输入）

- Step 1 产出：onHarnessSessionCreated 回调已删除，sessionId 由 attachConversation 直接写入
- sdkSessionId 在运行时代码里的所有引用点（下面列出）

## 计划改动

### 类型定义

- [ ] `types/electron-api.ts` — `Conversation.sdkSessionId` 字段删除
- [ ] `electron/main/types.ts` — `ConversationIndex.sdkSessionId` 镜像字段删除（如有）
- [ ] `electron/main/services/conversation-service.ts` — `create()` 不再初始化 `sdkSessionId: null`

### 服务层

- [ ] `electron/main/services/conversation-service.ts` — `updateSdkSessionId()` 函数删除
- [ ] `electron/main/services/conversation-service.ts` — `getBySdkSessionId()` 改为按 `sessionId` 查询（或删除，检查调用方）
- [ ] `electron/main/services/conversation-runtime-service.ts` — createSession 配置里不再传 sdkSessionId 相关
- [ ] `electron/main/services/memory/group-digest-scanner.ts` — `conv.sdkSessionId!` 改为 `conv.sessionId!`（两处：第 93 行和第 141 行附近）
- [ ] `electron/main/services/topic-lifecycle-service.ts` — `conversation.sdkSessionId` 从 session ID 集合删除（第 44 行附近）

### Agent 层

- [ ] `electron/main/agents/delegation-bridge.ts` — `ChildStateInternal.sdkSessionId` 字段删除；`onChildSessionInit` 里写 sdkSessionId 的逻辑改为写 sessionId（或直接用 harnessSessionId）；`getChildIdBySessionId` 参数语义从 sdkSessionId 改为 sessionId
- [ ] `electron/main/agents/tools/delegation-tools.ts` — `ListLinkedSessions`/`SendMessage` 里展示 `c.sdkSessionId` 改为 `c.sessionId`（第 156、165、280 行附近）
- [ ] `electron/main/agents/pi-session/pi-session.ts` — `getSdkSessionId()` 方法评估是否改名为 `getHarnessSessionId()` 或直接用 `config.harnessSessionId`

### TIPC 路由

- [ ] `electron/main/tipc/conversations.ts` — `updateSdkSessionId` 路由删除（第 75 行附近）
- [ ] `electron/main/tipc/agent.ts` — 检查是否有 sdkSessionId 相关引用

### 前端

- [ ] 检查 `components/` 下是否有读取 `conversation.sdkSessionId` 的地方（如 LineageBar 溯源展示），改为 sessionId

### 迁移代码

- [ ] `electron/main/services/memory/migration-p3.ts` — 检查 sdkSessionId 读取逻辑，适配为 sessionId

## 实施回填（做完后填）

### 实际改动
- （待填）

### 给下一步的接力棒
- （待填）
