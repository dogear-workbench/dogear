---
step: 3
title: PiSession 暂停状态机与 IPC
status: done
---

## 目标

`PiHarnessAdapter` 暴露 pause 控制，`pi-session.ts` 增加 paused 状态机（暂停判定 / 恢复分支 / 插话队列兼容），新增 pause IPC 路由。

## 依赖上下文（接力棒输入）

- 前置 step 产出：[step2-pause-patch.md] harness 构造选项已支持 `shouldStopAfterTurn?: (ctx) => boolean | Promise<boolean>`
- 当前关键文件状态：`pi-harness-adapter.ts:82-93` 构造 AgentHarness；`pi-session.ts:881-930` `sendMessage()` 二分（:892 `isRunning = running || pendingSteerCount > 0` → steer，否则 prompt）；settled 回调链 `pi-harness-adapter.ts` `onSettled` → `pi-session.ts:785-793` 附近驱动 running=false 结算
- 关键决策回顾：paused 是独立状态；恢复走 prompt 不走 steer（idle 下 steer 抛 invalid_state）；暂停时 steer 队列保留，恢复 run 启动时先 drain（agent-loop.js:83），无需手动搬队列

## 计划改动

- [ ] `pi-harness-adapter.ts`：
  - 新增私有字段 `pauseRequested = false` 与方法 `requestPause()` / `clearPause()` / `isPauseRequested()`
  - 构造 AgentHarness 时传 `shouldStopAfterTurn: () => this.pauseRequested`（注意：pauseRequested 为 false 时返回 false，不影响正常多 turn run）
- [ ] `pi-session.ts`：
  - `requestPause()` 公开方法：转发 adapter；仅 running 时有效，重复调用幂等
  - settled 回调：触发时若 `adapter.isPauseRequested()` → 进入 paused 状态并广播（`sessionStateChanged` / `getLiveSnapshot()` 的 `sessionState` 加 `paused` 字段），否则维持现有 idle 路径
  - `sendMessage()`（:881-930）分支重排：**paused 优先** → `clearPause()` + 现有 prompt 路径；其次 isRunning → steer；最后 prompt。注意 paused 时 `pendingSteerCount` 可能 > 0（暂停前插话仍在队列），不能让它把分支带进 steer
  - `interrupt()`：paused 态等价 idle，无需 abort；确认现有逻辑不误伤（paused 时调 abort 会走 harness idle 分支，验证不抛错即可）
  - `isRunning()` / `isIdle()` 语义复核：paused 时两者都应返回 false（或按现有消费方约定调整，grep 两个方法的调用点确认无破坏）
- [ ] IPC 路由（tipc）：新增 pause 请求（`session.pause(sessionId)` 之类，命名对齐现有路由风格）；`getLiveSnapshot` 返回值带上 paused
- [ ] 验证：`bun run build:electron` 过；手工场景——运行中 requestPause → run 在当前 turn 结束后停 → 状态广播 paused →（暂停前插一条话）→ 发恢复消息 → 确认顺序：旧插话先注入、恢复消息后到

## 实施回填（做完后填）

### 实际改动
- 与计划差异：
  1. 恢复 run 内顺序实测为「恢复消息 → 暂停前插话 → assistant」，与本计划「暂停前插话 → 恢复消息」相反（agent-loop 实际行为：runAgentLoop 先 push prompt 消息入 context，runLoop 开头才 drain steer 队列）；插话无丢失无重复，未做补偿（patch 0.84 作废）
  2. 补充异常收尾（failed/cancelled）不进 paused：handleSettled 查 currentTurnResult 非空则 clearPause 回 idle
  3. interrupt() 末尾补 syncSessionState()（paused 态无 run 无 settled 链，必须显式广播撤下）
  4. requestPause 返回受理 boolean；sessionStateChanged 广播 payload 同步加 paused（Step 4 实时感知唯一通道）
- 改动文件清单：pi-harness-adapter.ts（pauseRequested + requestPause/clearPause/isPauseRequested + shouldStopAfterTurn 透传）、pi-session.ts（requestPause/isPaused 公开、handleSettled paused 判定、sendMessage paused 优先分支、interrupt 清标志+同步广播、isRunning/isIdle 加 !isPaused、sessionState/广播带 paused）、pi-session-manager.ts 与 renderer-handlers.ts 与 conversation-runtime-service.ts（类型加 paused）、tipc/agent.ts（新路由 pauseQueryBasedSession + broadcaster payload）

### 给下一步的接力棒
- 关键签名 / 数据结构：PiSession.requestPause(): boolean（仅 running 受理、幂等）；isPaused(): boolean（标志置位 && !running）；sessionState = { running, pendingAction, paused }（getLiveSnapshot / attach 返回 / sessionStateChanged 广播三处同构）；IPC pauseQueryBasedSession({ sessionId }) → { success } | { error }
- 下个 step 该从哪里继续：前端 UI（Step 4）——暂停按钮接 pauseQueryBasedSession，paused 状态从 attach/广播/snapshot 三处取，文案「完成当前步骤后暂停」，恢复 = 直接 sendMessage，paused 态点中断 = 取消暂停+丢弃队列（主进程已兜住）
- 待办或已知限制：恢复 run 内插话顺序与计划描述相反（见上）；paused 会话无 attachment 后 release 直接销毁（重连 resume 历史、暂停态消失，属预期）；完整推演见共享区 step3-delivery.md
