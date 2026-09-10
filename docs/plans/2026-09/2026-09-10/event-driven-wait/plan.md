# 事件驱动等待（去挂起化）实施计划

**目标**：删除 `dogear__WaitForMessage` 挂起式等待，改为「派单后结束回合 + 交付/终态消息注入唤醒」，让等待期间用户插话即时生效。

**架构思路**：等待从同步阻塞工具改成事件驱动。模型派单后 stop，调度器（delegation-bridge 既有状态机，保留自动复活/降级链/no_delivery 检测）把交付与终态信号转成 `sendMessage()` 注入（running→steer / idle→prompt）。排除「WaitForMessage 提前醒」（每插话 +1 轮全上下文调用）和「插话即 abort 重发」（等价手动中断）。设计细节见 [../event-driven-wait-design.md](../event-driven-wait-design.md)。

**涉及模块**：`electron/main/agents/delegation-bridge.ts`、`delegation-terminal.ts`、`pi-session.ts`、`session-append-templates.ts`、前端会话状态组件/store、`delegation-*.test.ts`

## 步骤索引

- [x] [Step 1: 终态通知增加注入出口](./step1-inject-outlet.md) — notifyTerminalToWaiters 无 waiter 时改为消息注入，双出口过渡
- [ ] [Step 2: 删除挂起机制并切换提示词](./step2-remove-suspension.md) — 原子切换：删 WaitForMessage 工具/waiter 机制/abortMessageWaits，提示词改为「派单后结束回合」
- [ ] [Step 3: UI 等待中状态与收尾](./step3-ui-waiting-state.md) — run settled + 有 running 子会话时展示「等待中」，清理测试用例，doc-sync

## 全局决策

- 消息注入统一走 `sendMessage()`（`pi-session.ts:913` 已有 running/idle 分支），不新增旁路通道
- 注入文案复用 `buildSenderTag`（delegation-bridge.ts）+ `buildTerminalNotice`（delegation-terminal.ts:98），no_delivery 自愈指引文案不变
- `settleTerminal` 的「重调优先于通知」决策链（transient/quota 自动复活、failover 降级）原样保留，只改最终通知出口
- 双出口（waiter 优先、fallback 注入）仅存在于 Step 1 过渡期，Step 2 收口为单一注入出口
- 项目不新增单测；存量 `delegation-*.test.ts` 中 waiter 相关用例随机制删除同步清理
