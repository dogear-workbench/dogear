---
step: 1
title: 检测层——终态联动 + 滑动 idle 计时
status: done
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
  - idle 计时与终态通知拆成两个独立新模块 `delegation-idle.ts` / `delegation-terminal.ts`（纯逻辑无服务依赖），而不是直接写在 bridge 内——为了 script 级测试可 mock（bridge 直接 mock 需拦截 electron/tipc）
  - `ChildStateInternal.idleTimer?` 实际为 `idleWatch?: IdleWatch`（listener + timer 同生命周期单句柄，dispose 一并摘 listener）；idle 阈值经 `setDelegationIdleTimeoutMs()` 可变 getter 注入（测试用，不进设置页）
  - 终态通知除 `onSessionComplete` 外也在 `stopChild`（hang/timeout 路径）直接发——避免依赖 interrupt 后 complete 事件必然到来的空窗；notify 幂等（waiter resolve 即删）
  - `markChildDelivered` 同步补了 idle 清理（计划未列，防交付后 idleTimer 空挂）
- 改动文件清单：
  - `electron/main/agents/delegation-idle.ts`（新）：`IDLE_TIMEOUT_MS`、`createIdleWatch({session,onActivity,onIdle,timeoutMs?})`
  - `electron/main/agents/delegation-terminal.ts`（新）：`DelegationErrorClass`、`TerminalInfo`、`isNotifiableTerminal()`、`buildTerminalNotice()`、`collectTerminalWaiterKeys()`、`formatTerminalSummary()`
  - `electron/main/agents/delegation-bridge.ts`：wireSession 挂 message（L150）、onChildActivity（L168）、notifyTerminalToWaiters（L204）、startChild 挂 idleWatch（L346）、stopChild 扩 hang（L369-380）、`WaitForMessageResult.terminal?`（L52）
  - `electron/main/types.ts` / `types/delegation.ts`：ChildStatus 加 `hang|interrupted`；ChildStateSnapshot 加 `lastActivityAt/retryCount/errorClass/modelTried`
  - `electron/main/agents/tools/delegation-tools.ts`：WaitForMessage 区分超时 vs 终态通知文案
  - `components/agent-chat/AgentChat.tsx`、`components/conversation-list/ConversationRow.tsx`：新状态值兼容
  - `electron/main/agents/delegation-idle.test.ts`（新）：4 用例全过

### 给下一步的接力棒
- 关键签名 / 数据结构：
  - `TerminalInfo = { status: ChildStatus; errorMessage?; errorClass?: DelegationErrorClass; attempts: number; modelTried: string[] }`（delegation-terminal.ts）
  - `WaitForMessageResult.terminal?: TerminalInfo`（bridge 导出）
  - Step 2 在 `notifyTerminalToWaiters`（bridge L204）接管重调：决定 resume 则回 running、不调 notify；quota 分类填 `errorClass`、resume 计数填 `attempts/retryCount`、模型链填 `modelTried`
- 下个 step 该从哪里继续：`onSessionComplete` / `stopChild` 的终态分支 → 错误分类（quota 关键词表 + `DelegationErrorClass`）→ `resumeChild`
- 待办或已知限制：
  - cancelled / no_delivery 终态本步不通知（范围外；用户中断由 abortWaitsForParent resolve null 兜底）
  - errorClass 暂一律 'transient'，attempts 恒 0、modelTried 恒空
  - 集成测试对 `@egoist/tipc/main` 需 mock.module（CJS 包 require electron 绕过 electron mock）
