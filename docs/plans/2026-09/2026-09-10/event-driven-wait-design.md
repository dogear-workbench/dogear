# 事件驱动等待（去挂起化）设计

**日期**：2026-09-10
**状态**：已与用户对齐方案方向，细节待实施

## 背景

主会话派子会话后调用 `dogear__WaitForMessage` 挂起等待交付。Pi（pi-agent-core 0.83.0）的插话机制 `steer()` 只在 turn 边界消费（`agent-loop.js:160`），而挂起的工具调用挡住了 turn 边界——等待期间用户插话只能排队，等子会话交付后与交付结果合并在同一轮被读到。用户想纠正方向时插话时效 = 交付时刻，可能滞后数十分钟。

调研结论（详见对话记录）：

- Pi 原生无 turn 内打断：pi-ai 流层无注入 API，也没有「只取消当前工具不取消 run」的机制
- `abort() + 合并重发` 与「手动点停止再发送」等价，无实施价值
- 已有 steer 排队链路（`sendMessage → adapter.steer`）本身是好的，问题只出在挂起式等待

## 目标

1. 主会话等待子会话期间，用户插话的时效 = 普通对话（`prompt()` 直接生效）
2. 等待本身 0 轮 LLM 调用成本
3. 完整保留现有调度能力：自动复活、quota 降级链、no_delivery 检测、终态秒级通知

## 架构

**核心做法**：把「等待」从同步阻塞工具改成事件驱动唤醒。

- 模型派单后不再调 WaitForMessage，直接结束回合（输出收尾语后 stop，run settled）
- 子会话交付/终态时，调度器把信号转成消息注入主会话：running 时 `steer()`、idle 时 `prompt()`（复用 `sendMessage()` 已有的分支）
- 主会话被消息唤醒后续跑，逻辑上处于「等待外部事件」状态，但 agent loop 已停，无任何实体挂起

**成本账**（LLM 调用次数，已与用户对齐）：

| 场景 | 挂起式（现状） | 事件驱动 |
|---|---|---|
| 纯等待交付 | 2 次（发起 + 消费） | 2 次（发起 + 消费），等价 |
| 等待 + 插话 1 次 | 2 次（插话搭交付便车，时效差） | 3 次（多 1 次回应插话，即时） |

插话多出的轮次是回应插话的正当成本，不是等待的税。

**排除的选项**：

- A 路线（WaitForMessage 监听 `queue_update` 提前 resolve）：每插话 +1 轮全上下文调用，是在挂起架构缺陷上打补丁
- B 路线（插话即 abort + 合并重发）：等价手动中断，砍掉
- 保持现状：插话时效问题不解决

## 模块边界

| 文件 | 改动 |
|---|---|
| `electron/main/agents/delegation-bridge.ts` | `deliverMessage()`（:810）删 waiter 分支，所有路径走已有 `'queued'` 分支（`session.sendMessage` 注入）；`notifyTerminalToWaiters()`（:371）改为同款消息注入；waiter/timer 机制（`messageWaiters`、`waitForMessage`、`abortMessageWaits`）整体退役 |
| `electron/main/agents/delegation-terminal.ts` | `collectTerminalWaiterKeys` 等 waiter 专用辅助随 waiter 机制删除；`buildTerminalNotice` 保留（注入消息复用其文案） |
| `electron/main/agents/pi-session.ts` | 删 `dogear__WaitForMessage` 工具注册与 `abortMessageWaits` 调用（interrupt 死锁兜底随挂起机制消失） |
| `electron/main/agents/session-append-templates.ts` | :29-30 派单指引改为「派单后结束回合，交付/终态会作为消息自动唤醒你」；:133 triggerDescription 同步 |
| 前端（会话状态相关组件/store） | run settled 且存在 running 直属子会话时展示「等待子会话交付中」中间态，不显示为会话结束 |

`settleTerminal` 的「重调优先于通知」决策链（transient/quota 自动复活、failover 降级）**原样保留**，只改最终通知出口。`delegation-lifecycle.ts` 的 no_delivery 归类不变。

## 数据流

- **派单**：`CreateSession` → childStates 建立映射 → 模型输出收尾语 stop → run settled → UI 进入「等待中」
- **交付**：delivery 消息 → `markChildDelivered` → `deliverMessage` → `sendMessage(交付摘要)` → idle 时 prompt 唤醒 / running 时 steer 排队
- **终态**：complete 事件 → `settleTerminal` → 可复活则 `resumeChild`（不打扰主会话）→ 不可复活 → 终态通知注入（no_delivery 文案已含 ReadReferenceSession/ListGroupFiles 自愈指引）
- **插话**：UI → `sendQueryBasedSessionMessage` → `isRunning=false` → `prompt()` 立即生效

## 错误处理 / 边界情况

- **注入时主会话正在运行**（如正在回应插话）：走 steer 排队，turn 边界消费——正确行为，交付消息不会丢
- **主会话未打开**（`target_inactive`）：现状分支保留，交付事实仍由 delivery 标记 + 共享区文件承载，主会话打开后靠 ListLinkedSessions 自愈
- **应用重启**：childStates 内存丢失，语义与现状一致（交付判定靠主会话上下文记忆 + 共享区文件），无新增工作
- **多子会话并发**：交付逐个注入、模型逐个处理，替代 WaitForMessage 的「等任意一个」聚合语义
- **no_delivery 后补交付**：`markChildDelivered` 的单调事实语义（guard 只挡重复标记不挡状态）已有，不变

## 未决问题

- 「等待中」UI 状态的判定源（childStates 快照 vs conversation 派生）与展示形式，实施时定
- 提示词收尾语的具体文案（模型 stop 前对用户说什么），实施时调教
- 提示词过渡期兼容：存量进行中的会话（上下文里已教过 WaitForMessage）升级后模型可能仍想调用该工具——工具已删时会报 unknown tool，需确认模型对失效工具名的容错表现，必要时保留一个「立即返回劝退」的占位工具过渡
