---
step: 2
title: 删除 sdkSessionId 字段及全部引用
status: done
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

- [ ] `components/agent-chat/hooks/useSendMessage.ts` — 第 366-369 行，会话引用 block 里 `sdkSessionId` 改为 `sessionId`
- [ ] `components/agent-chat/hooks/useSubAgentMessages.ts` — 第 20-80 行，参数/hook 内部 `sdkSessionId` 改为 `sessionId`
- [ ] `components/agent-chat/types.ts` — 第 153 行 `sdkSessionId?` 改为 `sessionId?`
- [ ] `components/agent-chat/utils.ts` — 第 65-71 行，正则和解析结果里 `sdkSessionId` 改为 `sessionId`
- [ ] `components/agent-chat/AgentChat.tsx` — 第 220-248 行，`sdk_session_id` 读取改为 `session_id`，局部变量名同步
- [ ] `components/agent-chat/SubAgentBlock.tsx` — 第 36 行，`sdk_session_id` 改为 `session_id`
- [ ] `components/agent-chat/SubAgentPanel.tsx` — 第 106 行，属性名同步
- [ ] `components/conversation-list/ConversationRow.tsx` — 第 185 行，`sdk_session_id` 改为 `session_id`
- [ ] `stores/reference-store.ts` — 第 14 行，字段名改为 sessionId
- [ ] `stores/ui-store.ts` — 第 6 行，字段名改为 sessionId
- [ ] `types/delegation.ts` — 第 37 行，字段名改为 sessionId
- [ ] `types/electron-api.ts` — 第 126 行注释 `派出者的 sdkSessionId` 改为 `派出者的 sessionId`；`Conversation.sdkSessionId` 字段删除

### 补充：提示文本 / 工具参数 / 辅助函数

- [ ] `electron/main/agents/tools/digest-tools.ts` — 第 28-30 行，CleanTranscript 工具的 zod schema 参数名 `sdkSessionId` 改为 `sessionId`
- [ ] `electron/main/agents/tools/group-digest-tools.ts` — 第 58 行，提示文本里 `sdkSessionId` 改为 `sessionId`
- [ ] `electron/main/agents/tools/reference-tools.ts` — 第 139、146、156 行，`c.sdkSessionId` 改为 `c.sessionId`
- [ ] `electron/main/services/agent-templates-service.ts` — 第 47、55 行，提示模板文本里 `sdkSessionId` 改为 `sessionId`
- [ ] `electron/main/services/memory/group-digest-prompt.ts` — 第 17 行，提示文本
- [ ] `electron/main/services/memory/session-paths.ts` — 第 31-32 行，函数参数名 `sdkSessionId` 改为 `sessionId`（纯参数名，内部路径拼接不变）
- [ ] `electron/main/services/wechat/wechat-bot-controller.ts` — 第 253、280、457 行，`target.sdkSessionId` 改为 `target.sessionId`，`switchBotSession` 参数名同步

### 迁移代码

- [ ] `electron/main/services/memory/migration-p3.ts` — 第 135、141 行，sdkSessionId 读取逻辑适配为 sessionId

### 注意：不改的文件

- `electron/main/types.ts` 第 245 行的 `ConversationRow.sdkSessionId?` 字段——先检查它是否是前端 ConversationRow 类型的镜像，如果是则同步改
- `ConversationIndex` 类型里同时有 `sdkSessionId` 和 `sessionId` 两个字段——删 sdkSessionId，保留 sessionId

## 实施回填（做完后填）

### 实际改动

共改动 32 个文件（含 step2 文档自身）。核心改动：

- **conversation-service.ts**：删除 `sdkSessionId` 字段定义、`updateSdkSessionId()` 函数、`sdk_session_id` 映射；`getBySdkSessionId` → `getBySessionId`（修正内部比较字段）
- **pi-session.ts**：`getSdkSessionId()` → `getHarnessSessionId()`（3 处调用点同步）
- **delegation-bridge.ts**：`ChildStateInternal.sdkSessionId` → `.sessionId`；`sdkSessionIdWaiters` → `sessionIdWaiters`；`waitForChildSdkSessionId` → `waitForChildSessionId`；所有 `c.sdkSessionId` → `c.sessionId`
- **delegation-tools.ts**：所有 `.sdkSessionId` 引用 + `.describe()` 文本 + `waitForChildSdkSessionId` 调用全部改为 sessionId
- **前端 11 个文件**：`sdk_session_id` → `session_id`（snake_case 映射删除）；AgentChat.tsx 局部变量重名用 `convSessionId` 解决
- **digest-tools.ts**：CleanTranscript 参数 sdkSessionId → sessionId
- **提示文本 3 个文件**：sdkSessionId → sessionId
- **tipc/conversations.ts**：删除 `updateSdkSessionId` 路由
- **tipc/agent.ts**：input.sdkSessionId → input.sessionId

验证：lint 0 errors / tsc 0 new errors / build:electron 通过。源码中 sdkSessionId 零残留。

### 给下一步的接力棒
- `sdkSessionId` 字段已从类型定义和运行时代码中彻底删除。存量 conversations.json 中仍有 `sdkSessionId` 值的会话——step 3 迁移脚本需要用 `sessionId ?? sdkSessionId` 兜底合并，然后删除 sdkSessionId key
- `getHarnessSessionId()` 是当前统一的方法名（返回 `config.harnessSessionId`）
- `conversation-service.ts` 的 `ConversationCompat` 类型已删除 `sdk_session_id` 和 `sdkSessionId` 映射行——step 3 迁移脚本读取旧 json 时需容忍这两个 key 不存在（`safeJsonRead` 不会报错，只是 undefined）
- `migration-p3.ts` 里 `c.sdkSessionId` 已改为 `c.sessionId`——如果 step 3 在迁移时需要读旧数据做兜底，需要在那一步单独处理（在 migration-p3 之前加一步或在同一个迁移函数里读 raw json）
