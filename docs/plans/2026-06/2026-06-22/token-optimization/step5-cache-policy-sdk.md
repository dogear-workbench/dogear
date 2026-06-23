---
step: 5
title: cachePolicy SDK 集成
status: done
---

## 目标
SDK 启动时根据 cachePolicy 设 `ENABLE_PROMPT_CACHING_1H` env；新增 setSessionCachePolicy RPC，返回 needsRestart（env 是启动级，无法热切）；worker 任务强制 5m。

## 依赖上下文（接力棒输入）
- Step 4 产出：Conversation.cachePolicy 字段已落库，setConversationCachePolicy IPC 可用
- 当前 SDK 配置入口：`electron/main/agents/agent-query-config.ts`（resolveModelSelection 是模型选择唯一入口）
- 当前 session 模型切换的 needsRestart 模式：`electron/main/tipc/agent.ts` 的 setSessionModel 已经返回 `{ ok:true; needsRestart? } | { ok:false; error }`
- 当前会话重启链路：前端 useSendMessage 在收到 needsRestart 时 triggerSessionRestart → 用户重发
- worker 任务入口：`electron/main/agents/agent-worker.ts` 的 handleDigestSessionTask / handleReviewSessionTask / handleCategorizeSessionTask（都走 resolveModelSelection）

## 计划改动
- [ ] `agent-query-config.ts`：
  - 在 build query options 时根据传入的 cachePolicy 调整 env
  - 签名扩展：`buildQueryOptions(..., cachePolicy?: '5m' | '1h')`
  - cachePolicy === '1h' → 设 `ENABLE_PROMPT_CACHING_1H=1`
  - cachePolicy === '5m' 或 undefined → 不设（SDK 默认 5m）
- [ ] `query-based-session.ts`（如适用）：
  - 创建会话时传入 conversation.cachePolicy
  - 新增 `setCachePolicy(policy)` 方法：写库 + 标记 needsRestart（env 已传入 SDK 不可热切）
- [ ] `electron/main/tipc/agent.ts`：
  - 新增 `setSessionCachePolicy` RPC：
    ```ts
    setSessionCachePolicy(input: { sessionId: string; policy: '5m' | '1h' }):
      Promise<{ ok: true; needsRestart: boolean } | { ok: false; error: string }>
    ```
  - 同步调用 step 4 的 `setConversationCachePolicy`
- [ ] worker 任务路径强制 5m：
  - `agent-worker.ts` 各 handleXxxSessionTask 调用 buildQueryOptions 时显式传 `cachePolicy: '5m'`（不读 conversation.cachePolicy，因为 worker 也跑在某个 conversation 上）

## 不在本步范围
- 输入框 UI 切换器 → Step 6
- skill 提示 → Step 6

## 实施回填（做完后填）

### 实际改动
- 与计划差异：
  - 没有给 `buildQueryBaseConfig` 加 cachePolicy 参数；而是扩展了 `QueryRuntimeContext.cachePolicy`，调用方通过 ctx 传入。原因：保持 buildQueryBaseConfig 单参数 ctx 风格一致。
  - worker 任务（digest/review/categorize）无需显式传 `cachePolicy: '5m'`：worker 路径直接调 `resolveModelSelection`，env 中本就不会出现 `ENABLE_PROMPT_CACHING_1H`，天然就是 5m。计划里"显式传"那条改为"无需任何改动"。
- 改动文件清单：
  - `electron/main/agents/agent-query-config.ts`：QueryRuntimeContext 加 `cachePolicy?: '5m' | '1h'`；buildQueryBaseConfig 在 resolveModelSelection 后若 `cachePolicy === '1h'` 则 `env.ENABLE_PROMPT_CACHING_1H = '1'`
  - `electron/main/agents/query-based-session.ts`：QueryBasedSessionConfig 加 `cachePolicy?`；start() 写入 ctx + 缓存 `currentCachePolicy`；新增 `setCachePolicy(policy)` 方法（同策略 needsRestart=false，切换则更新缓存返回 needsRestart=true）
  - `electron/main/services/conversation-runtime-service.ts`：buildConversationSessionConfig 注入 `cachePolicy: conversation.cachePolicy ?? '5m'`
  - `electron/main/tipc/agent.ts`：新增 `setSessionCachePolicy` IPC（写库 + 通知 session）
- setSessionCachePolicy 实际返回类型：
  ```ts
  Promise<{ ok: true; needsRestart: boolean } | { ok: false; error: string }>
  ```
  - 有 active session：返回 session.setCachePolicy 结果（policy 未变则 needsRestart=false，切换则 true）
  - 无 active session（如全新对话还没发首条消息）：写完库直接 `{ ok: true, needsRestart: false }`
- env 是否真的需要 needsRestart（确认 SDK 行为）：是。`ENABLE_PROMPT_CACHING_1H` 通过 query() options.env 注入到子进程，SDK 启动后无法 per-request 改变；只能销毁现有 query 重建。

### 给下一步的接力棒
- 前端切换器调用入口：`client.setSessionCachePolicy({ sessionId, workspaceId, conversationId, policy })`
- 切换确认 UI 复用哪个组件：`stores/confirm-store.ts` 的 `showConfirm(title, description)`（与模型切换重启时同款）
- needsRestart 触发会话重启的链路：与模型切换同款——拿到 `{ ok: true, needsRestart: true }` 后调 `useConversationStore.getState().triggerSessionRestart()`，useAgentSession 监听 `sessionRestartTrigger` 自动重建会话（新会话首次 query 时通过 conversation.cachePolicy 重新解析 env）
- 备注：写库已在 IPC 内部完成，前端调用 `setSessionCachePolicy` 后无需再调 `setConversationCachePolicy`；但本地 store 镜像还是要手动 set，避免重新 loadConversations
