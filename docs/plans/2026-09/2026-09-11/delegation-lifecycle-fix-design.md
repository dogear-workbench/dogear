# 派发-唤醒链路与任务结算修复 设计

**背景**：「事件驱动等待」改造（删除 WaitForMessage 挂起，改为消息注入唤醒）后暴露两个 bug，根因调查报告见共享区 `investigate/delegation-task-review-bug.md`：

1. 任务误判完成：task-queue 仍停留在「一轮 = 一个任务」旧假设，执行会话每派一单就结束回合，第一轮结束即被队列兜底结算成 review（task-queue.ts:257），result 是收尾语截断文本；后续真实申报被「无需重复申报」永久拦截（task-tools.ts:174）。
2. 唤醒链断裂：队列在轮结束后无条件 detach（task-queue.ts:241）→ 引用归零且已 settled → 执行会话销毁（pi-session-manager.ts:161-175）。子会话交付走 `pushToParentSession`（delegation-bridge.ts:761）只认内存中的活 session，找不到即静默丢弃（:374），回执文案「请稍后重试」还会被子会话误读为「系统会自动送达」。UI attach 是唯一存活来源——用户关掉主会话窗口 = 链路断（实测：step1、step6 两次交付丢失）。

**目标**：
- 任务完成只由申报（`dogear__ReportTaskResult` / `<task-result>`）决定；队列不再「判断成功」
- 父会话在存在 running 直属子会话期间必然存活，不依赖 UI 打开
- 父会话意外销毁时，子会话交付/终态仍能送达（自动调起兜底）
- 存活状态对用户可见（会话列表左侧竖线 + 侧边等待动效）

**架构**（核心做法 + 排除的选项及原因）：

1. **完成只走申报，异常走 interrupted**
   - 删除 executeOne 的兜底 completeTask 写回（task-queue.ts:249-259 一带）；review 只能经申报路径产生
   - 轮结束时的队列处置：若「无 running 直属子会话 且 未申报」→ 置 interrupted + 既有申报引导句（REPORT_RESULT_HINT）；interrupted 不堵申报（ALLOWED_TRANSITIONS 允许 interrupted→review 经申报）
   - 保留既有异常兜底：2h 无消息保险丝、forcedRelease、重启恢复 recoverAndStartTaskQueue
   - 排除「队列继续判断成功但修正条件（有 running 子会话则不结算）」：代码无法区分「真完成」和「忘申报」，判断成功的职责彻底交还模型，与「任务与会话解耦（申报制回写）」决策一致

2. **bridge 保活**（排除「要求用户保持窗口打开」）
   - delegation-bridge 以独立于 UI 的 retain/release 管理父会话存活：子会话创建时 acquire，全部直属子会话离开 running（终态）后 release
   - 粒度与 childStates 同生命周期（内存态，重启同失，无需持久化）；pi-session-manager 需暴露非 UI 的 retain 语义（或内部 holder attach）
   - 用户显式停止父会话不与保活冲突：销毁后由兜底调起覆盖

3. **child→parent 自动调起兜底**
   - delegation-tools.ts:112-136 的 target_inactive 分支对称化：目标是我父会话且停机 → rehydrate + resume 拉起父会话 + 注入消息（复用既有 resumeChildAndDeliver 模式，该模式在 parent→stopped-child 方向 2026-09-11 05:34 实战验证正常）
   - 终态通知 notifyTerminalToParent 遇 target_inactive 同样调起而非仅 log 丢弃（delegation-bridge.ts:374）——失败型终态是唯一告警信号，不可丢
   - 排除「离线投递箱（消息落盘、attach 时 flush）」：调起即唤醒即续跑，语义更直接；投递箱引入新存储与 flush 时序问题，YAGNI

4. **存活可视化**
   - 主进程广播存活会话集合（PiSessionManager 内存 Map → renderer-broadcast），conversation-store 维护 aliveSet
   - 会话列表左侧竖线（ConversationRow.tsx:119 一带）承载存活语义：会话存活（含停止态）竖线常亮，等待计数归零且会话空闲/销毁后熄灭
   - 等待交付指示从主聊天流 StreamingIndicator 挪到 MessageMinimap 同位置的侧边区域做动效，不与消息流打架

**模块边界**：
- electron/main/services/scheduler/task-queue.ts（结算逻辑、轮结束处置）
- electron/main/agents/delegation-bridge.ts（保活 acquire/release、终态通知调起）
- electron/main/agents/tools/delegation-tools.ts（SendMessage target_inactive 对称化）
- electron/main/agents/pi-session-manager.ts（非 UI retain 语义）
- stores/conversation-store.ts（aliveSet）
- electron/main/services/renderer-broadcast.ts（存活集合广播）
- components/conversation-list/ConversationRow.tsx（竖线存活态）
- components/agent-chat/AgentChat.tsx + StreamingIndicator（等待动效迁移）

**数据流**：
- 派发：父会话 CreateSession → bridge spawnChild → acquire 父会话 retain → 子会话运行
- 交付：子会话 SendMessage(delivery) → pushToParentSession → 命中活 session 直接注入唤醒；target_inactive → 自动调起父会话再注入
- 终态：子会话 complete → classifyChildCompletion → settleTerminal → 最后一个 running 子会话离场 → release retain（父会话引用归零则自然销毁）
- 完成：执行会话所有 step 收尾后调 ReportTaskResult → review；轮结束未申报且无 running 子会话 → interrupted + 引导

**错误处理 / 边界情况**：
- 应用重启：内存态（bridge childStates、retain、PiSession）全丢，链路确定性断裂——靠既有 recoverAndStartTaskQueue 置 interrupted + 引导兜底，属已知边界
- retain 泄漏：子会话既不终态也不死（极端 hang）→ idle watch（10min 判 hang → stopChild → transient 复活 ≤3 次 → 耗尽终态）保证最终 release；无 idle 事件的进程级异常由重启兜底
- 调起风暴：调起仅由交付/终态/显式 SendMessage 触发，频率受子会话数量约束，无自增强循环
- interrupted 后申报：申报路径允许 interrupted→review，任务可正常进审核
- 「队列轮结束 = interrupted」误伤用户中途借用执行会话闲聊的场景：接受（interrupted 可恢复），宽限期策略列为未决

**未决问题**：
- 轮结束置 interrupted 是否加宽限（短暂 pending-idle 等待申报/唤醒再判）——实施时以最简版先行，观察误伤再调
- 竖线视觉规格（颜色/粗细/动效与 running 橙点、选中态的关系）——实施时出两版对比
- 存活集合广播的粒度（全量 vs 增量 diff）——跟随现有 renderer-broadcast 模式定
