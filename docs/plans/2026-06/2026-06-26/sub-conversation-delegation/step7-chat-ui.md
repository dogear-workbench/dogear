---
step: 7
title: chat 区适配（中断等待 + 子会话 banner + pendingState）
status: done
---

## 目标

主会话 chat 区在挂 wait 时给用户一个手动中断的逃生通道；子会话 chat 区让用户一眼看到「这是受委派的子会话」+ 交付路径 + 状态；pendingState 在 wait 期间能正确显示「等 N 个交付」而不只是含糊的「running」。

## 依赖上下文（接力棒输入）

- Step 2 bridge 已有 `abortWaitsForParent(parentConversationId)` 空实现，本步填实
- 现有 `pendingState` 派生在 `hooks/usePendingState.ts`（idle / running / flushing）
- 现有 `StreamingIndicator.tsx` 根据 pendingState 显示文案
- 子会话 conversation 有 `role='sub'` + `parentConversationId`，从主会话能查到 outputPath / task（bridge.getChildSnapshot）

## 计划改动

### 1. `electron/main/agents/delegation-bridge.ts`
- 填实 `abortWaitsForParent(parentConversationId): DeliveryResult[]`
  - 找该 parent 所有活跃 waitState
  - 把每个 waitState 中未 terminal 的 child mark 'cancelled'（**不** abort 子会话本身——只让主会话不再等；子会话继续跑或自行完成）
  - resolve waitState Promise（partial 结果，含 cancelled）
  - 返回所有被中断的 deliveries 给 caller

### 2. `electron/main/tipc/agent.ts`
- 加 RPC `abortWaitForDeliveries(parentConversationId): { abortedWaits: number; cancelledChildren: number }`
- 调 `bridge.abortWaitsForParent`

### 3. `components/agent-chat/ChatInputArea.tsx`
- 增加 props 或读 conversation-store：识别"当前主会话有活跃 waitState"
  - 后端没现成接口的话——新加 `bridge.hasActiveWait(parentConversationId): boolean` + RPC，前端定时拉或事件订阅
  - 简化方案：通过 `deliveriesAwaitChanged` 事件追踪 + 当主会话 pendingState='running' && awaitCount>0 时认为在 wait
- wait 中时输入框下方渲染按钮：
  ```tsx
  <Button variant="outline" size="sm" onClick={() => abortWait(conv.id)}>
    🛑 中断等待
  </Button>
  ```
- 点击：调 RPC abortWaitForDeliveries，触发 toast 反馈被取消了 N 个

### 4. `components/agent-chat/hooks/usePendingState.ts`（如需扩展）
- 派生层加 'awaiting' 子态？或者复用 'running'+ awaitCount？
- 推荐：保持 idle/running/flushing 三态，awaitCount 单独走 store 选择器，由 StreamingIndicator 组合展示

### 5. `components/agent-chat/StreamingIndicator.tsx`
- 当 awaitCount > 0 时文案改为：「等待 {awaitCount} 个子会话交付…（已完成 {doneCount}）」
- 复用 pendingState 的"插话队列"显示逻辑

### 6. 子会话 chat 区 banner
- `components/agent-chat/AgentChat.tsx`（或子组件）：识别 `conversation.role === 'sub'`
- 顶部加一个 banner（用 `Alert` 或自定义 Card）：
  ```
  ↪ 来自主会话 [{parent title}] 的委派
  交付路径：{outputPath}    状态：{statusBadge}
  ```
- 状态变化时实时更新（订阅 childStatusChanged）
- 需要的数据：parentConversationId → parent title（从 conversation-store 查）；outputPath → bridge.getChildSnapshot → 通过新 RPC `getChildSnapshot(childId): ChildStateSnapshot | null` 拿
  - 加 RPC `getChildSnapshot(childId)` 在 tipc/agent.ts

### 7. 子会话权限请求 / AskParent 待回复
- 子会话 chat 区 PermissionRequestCard / AskUserQuestionCard 已经能正常工作（沿用主会话同套）
- 列表节点上 Step 6 已加 ⚠️ 角标的 hook，本步无需重复

## 验证

- `bun run build:electron` 通过
- `bun run lint` 通过
- 手测：
  1. 主会话派 2 个子会话 + WaitForDeliveries
  2. StreamingIndicator 应显示「等待 2 个子会话交付…（已完成 0）」
  3. 一个子会话调 SubmitDelivery → 「等待 2 个子会话交付…（已完成 1）」
  4. 点击「🛑 中断等待」→ toast「已中断 1 个等待，取消 1 个子会话」→ 主会话 query 解锁继续
  5. 点入未完成的子会话 tab → 顶部 banner 显示「↪ 来自主会话 [...] 的委派 · 交付路径 X · 状态 cancelled」
- 边界：子会话调过 SubmitDelivery（已 done）后再点中断 → 不影响（已经 resolve 了，wait 不存在）

## 实施回填

### 实际改动

**与计划差异**：
- pendingState 没新加 awaiting 子态，照设计推荐保持 `idle/running/flushing` 三态。`awaitCount` 由 store selector 派生后单独传给 StreamingIndicator，由它在 running 态下覆盖文案 + 显示中断按钮
- 中断按钮**没放 ChatInputArea**——直接放进 StreamingIndicator 紧贴文案右侧，更直观（用户看到「等待 N 个交付」时按钮就在旁边）
- 子会话 outputPath / status **不走新 RPC**，而是从 conversation-store 现有的 `childrenByParent[parentId].find(c => c.childId === conversationId)` 反查。bridge 内存丢失时 snapshot=null → banner 显示"快照缺失"badge 但仍渲染 parent title。少了一次 IPC + 自动跟随 childStatusChanged 事件刷新
- 「`bridge.hasActiveWait` 探测主会话是否在 wait」**没加**——直接用 `awaitCount > 0 && pendingState==='running'` 作为兜底判定，触发条件与 bridge 视角的「确实有 waitState」高度重合（agent 调 WaitForDeliveries 必然 running）。少一次轮询
- abortWaitsForParent 行为严格按设计：mark cancelled + 释放 outputPath + 广播 + resolve waitState Promise，**不**调 session.interrupt（子会话继续跑或自己完成；之后调 SubmitDelivery 会拿到 isError）
- 没加额外的 RPC `getChildSnapshot`，但 tipc/delegation.ts 还是新增了 `getChildSnapshot` 和 `abortWaitForDeliveries` 两个 procedure（前者备 Step 8 / 调试用）

**改动文件清单**：
- `electron/main/agents/delegation-bridge.ts` L397-442：`abortWaitsForParent(parentConversationId)` 实装，返回 `{abortedWaits, cancelledChildren}`
- `electron/main/tipc/delegation.ts`：新增 `abortWaitForDeliveries` + `getChildSnapshot` 两个 procedure
- `components/agent-chat/StreamingIndicator.tsx`：新增 props `awaitCount` / `doneCount` / `onAbortWait`；isAwaiting 计算 + 文案改写 + 内联中断按钮（lucide OctagonX）
- `components/agent-chat/SubAgentBanner.tsx`（新建，~70 行）：子会话顶部 banner，从 conversation-store 取 parent title 和 childrenByParent 反查 snapshot；6 种 status 配色
- `components/agent-chat/AgentChat.tsx`：
  - 导入 SubAgentBanner
  - `childrenForThis` selector + `useMemo` 算 awaitCount/doneCount
  - `handleAbortWait` callback（调 RPC + sonner toast）
  - StreamingIndicator 传 awaitCount/doneCount/onAbortWait
  - 在分叉 banner 之前插入 SubAgentBanner（仅 role==='sub'）

### 给下一步的接力棒

- **`abortWaitsForParent` 是否 abort 子会话本身**：**否**。仅 mark cancelled + 释放 outputPath + 广播。子会话 session 继续跑、之后调 SubmitDelivery 会拿 isError 而退出
- **pendingState 是否加 awaiting 子态**：**否**。继续派生 `idle/running/flushing` 三态。awaitCount 走 store selector 单独传 StreamingIndicator
- **子会话 banner 实现位置**：`components/agent-chat/SubAgentBanner.tsx` 单文件，AgentChat 内在分叉 banner 之前渲染。仅当 `selectedConv?.role === 'sub'` 时挂载
- **子会话拿 outputPath 的途径**：从 conversation-store `childrenByParent[parentId]` 反查（bridge 内存还在时有；丢失时 snapshot=null → 显示「快照缺失」状态）
- **abortWait UX**：StreamingIndicator 内联按钮 + sonner toast 反馈。按钮仅在 `pendingState==='running' && awaitCount>0` 时显示
- **已知坑 / 待办**：
  - bridge 内存丢失后子会话 banner 拿不到 outputPath/status，显示"快照缺失"badge；用户仍能看到自己是子会话、知道父会话是谁。后续若要持久化，需要在 conversation 元数据加 `delegationOutputPath` 字段（设计文档里曾否决过；如有需要再开议）
  - 中断等待后子会话**真的继续跑**直到自己完成或 SubmitDelivery 报错。如果 timeoutMinutes 默认 30 分钟，子会话可能继续消耗 token 整 30 分钟。设计上 OK，但如果实战中发现浪费严重，可以扩展 `abortWaitForDeliveries` 的入参 `{ stopChildren?: boolean }` 让用户选
  - `getChildSnapshot` RPC 加了但当前没人用——保留给未来调试 / Step 8 设置页可能用
