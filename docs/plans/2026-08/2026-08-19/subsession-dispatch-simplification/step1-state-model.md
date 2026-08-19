---
step: 1
title: 状态模型精简与重试语义
status: done
---

## 目标

ChildStatus 收敛为 running/stopped、交付事实独立（delivered）、重试改连续计数（consecutiveFails），修复「曾经 no_delivery 后来真交付被 guard 挡掉」的卡死 bug。

## 依赖上下文（接力棒输入）

- 本步是第一步，无前置产出
- 关键现状文件：
  - `electron/main/types.ts:223` — `ChildStatus` 联合类型（当前含 running/done/no_delivery/failed/hang/timeout/cancelled/interrupted）
  - `electron/main/types.ts:243` — `ChildStateSnapshot`（含 summary/retryCount/errorClass/modelTried）
  - `electron/main/agents/delegation-bridge.ts` — `ChildStateInternal` 定义、`onSessionComplete`（:249）、`settleTerminal`（:298）、`resumeChild`（:329）、`stopChild`（:607）、`markChildDelivered`（:625）、`isRetryableStatus`（:283）、`isTerminal`
  - `electron/main/agents/delegation-lifecycle.ts` — `classifyChildCompletion`（返回 status/errorMessage 二元组）
  - `electron/main/agents/delegation-resume.ts` — `decideResumeOnError(errorClass, retryCount, modelTried, fallback)`
  - `electron/main/agents/delegation-terminal.ts:38` — `classifyDelegationError`、`getDelegationMaxRetry`
- 关键决策回顾：对外状态只留进程视角；死因降级为 terminalReason 内部字段——调度逻辑（重试决策/通知判定）改动最小化，只动快照层和分类函数

## 计划改动

- [x] `electron/main/types.ts:223` — `ChildStatus = 'running' | 'stopped'`
- [ ] `electron/main/types.ts:243` — `ChildStateSnapshot`：删 `summary / retryCount / errorClass / modelTried`，`errorMessage` 改名 `lastError`，新增 `delivered: boolean`
- [ ] `types/electron-api.ts` — 前端镜像类型同步（grep `ChildStatus` / `ChildStateSnapshot` 找到定义处）
- [ ] `delegation-bridge.ts` — `ChildStateInternal`：`status: ChildStatus` + 新增 `terminalReason?: 'failed' | 'hang' | 'timeout' | 'cancelled' | 'no_delivery'`、`delivered: boolean`（初始 false）、`consecutiveFails: number`（原 retryCount）；`errorClass / modelTried` 保留 internal
- [ ] `delegation-lifecycle.ts` — `classifyChildCompletion` 改返回 `{ terminalReason, lastError }`（不再返回 status；success 分支 terminalReason 取决于调用方 delivered，见下）
- [ ] `delegation-bridge.ts` `onSessionComplete` — success 到达时 `consecutiveFails = 0`；置 stopped + terminalReason（failed→failed 带分类、success→`delivered ? undefined : 'no_delivery'`）；通知判定在 settleTerminal 按 terminalReason === 'no_delivery' 走
- [ ] `delegation-bridge.ts` `stopChild` — 置 stopped + terminalReason（hang/timeout/cancelled），errorClass 赋值逻辑保留
- [ ] `delegation-bridge.ts` `settleTerminal` — `isRetryableStatus(status)` 改判 `terminalReason`（failed/hang/timeout 可重试）
- [ ] `delegation-bridge.ts` `markChildDelivered` — **核心修复**：guard 改为 `delivered 已 true 则 return`；置 `delivered = true` + broadcastChildStatusChanged + broadcastDeliveriesAwaitChanged + releaseOutputPath；**不改 status、不 clearChildTimers、不置 finishedAt**（complete 事件才是安全收尾点，bridge:249 注释）
- [ ] `delegation-bridge.ts` `resumeChild` — `retryCount` → `consecutiveFails` +1；`delivered` 不清（复活已交付会话的确认场景无害）
- [ ] `delegation-resume.ts` `decideResumeOnError` — 参数语义改连续计数（决策逻辑不变，阈值取自 max retry）
- [ ] `delegation-terminal.ts` — `getDelegationMaxRetry` 默认值 2 → 3
- [ ] `broadcastDeliveriesAwaitChanged` / `notifyTerminalToWaiters` — doneCount 改按 `delivered` 统计；通知文案字段对齐（errorClass/attempts 保留内部值，模型提示不变）
- [ ] `delegation-tools.ts` 中引用快照字段处（ListLinkedSessions 渲染、ResumeSession 的 snapshot.status 拦截）最小适配编译通过——工具描述的完整改造留给 Step 3
- [ ] `components/conversation-list/ConversationRow.tsx` + `components/agent-chat/AgentChat.tsx:37` — 前端 status 判断最小适配（done→delivered、cancelled/interrupted→stopped），完整 UI 改造留给 Step 4
- [ ] `delegation-test-mocks.ts` — mock 的状态构造对齐新类型
- [ ] 测试改造：`delegation-lifecycle.test.ts`（新返回形状）、`delegation-resume.test.ts`（连续计数语义：加「成功清零后再失败从 0 数」用例）、`delegation-regression.test.ts` 中依赖旧状态名的用例

## 验证

- `bun run build:electron` 编译过
- `bun test`（delegation 相关全绿）
- 手推状态机：①子会话正常交付 → stopped & delivered=true；②complete 无交付 → stopped & terminalReason=no_delivery & 通知发出；③no_delivery 后主会话 SendMessage 让它补交付 → markChildDelivered 在 stopped 状态下成功置 delivered=true（卡死 bug 修复的直接验证）；④hang 3 次后放弃；⑤hang 1 次复活成功跑完 → consecutiveFails 清零 → 再 hang 从 0 数

## 实施回填（做完后填）

### 实际改动
- 与计划差异：
  - 新增 `ChildTerminalReason` 命名类型（electron/main/types.ts + types/delegation.ts 镜像），terminalReason 字段与 lifecycle/terminal/bridge 三处共用
  - `classifyChildCompletion(result, delivered)` 增加 delivered 参数，success 分支的 terminalReason 在函数内判定（而非调用方后处理），lifecycle 函数自足
  - `markChildDelivered(childId)` 去掉了无用的 summary 参数（快照已删 summary 字段），delegation-tools.ts 调用点同步
  - `delegation-persist.ts` 做了编译必需的最小类型适配（不删机制，Step 2 统一删）：`loadRestorableChildren` 恢复 running → stopped + lastError='应用重启中断' + delivered 兜底；`conversationToSnapshot` 恒 stopped/delivered=false；`getChildrenByParent` 补集按 updatedAt 降序截 10 条（全局决策要求的补集语义提前落地，Step 2 删 persist 时保留该排序）
  - 恢复路径不落盘 internal 字段（consecutiveFails 恢复为 0、errorClass/modelTried 丢失）——Step 2 删除整个持久层，该信息不再需要
  - `delegation-idle.test.ts` 也依赖旧状态名，一并适配（计划只列了 regression，实测 idle 测试同样命中）
  - 全量 bun test 有 9 fail/7 error 存量问题（categorize-prompt 提示词内容 + electron 模块加载），stash 对照确认与本次改动无关；delegation 相关 28/28 全绿，新增 3 个用例（success+delivered 无死因、success 清零后从 0 计数、no_delivery 后补交付）
- 改动文件清单：electron/main/types.ts、types/delegation.ts、electron/main/agents/delegation-lifecycle.ts、delegation-terminal.ts、delegation-bridge.ts、delegation-persist.ts、delegation-resume.ts、tools/delegation-tools.ts、delegation-test-mocks.ts、delegation-lifecycle.test.ts、delegation-resume.test.ts、delegation-regression.test.ts、delegation-persist.test.ts、delegation-idle.test.ts、components/agent-chat/AgentChat.tsx、components/conversation-list/ConversationRow.tsx

### 给下一步的接力棒
- 关键签名 / 数据结构：
  - `ChildStatus = 'running' | 'stopped'`；`ChildTerminalReason = 'failed' | 'hang' | 'timeout' | 'cancelled' | 'no_delivery'`（两处定义：electron/main/types.ts + types/delegation.ts）
  - `ChildStateSnapshot`：删 summary/errorClass/modelTried/retryCount，errorMessage→lastError，新增 delivered: boolean（快照不再暴露内部调度字段）
  - `ChildStateInternal`（bridge）：+ terminalReason?/errorClass?/modelTried?/consecutiveFails
  - `classifyChildCompletion(result, delivered) → { terminalReason?, lastError? }`
  - `markChildDelivered(childId)`：只置 delivered + 双广播 + releaseOutputPath + touchPersist，不动 status/timers/finishedAt
  - `TerminalInfo/TerminalNoticeInput/terminalStatusLabel/isNotifiableTerminal` 均改收 terminalReason；MAX_RETRY=3
  - `decideResumeOnError(errorClass, consecutiveFails, modelTried, fallback)`
- 下个 step 该从哪里继续：Step 2 删 delegation-persist.ts 整文件 + bridge 里 touchPersist/persistChildStates/loadChildStates/启动时静默删旧 delegation-state.json + 删 delegation-persist.test.ts（注意保留 getChildrenByParent 的补集排序截 10 逻辑，conversationToSnapshot 需从 persist 文件迁出或内联到 bridge）
- 待办或已知限制：
  - 快照不再含 consecutiveFails/modelTried，相关断言只能通过终态通知 attempts/modelTried 间接验证
  - ListLinkedSessions 渲染仍是 status 原文（running/stopped），交付判定规则文案留给 Step 3
  - 前端 ConversationRow 状态文字标签、子会话图标完整改造留给 Step 4（本步只做了 done→delivered、cancelled/interrupted→stopped 的最小映射）
