---
step: 4
title: cachePolicy 数据模型 + 持久化
status: done
---

## 目标
Conversation 加 `cachePolicy: '5m' | '1h'` 字段并持久化，create 默认 5m，fork 继承父对话。纯数据层，不动 SDK / UI。

## 依赖上下文（接力棒输入）
- 当前 Conversation 类型：`types/electron-api.ts`（含 persona_id / temp_prompt / modelSelection）
- 当前持久化：`electron/main/services/conversation-service.ts`（`.dogear/conversations.json`，create / createFork / update 三处入口）
- 创建时 tipc 已注入 settings.ai.defaultModelSelection；cachePolicy 不依赖 settings，直接默认 5m
- conversation-store 顶层镜像同步约定：参考 modelSelection 字段（setConversationModelSelection 写库 + 同步顶层）

## 计划改动
- [ ] `types/electron-api.ts` Conversation 加：
  ```ts
  cachePolicy?: '5m' | '1h'; // 缺省视为 5m
  ```
- [ ] `electron/main/services/conversation-service.ts`：
  - create：默认设 `cachePolicy: '5m'`
  - createFork：继承父 `cachePolicy ?? '5m'`
  - 新增 `updateCachePolicy(conversationId, policy)`，写库
- [ ] `electron/main/tipc/conversations.ts`（或对应 tipc 文件）：新增 `setConversationCachePolicy` IPC
- [ ] `stores/conversation-store.ts` 加：
  - 状态字段：conversation 内部已包含 cachePolicy，无需另起顶层字段
  - action `setConversationCachePolicy(conversationId, policy)`：调 IPC + 本地同步对应 conversation 镜像

## 不在本步范围
- env 设置 / SDK 集成 → Step 5
- UI 切换器 → Step 6
- 切换是否触发会话重启 → Step 5 决定（取决于 env 设置时机）

## 实施回填（做完后填）

### 实际改动
- 与计划差异：无。完全按计划执行。
- 改动文件清单：
  - `types/electron-api.ts`：Conversation 加 `cachePolicy?: '5m' | '1h'`
  - `electron/main/services/conversation-service.ts`：ConversationIndex / ConversationCompat 加字段；create 默认 5m；createFork 多接 cachePolicy 参数，由 tipc 传父对话值；新增 `updateCachePolicy(workspaceId, id, policy)`；toCompat 透传
  - `electron/main/tipc/conversations.ts`：createFork 调用透传 `parent?.cachePolicy ?? '5m'`；新增 `setConversationCachePolicy` IPC
  - `stores/conversation-store.ts`：state 接口加 `setConversationCachePolicy` action（参考 setConversationModelSelection 的 patchSlice 模式同步本地镜像）
- 新增 IPC 签名：
  ```ts
  setConversationCachePolicy(input: { workspaceId: string; conversationId: string; policy: '5m' | '1h' }):
    Promise<{ success: boolean; error?: string }>
  ```

### 给下一步的接力棒
- `setConversationCachePolicy` 返回值：`{ success: true } | { success: false; error: string }`，纯写库无 needsRestart 语义（重启判定留给 Step 5 的 session 级 RPC）
- conversation-store action 名称：`setConversationCachePolicy(conversationId, policy)`；调 IPC 后同步顶层 conversations / selectedConversation 镜像的 cachePolicy 字段
- create / fork 默认值生效位置：
  - create：`conversation-service.create()` 第 1 行写 `cachePolicy: '5m'`
  - fork：`tipc/conversations.ts createFork` 传 `parent?.cachePolicy ?? '5m'`；分叉对话首次保存即继承
  - 历史已落库的旧对话 cachePolicy 字段缺失，Step 5 的 SDK 集成需把 `undefined` 视同 `'5m'`
