---
step: 3
title: PiSession 暂停状态机与 IPC
status: pending
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
- 改动文件清单：

### 给下一步的接力棒
- 关键签名 / 数据结构：
- 下个 step 该从哪里继续：
- 待办或已知限制：
