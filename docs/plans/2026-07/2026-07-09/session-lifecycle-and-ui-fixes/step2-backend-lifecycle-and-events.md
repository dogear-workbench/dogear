---
step: 2
title: 后端 QueryBasedSession 生命周期与状态事件契约
status: done
---

## 目标

把 `QueryBasedSession` 的生命周期从"UI 引用计数强杀"改成"跑步机模式"（运行中保活，空闲无引用才 destroy）。同时定义状态事件契约：后端一次事件同时更新会话内 pendingState 与全局 running/pendingAction Set，为 Step 3 前端 store 简化打下地基。

## 依赖上下文（接力棒输入）

- Step 1 已完成（列表刷新 / 图标 / AskUser 按钮），与本 step 无耦合
- **当前引用计数机制**：`electron/main/agents/query-based-session.ts:2067-2094` 的 `retain` / `release`，`release` 归零直接 `_destroySession()`，粗暴杀掉 SDK 子进程
- **当前 close 语义**：`close()` in `query-based-session.ts:1732-1767` 会调 `this.query.close()` 终止子进程、清 pendingMessages 并 emit `pendingCountChanged:0`、resolve messageResolvers、deny 所有挂起权限请求
- **当前 interrupt 语义**：`interrupt()` in `query-based-session.ts:1775-1786`，清 pendingMessages + `query.interrupt()`，不销毁 session
- **已有事件**：`pendingCountChanged`（session 内 event）、`childStatusChanged`（跨会话广播）
- **前端全局 Set 现状**：`stores/conversation-store.ts` 的 `runningConversationIds` / `pendingActionConversationIds`（读取端），需要有后端事件驱动才能保持同步——目前疑似漏事件导致"关 tab 后圆点还在"
- **需保留**：`interrupt()` 语义不变（只中断 turn，不销毁 session），跟"停止会话"按钮语义一致

## 计划改动

### 2.1 拆分生命周期语义

在 `query-based-session.ts` 里明确三种"下场"：

- **`interrupt()`**：中断当前 turn（清 pending + query.interrupt），session 保活 —— 保持现状不改
- **`close()`**：**永久终止 session**，销毁子进程 —— 只应由"显式终止 / 删对话 / 关工作区 / 退 app"触发，不再由 UI unmount 触发
- 新增 **`markUiDetached(attachmentId)`**：前端 tab 关闭时调用，仅解除 UI 订阅，**不销毁**；如果检测到"pendingState=idle 且已无 UI 订阅"则自动触发 `close()`

- [ ] `query-based-session.ts` 重写 `retain` / `release` 语义：`release` 不再无条件 destroy，改为：
  - 减引用计数
  - 如果计数=0 **且** session 处于 idle（无 pendingMessages / 无 in-flight query / 无挂起权限） → 触发 `close()`
  - 如果计数=0 但仍在跑 → 只解除订阅，session 继续跑
- [ ] 加一个内部方法 `isIdle(): boolean` 综合判断（pendingMessages.length === 0 && !this.isQueryInFlight && awaitingPermissions.size === 0 && askUserPendingRequests.size === 0），语义要跟 pendingState==='idle' 一致

### 2.2 加"跑完自动收"钩子

- [ ] `query-based-session.ts` 在 pendingState 从 non-idle 转 idle 的位置（可能是 pendingMessages 消耗完 / query 结束 / 权限 resolved）加检查：`if (this.uiRefCount === 0 && this.isIdle()) this.close()`
- [ ] 具体埋点位置：pendingCountChanged emit 之后是自然锚点

### 2.3 统一状态事件契约

新增/规范化两个跨会话事件（走 tipc renderer-handlers 广播到前端）：

- [ ] **`sessionStateChanged`**：`{ conversationId, running: boolean, pendingAction: boolean }`，任何 running / pendingAction 状态转移都 emit 一次
- [ ] **`sessionClosed`**：`{ conversationId }`，close() 内部 emit（在 destroy 子进程之前）；前端接收后清 Set + 清任何本地 session 相关缓存

设计约束：**close 时先 emit `sessionClosed` 再销毁**，且不再单独 emit `sessionStateChanged:false`，前端把两个事件都当作"该会话不在跑了"处理即可，避免顺序竞态。

- [ ] `electron/main/tipc/renderer-handlers.ts` 加事件定义（TS 类型）
- [ ] `query-based-session.ts` 在合适的状态转移点 emit：
  - pendingMessages 变化 → 派生 running（pending > 0 或 query in-flight）
  - awaitingPermissions / askUserPendingRequests 变化 → 派生 pendingAction
  - 状态跟上次 emit 不同才 emit（去重，减少事件流量）

### 2.4 补 CreateSession 场景下的 sessionStateChanged

子会话从"派生"到"运行"应立刻广播 running=true，让列表行圆点立刻亮起。Step 1 已经保证列表条目会出现，本 step 保证圆点状态一起对。

- [ ] `delegation-bridge.ts` 或 `query-based-session.ts` 在子会话首次 query 启动时确保 `sessionStateChanged` 被触发

### 2.5 hasActiveSession IPC（可选，看前端是否需要）

- [ ] 评估：Step 3 前端 `useAgentSession` attach 时如果能通过 tipc 判断 session 是否活着，可以决定"续订 vs resume 冷启动"。若沿用现有"attach 时后端自动 upsert（活着就复用，死了就新建/resume）"更简洁，则不新增此 IPC。
- [ ] 决定后回填到接力棒里给 Step 3 参考

## 验证

- `bun run build:electron` 通过
- 逻辑检查：`close()` 只在显式调用 / release 归零 idle / 跑完自动收三种路径下触发，其他任何路径都不再 destroy
- 不要求手测（本 step 是纯后端契约，前端还没适配，跑起来体感和之前一样）

## 实施回填（做完后填）

### 实际改动

**query-based-session.ts**
- 新增字段：`isQueryInFlight` / `lastEmittedRunning` / `lastEmittedPendingAction` / `wasIdle`
- 新增 `isIdle(): boolean`（L1755）：`pendingMessages.length===0 && !isQueryInFlight && pendingPermissionRequests.size===0`
  - 注：本代码库权限请求与 AskUserQuestion 共用同一个 Map，无需分两个字段
- 新增 `syncSessionState()`（L1767）：去重广播 `sessionStateChanged` + 空闲边缘 emit `'idle'`
- 埋点：`sendMessage()` / `createMessageStream` dequeue / `processMessageLoop` result 各分支尾部 / `canUseTool` 权限 & AskUser 分支的 set/delete 之后 / `respondPermissionRequest` / `respondAskUserQuestion` / SessionEnd hook 均调 `syncSessionState()`
- `close()` 头部先 emit `sessionClosed`（在 destroy 子进程之前），末尾重置 `isQueryInFlight=false`；**不再单独 emit sessionStateChanged:false**
- `QueryBasedSessionManager.createSession()`：新增 `session.on('idle', ...)` 监听，refCount===0 时触发 `_destroySession`
- `release()`：归零时先查 `isIdle()`，只有空闲才 destroy；不空闲则保留 session 继续跑，等 'idle' 事件自动收尾
- `retain()` / `interrupt()` 未改

**renderer-handlers.ts**：新增两个事件 TS 类型定义

**conversation-runtime-service.ts**：wireConversationSession 里转发两个新事件到所有窗口（broadcastToAll）

- 与计划差异：无（2.1 / 2.2 / 2.3 / 2.4 全覆盖；2.5 决策 = 不加 IPC）
- 改动文件清单：3 个（query-based-session.ts / renderer-handlers.ts / conversation-runtime-service.ts）

### 验证
- `bun run build:electron`：通过
- `bun run lint`：0 errors，83 既存 warnings
- 逻辑复核：`close()` 只在三条路径触发（① 显式 closeSession/closeAll ② release 归零 && isIdle ③ 'idle' 事件监听在 refCount=0 时自动触发）；其他路径只 emit 状态，不销毁

### 给下一步的接力棒（Step 3 需要这些）

**事件契约签名**
- `sessionStateChanged`: `{ conversationId: string; running: boolean; pendingAction: boolean }`
  - `running = pendingMessages.length > 0 || isQueryInFlight`
  - `pendingAction = pendingPermissionRequests.size > 0`（权限 + AskUser 合并语义）
  - 去重：相同 running/pendingAction 不重复 emit
- `sessionClosed`: `{ conversationId: string }`
  - close() 最开始 emit（此时监听器还没被 removeAllListeners 摘掉）
  - **sessionClosed 之后不会再有 sessionStateChanged:false**，前端把两个事件都当作"该会话不在跑了"处理即可

**retain / release**：签名未变（Step 3 前端调用方式不用改）
- 语义变化：release 归零后不再无条件销毁，先查 isIdle。跑步机模式自动接管

**hasActiveSession IPC**：**未新增**
- attach 本来就是 upsert 语义（`attachConversationRuntime` → `conversationRuntimeService.attachConversation()` 查活的复用、死的走 SDK resume），返回 `{ sessionId, created }` 已够用
- Step 3 前端直接调 attach 即可

**markUiDetached**：**未新增独立 IPC**
- 现有 `detachConversationRuntime` → `sessionManager.release()` 内部已获得"跑步机"行为
- Step 3 继续用现有 IPC 名字

**已知边界**
1. **close() 内事件顺序**：sessionClosed → cleanupSubAgentTails → query.close 销毁子进程 → status=CLOSED → 清 messageResolvers/pendingMessages（emit pendingCountChanged:0）→ 清 pendingPermissionRequests（deny 全部）→ removeAllListeners
2. **`/clear` 斜杠命令行为差异**：`useSendMessage.ts:186` 的 `/clear` 和关 Tab 都走同一个 `closeQueryBasedSession` → `release()`。如果调用时 session 正在跑，旧 session 不会立刻杀而是后台跑完。**Step 3 需要判断**：`/clear` 是否要走真正强杀路径（复用 `sessionManager.closeSession()` 忽略引用计数），还是接受此新语义
3. **子会话（CreateSession）场景不用额外埋点**：`delegation-bridge.ts` 的 `sendMessage(spec.task)` 内部会走 syncSessionState，2.3 埋点自然覆盖
4. **旧 `conversationRunningStateChanged` 事件未删**（`electron/main/tipc/agent.ts` broadcastConversationRunning + wechat-bot-controller 也用）。语义比新事件窄（只 running 无 pendingAction，未覆盖权限场景）。Step 3 前端切到新事件后可决定是否废弃旧事件
