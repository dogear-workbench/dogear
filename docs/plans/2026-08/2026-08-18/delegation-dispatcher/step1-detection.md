---
step: 1
title: 检测层——终态联动 + 滑动 idle 计时
status: pending
---

## 目标

子会话走到失败终态（failed/hang/timeout）时，秒级唤醒挂起在 `dogear__WaitForMessage` 的主会话（带结构化死因），替代现在的「干等 30 分钟只拿到超时」；供应商 hang 住时 10 分钟无流事件即判死。

## 依赖上下文（接力棒输入）

- 设计文档：`docs/plans/2026-08/2026-08-18/delegation-dispatcher-design.md`
- 现状关键代码（均已通读确认）：
  - `electron/main/agents/delegation-bridge.ts:118` `onSessionComplete` —— 只改 childStates + 广播 UI + detach，**不碰 messageWaiters**（本步要修的核心）
  - `electron/main/agents/delegation-bridge.ts:110` `wireSession` —— 只挂 `complete` 事件
  - `electron/main/agents/delegation-bridge.ts:262` 30 分钟总超时 timeoutTimer
  - `electron/main/agents/delegation-bridge.ts:378-401` `waitForMessage` / messageWaiters 结构
  - `electron/main/types.ts` 的 `ChildStatus` / `ChildStateSnapshot`
- 关键决策回顾：done（正常交付）不通知（交付消息自己走 deliverMessage）；本步先做「终态即通知」，Step 2 再改为「重调优先于通知」——本步 onSessionComplete 对失败终态一律通知

## 计划改动

- [ ] `electron/main/types.ts`：`ChildStatus` 增加 `'hang' | 'interrupted'`；`ChildStateSnapshot` 增加 `lastActivityAt?: number`、`retryCount?: number`、`errorClass?: string`、`modelTried?: string[]`
- [ ] `types/delegation.ts`（前端类型）：同步 ChildStatus 新值
- [ ] `electron/main/agents/delegation-bridge.ts`：
  - [ ] `ChildStateInternal` 加 `lastActivityAt`、`idleTimer?`
  - [ ] `wireSession` 增加 `session.on('message', ...)` → `onChildActivity(childId)`：更新 `lastActivityAt` + 重置 idleTimer（`IDLE_TIMEOUT_MS = 10 * 60_000` 常量）；timer 触发 → `stopChild(childId, 'hang')`——`stopChild` 的 reason 参数扩为 `'cancelled' | 'timeout' | 'hang'`，errorMessage 对应「无进展中断」
  - [ ] `startChild` / `stopChild` / `onSessionComplete` 中 idleTimer 与 timeoutTimer 同步清理（两把 timer 都要管）
  - [ ] `onSessionComplete` 增加终态联动：status 为 `failed | hang | timeout` 时（本步不含重调，一律通知），resolve 所有 `ownerConversationId === c.parentConversationId && fromSdkSessionIds.has(c.sessionId)` 的 waiter，构造 `WaitForMessageResult`：`message` 为人类可读文案（含死因、已运行时长），`delivery: false`，`terminal: { status, errorMessage, errorClass: 本步可先填 'transient', attempts: 0, modelTried: [] }`
  - [ ] `WaitForMessageResult` 类型加 `terminal?` 字段（bridge 导出的 interface）
- [ ] `electron/main/agents/tools/delegation-tools.ts`：`dogear__WaitForMessage` 返回文案区分「超时（无消息）」与「终态通知（带 terminal）」两种——后者给出明确死因摘要
- [ ] `broadcastChildStatusChanged` 消费端前端兼容：grep `childStatusChanged` 的前端消费点（`components/` 下），新状态值至少不崩（未知状态显示为通用失败样式即可，精细展示留 Step 4）

## 验收路径

1. `bun run build:electron` 通过
2. dev 环境：主会话派子会话 + WaitForMessage → 手动停止/断供应商 → 主会话秒级收到含死因的通知（不再是等满超时）
3. hang 场景可降级验证：将 IDLE_TIMEOUT_MS 临时调小（如 30s），派遣一个会被供应商 hang 的任务（或临时在 sendMessage 前阻塞），观察 30s 后判 hang + 通知
4. script 级：参照 `electron/main/agents/delegation-lifecycle.test.ts` 模式补 `delegation-idle.test.ts`——mock session EventEmitter，验证 message 事件重置 idleTimer、无事件到期触发 hang 状态 + waiter 被 resolve 带 terminal

## 实施回填（做完后填）

### 实际改动
- 与计划差异：
- 改动文件清单：

### 给下一步的接力棒
- 关键签名 / 数据结构：
- 下个 step 该从哪里继续：
- 待办或已知限制：
