# 事件驱动等待（去挂起化）实施计划

**目标**：删除 `dogear__WaitForMessage` 挂起式等待，改为「派单后结束回合 + 交付/终态消息注入唤醒」，让等待期间用户插话即时生效。

**架构思路**：等待从同步阻塞工具改成事件驱动。模型派单后 stop，调度器（delegation-bridge 既有状态机，保留自动复活/降级链/no_delivery 检测）把交付与终态信号转成 `sendMessage()` 注入（running→steer / idle→prompt）。排除「WaitForMessage 提前醒」（每插话 +1 轮全上下文调用）和「插话即 abort 重发」（等价手动中断）。设计细节见 [../event-driven-wait-design.md](../event-driven-wait-design.md)。

**涉及模块**：`electron/main/agents/delegation-bridge.ts`、`delegation-terminal.ts`、`pi-session.ts`、`session-append-templates.ts`、前端会话状态组件/store、`delegation-*.test.ts`

## 步骤索引

- [x] [Step 1: 终态通知增加注入出口](./step1-inject-outlet.md) — notifyTerminalToWaiters 无 waiter 时改为消息注入，双出口过渡
- [x] [Step 2: 删除挂起机制并切换提示词](./step2-remove-suspension.md) — 原子切换：删 WaitForMessage 工具/waiter 机制/abortMessageWaits，提示词改为「派单后结束回合」
- [x] [Step 3: UI 等待中状态与收尾](./step3-ui-waiting-state.md) — run settled + 有 running 子会话时展示「等待中」，清理测试用例，doc-sync

## 全局决策

- 消息注入统一走 `sendMessage()`（`pi-session.ts:913` 已有 running/idle 分支），不新增旁路通道
- 注入文案复用 `buildSenderTag`（delegation-bridge.ts）+ `buildTerminalNotice`（delegation-terminal.ts:98），no_delivery 自愈指引文案不变
- `settleTerminal` 的「重调优先于通知」决策链（transient/quota 自动复活、failover 降级）原样保留，只改最终通知出口
- 双出口（waiter 优先、fallback 注入）仅存在于 Step 1 过渡期，Step 2 收口为单一注入出口
- 项目不新增单测；存量 `delegation-*.test.ts` 中 waiter 相关用例随机制删除同步清理

## 完成总结

三个 step 全部完成（2026-09-10）：

- **Step 1**（221291a）：抽出 `pushToParentSession` 共用注入出口，`notifyTerminalToWaiters` 无 waiter 时把终态通知注入父会话（原先静默丢弃），waiter 命中路径行为不变
- **Step 2**（6ea4557）：原子切换——删 `dogear__WaitForMessage` 工具与 waiter 挂起机制（messageWaiters/waitForMessage/abortMessageWaits/collectTerminalWaiterKeys），deliverMessage 与终态通知收口为单一注入出口（notifyTerminalToParent 改名），提示词切「派单后结束回合，交付/终态作为新消息自动唤醒」。unknown tool 容错已验证安全（未留占位工具）。测试 mock 升级镜像真实 attach/detach 语义，waiter 用例全部改写为注入断言
- **Step 3**：前端「等待子会话交付中」中间态（完全派生，未新增 store 字段）：`isWaitingForChildren`（AgentChat.tsx:140）→ StreamingIndicator 消息流底部 + ChatInputArea 状态行展示；顺手修 handleAbortWait 读已删 abortedWaits 的残留 bug；codebase-map doc-sync

验证：lint 0 errors、build 全绿、全量 300 tests 0 fail。上线人工回归清单 7 项在共享区 event-driven-wait/step3-delivery.md。

**遗留（待用户决策）**：task-queue 生命周期与新等待机制交互——执行会话派单后结束回合会提前触发队列兜底置 review +「任务待审核」通知，续跑轮在 review 态下 ReportTaskResult 被「无需重复申报」拦截；根治需队列层「存在 running 直属子会话不结算」语义（task-queue.ts:237 runExecutionTurn await 一次 sendMessage 即结算）。存量会话对已删工具名的真实模型适应表现待观察。
