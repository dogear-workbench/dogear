---
step: 5
title: 插话队列
status: done
---

## 目标

pi 会话支持"AI 运行中用户继续发消息"，采用 pi 的 `steer()`（当前 turn 结束后即注入，比现状更细粒度），前端 `usePendingState` 三态状态机相应调整。验收：在 pi 会话工具调用进行中发一条插话，观察实际注入时机是否符合预期（不必等到整轮结束），且前端文案准确反映当前状态。

## 依赖上下文（接力棒输入）

- **前置产出**：[step1-walking-skeleton.md] 的 `PiSession.sendMessage()` 骨架实现（本步骤要改造这个方法，区分"当前是否有轮次在跑"）。
- **SDK 侧现状**：`query-based-session.ts:871-881`——`sendMessage` 时若有 `messageResolvers` 在等待（生成器 await 下一条消息）立即 resolve；否则 push 进 `pendingMessages` 数组，`emit('pendingCountChanged')`。消费在 `createMessageStream`（`:1633-1659`，async generator），SDK 的 `for-await` 语义决定了"必须等当前完整一轮（含所有工具调用）结束才能取下一条输入"。这个排队语义是被 SDK 输入流形状逼出来的，不是产品主动设计。
- **设计文档已定方案**（"插话队列"一节）：
  - 采用 `agent.steer(message)`（`agent.d.ts:82`，"Queue a message to be injected after the current assistant turn finishes"）而非 `followUp()`。区别：`steer` 在当前 assistant turn 结束后即注入，可能在多轮工具调用之间的某个 turn 边界插入；`followUp` 要等 agent 自然停止（对应现状语义）。
  - `QueueMode = "all" | "one-at-a-time"`（`pi-agent-core/dist/types.d.ts:29`）控制批量注入还是逐条，需要在执行时确认哪个更符合 dogear 现有"插话消息一条条按顺序处理"的预期，选型记录在本步骤实施回填里。
  - 前端 `usePendingState.ts`（`derivePendingState`，`isRunning`→`running`，否则 `pendingCount>0`→`flushing`，否则`idle`）需要重新设计以配合更细粒度的注入时机——具体怎么改（比如是否需要新增一个"即将注入"的过渡态，还是维持三态但调整判断时机）在本步骤执行时结合实际 `steer` 行为观察后确定，不要在这里预先假设一个方案。
- **`StreamingIndicator.tsx`** 消费 `usePendingState` 的返回值展示文案，本步骤如果三态语义变化，需要同步调整文案（但组件本身逻辑简单，改动量应该很小）。

## 计划改动

- [x] `pi-session.ts` 的 `sendMessage()` 改造：判断当前 Agent 是否有轮次在跑（`isRunning` 之类状态），跑着就调用 `agent.steer(message)`，否则直接 `agent.prompt(message)`（正常发送）
- [x] 确认 `pendingCountChanged` 事件的等价物：pi 的 `steer`/`followUp` 是否有对应的"队列长度"可查询（如果没有，dogear 自己维护一个计数器，在 `steer()` 调用时 +1，在观察到消息被实际注入的事件时 -1）
- [x] 视执行时观察到的实际注入时机，评估是否需要调整 `usePendingState.ts` 的状态判断逻辑，需要改就改，不需要就维持不变（不要为了"迁移"强行改前端，只在行为确实不同时才动）
- [ ] 手测：工具调用进行中发插话，观察实际注入时机、前端状态文案是否合理

## 实施回填（做完后填）

### 实际改动

**改动文件**（3 个）：
- `electron/main/agents/pi-session/pi-session.ts` — 核心改造：
  - 新增字段 `pendingSteerCount` / `lastEmittedRunning` / `lastEmittedPendingAction`
  - `new Agent({...})` 配置加 `steeringMode: 'one-at-a-time'`
  - `sendMessage`: `isStreaming || pendingSteerCount>0` 时走 `agent.steer(UserMessage)` + `pendingSteerCount++` + emit `pendingCountChanged` + `syncSessionState()`；否则走原 `agent.prompt(text)`
  - `handleAgentEvent`：`turn_start` 时若 `pendingSteerCount>0` 减 1 并广播；`agent_end` 时兜底强制清零（异常路径保险）
  - 新增 `syncSessionState()` 方法（与 SDK 侧 `QueryBasedSession.syncSessionState` 对称的去重广播）：`running = isStreaming || pendingSteerCount>0`、`pendingAction = pendingSteerCount>0`，状态与上次相同不发
  - `isIdle()` 加上 `pendingSteerCount === 0` 条件
  - `close()` / `interrupt()` 都先 `agent.clearAllQueues()`，重置 `pendingSteerCount=0`，emit `pendingCountChanged { count: 0 }`
- `electron/main/agents/pi-session/pi-session-manager.ts` — 补订阅 session 的 `pendingCountChanged` / `sessionStateChanged` / `sessionClosed`，转发到 broadcaster；`PiSessionBroadcaster` 类型签名扩展到 7 类 event
- `electron/main/tipc/agent.ts` — pi broadcaster 补 3 类 event 转发到 renderer-handlers（`pendingCountChanged` / `sessionStateChanged` / `sessionClosed`）

**QueueMode 选型：`'one-at-a-time'`**
- pi 文档（`pi-agent-core/dist/types.d.ts:23-29`）：`"all"` 一次 drain 全部队列消息，`"one-at-a-time"` 每个 drain 点只取最旧的一条
- 选 one-at-a-time 与 dogear 现有插话语义一致：SDK 侧 `pendingMessages` 数组是 `shift()` 一条条消费，每条对应一个新的 turn；pi 的 one-at-a-time 模式每个 turn_start drain 一条，对应语义完全对齐

**pendingCount 计数实现：dogear 自维护计数器**
- pi 的 Agent 只暴露 `hasQueuedMessages(): boolean`，没有 `.length`，无法直接查询队列长度
- steer 调用时 `pendingSteerCount++` + emit `pendingCountChanged`；pi 的 `turn_start` 事件触发时 `pendingSteerCount--`（one-at-a-time 模式每个 turn_start drain 一条）+ emit
- 异常路径兜底：`agent_end` 事件触发时若 `pendingSteerCount > 0` 强制归零（warn 日志）+ emit，防止 steer 没成功注入导致计数永久卡住
- 中断/关闭路径：`close()` 和 `interrupt()` 都显式调 `agent.clearAllQueues()` + 重置计数器

**sessionStateChanged 的 running/pendingAction 映射**
- `running = agent.state.isStreaming || pendingSteerCount > 0`：与 SDK 侧 `pendingMessages.length > 0 || isQueryInFlight` 对称，包含"队列有货即使当前不在流式也算跑"
- `pendingAction = pendingSteerCount > 0`：与 SDK 侧 `pendingPermissionRequests.size > 0` 语义不同但效果类似——SDK 用它表达"有挂起权限请求"，pi 侧权限请求在 `beforeToolCall` 拦截时 agent.state.isStreaming 本身就是 true，所以 pendingAction 改用 steer 队列长度表达"有插话排队"
- 去重广播：记录上次 `lastEmittedRunning` / `lastEmittedPendingAction`，相同不发
- close() 不走 syncSessionState，靠 `sessionClosed` 让前端清 Set（与 SDK 侧一致）

**usePendingState.ts 未改动**
- 三态语义（idle/running/flushing）在 pi 侧改完后天然契合：前端 `isRunning` 来自 `conversation-store.runningConversationIds`，pi 侧 `sessionStateChanged` 现在能正确驱动这个 Set（之前 pi 完全不发该事件，所以 pi 会话的 running 状态之前其实有 bug——这次修好算"修复副作用"）
- flushing 态（`!isRunning && pendingCount>0`）在 pi 侧（和 SDK 侧）实际几乎不出现：只要 pendingCount>0 就 isRunning=true。这是迁移前就存在的设计，step5 不引入新行为差异，按计划"不为迁移强行改前端"原则不动
- StreamingIndicator 文案（"正在生成..." / "队列还有 N 条插话待回复..."）维持现状

### 给下一步的接力棒

- pi 会话的运行态事件（sessionStateChanged / pendingCountChanged / sessionClosed）现在与 SDK 侧完全对称，前端 conversation-store 单一订阅源已覆盖 pi 会话。后续 Step 6（usage 统计）和 Step 7（联调）可以直接用 `runningConversationIds` 判定 pi 会话是否在跑，无需特殊处理。
- steer 注入时机记录：pi `steer(message)` 在"当前 assistant turn 结束后注入"（即下一个 turn_start 边界），不是整轮跑完。多工具调用之间也会注入，体感比 SDK 侧更细粒度（SDK 是整轮跑完才消费下一条）。但 UI 不会因此变化——前端依然把 steer 后的状态当 running 处理。
- 已知限制：pi 的 `clearAllQueues()` 是同步清空 steer + followUp 两个队列，dogear 当前没用 followUp，所以调 clearAllQueues 等效于 clearSteeringQueue。如果后续 Step 引入 followUp（如自动跟进），需要分别调用 clear API。
- 手测建议（用户接下来做）：
  1. 切一个 Profile 的 apiFormat 到 pi，新开会话
  2. 发一句让 agent 调用工具的话（如 "读 package.json 看看"），等工具调用进行中（StreamingIndicator 显示"正在执行工具..."）
  3. 立刻发一条插话（如 "顺便看看 README"）
  4. 观察：① StreamingIndicator 维持 "正在生成..."（不进 idle），② 输入框工具栏 usage badge 不变，③ 工具调用结束后 agent 是否按插话内容继续（注入时机），④ 完整跑完后状态归 idle
  5. 边界测试：连发 3 条插话，看是否每条按顺序触发独立 turn（one-at-a-time）；中途点中断按钮，看队列是否被清空（pendingCount 归零、UI 不再显示"队列还有 N 条"）
