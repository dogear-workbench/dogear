---
step: 2
title: B2 停止按钮在 WaitForMessage 挂起时死锁
status: done
---

## 目标

`PiSession.interrupt()` 和 `close()` 在 `adapter.abort()` 前调 `abortMessageWaits()`，resolve 所有 WaitForMessage 挂起的 Promise，让 Harness 的 `waitForIdle()` 不再阻塞。

## 依赖上下文（接力棒输入）

- 关键文件：
  - `electron/main/agents/delegation-bridge.ts` — `abortWaitsForParent()` L470（resolve 等待 + cancel 子会话），`messageWaiters` Map L409
  - `electron/main/agents/pi-session/pi-session.ts` — `interrupt()` L687，`close()` L655
- 当前 `interrupt()`：recordTurnCancelled → rejectAllPendingPermissionRequests → `adapter.abort()`（在 WaitForMessage 场景下永久挂起）
- `WaitForMessage` 工具 handler 拿到 null 结果后返回超时错误文本（delegation-tools.ts L130），Harness 收到 tool_result 即可继续

## 计划改动

- [ ] `delegation-bridge.ts`：新增 `abortMessageWaits(parentConversationId: string): number`，只遍历 `messageWaiters` resolve(null) 属于该 parent 的等待，不碰 childStates
- [ ] `pi-session.ts`：`interrupt()` 在 `rejectAllPendingPermissionRequests` 之后、`adapter.abort()` 之前，调 `abortMessageWaits(this.config.conversationId)`
- [ ] `pi-session.ts`：`close()` 同样在 `adapter.abort()` 之前调 `abortMessageWaits`
- [ ] 验证：主会话 WaitForMessage 挂起时点停止 → 立即停止，不再卡死

## 实施回填（做完后填）

### 实际改动
- 与计划差异：加了 `abortMessageWaitsForConversation()` 私有方法封装动态 import + 错误兜底，语义等价。用动态 `await import()` 而非静态 import 避免循环依赖。
- 改动文件清单：
  1. `electron/main/agents/delegation-bridge.ts` — 新增 `abortMessageWaits(parentConversationId): number`，只 resolve 等待不碰 childStates
  2. `electron/main/agents/pi-session/pi-session.ts` — `interrupt()` 和 `doClose()` 在 rejectAllPendingPermissionRequests 之后、adapter.abort() 之前调 `abortMessageWaitsForConversation()`；新增该私有方法封装动态 import

### 给下一步的接力棒
- 关键签名 / 数据结构：
  - `abortMessageWaits(parentConversationId: string): number` — 只 resolve 等待，不碰子会话
  - `PiSession.abortMessageWaitsForConversation(): Promise<void>` — 动态 import + 调 abortMessageWaits
- 下个 step 该从哪里继续：B4 派遣后 WaitForMessage，改 delegation-tools.ts / session-append-templates.ts / pi-session.ts
- 待办或已知限制：无
