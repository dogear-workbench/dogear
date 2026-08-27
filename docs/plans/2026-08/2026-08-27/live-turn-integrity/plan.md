# 运行中 turn 完整性（sticky 吸顶 + 重放丢 user header）实施计划

**目标**：消除「正在运行的 turn 被状态层劈成两半」——修复运行中用户消息不吸顶、外部启动会话运行中查看时 user 消息整条不显示两个 bug。

**架构思路**：统一 user 消息写入语义为「运行中 turn（含 user header）完整留在 live，turn 结束 promoteCore 整体提升进 stable」，渲染侧 LiveTail 补齐与历史区一致的 `<section class="agent-turn">` 包裹（sticky 包含块）；重放路径在纯函数 `mergeHistorySnapshotCore` 内从磁盘切掉段捞回 user 消息并按 entryId 锚点归位。全部改动在前端渲染层/状态层纯函数，**不动主进程**（无需 build:electron）。

**涉及模块**：
- `components/agent-chat/hooks/useTranscriptState.ts`（状态层核心）
- `components/agent-chat/LiveTail.tsx`（流式区渲染）
- `components/agent-chat/hooks/useTranscriptState.test.ts`（纯函数单测）

## 步骤索引

- [x] [Step 1: user 消息写入路径统一进 live](./step1-user-write-live.md) — 改 `pushLocalUserCore` 两分支 + `applyEventToCore` user 分支 target，修 sticky 劈分与 wechat-bot 重放丢弃
- [ ] [Step 2: 重放捞回 user header](./step2-replay-user-header.md) — `mergeHistorySnapshotCore` 从磁盘切掉段捞回 user 消息，entryId 锚点归位
- [ ] [Step 3: LiveTurn 包 agent-turn + 回归验证](./step3-livetail-section.md) — 渲染侧恢复 sticky 吸附范围，全量回归

## 全局决策

- **语义约定**：`stable` = 已完成 turn；`live` = 运行中 turn（含 user header）。渲染边界 = turn 边界。
- **`agent-turn` class 无任何 CSS 定义**（已核实），是纯结构标记，作用是充当 sticky 元素的包含块（CSS sticky 吸附范围 = 包含块范围）。
- **`message_id`(user) 分支的「先 live 后 stable」fallback 保留不动**（`applyEventToCore`）：兼容 promote 先于 message_id 到达的异常时序。
- **不改 minimap 数据源**：运行中 turn 不进 minimap。现状 live 的 assistant 本来就不在 minimap，只是那条孤立 user turn 会消失，属可接受行为变化。
- **`insertLocalBlockCore` / `appendPendingBlockCore` 的「live 空看 stable 尾」逻辑不动**：live 空 = 无运行中 turn，语义仍成立；空闲发送后 live=[user, 占位 assistant] 非空，权限块走 live 分支与原行为一致。
- **turnEntryIds 生命周期 = 一次完整 run（含所有插话消费）**：`pi-session.ts:767` handleSettled 清空、`:874` 空闲发送清空。因此磁盘切掉段可能存在 user/assistant 交错，Step 2 必须锚点定位插入，不能全放开头。
- **`structureSignature` 注释需同步更新**（「写入口只动 stable 尾部」的描述在 Step 1 后不再完整成立，pushLocalUser 改为只动 live）。
- 已知次要问题不在本次范围：`handleSend` 中自动标题条件 `getMessages().length === 0` 在 push 之后恒 false（既有 bug，与本次改动无关，不动）。

## 根因摘要（供 step 文档引用）

- sticky 失效机理（已 Electron 实证）：`pushLocalUserCore` 在 live 为空时把 user 消息 push 进 stable 尾部 → StableHistory 按 buildTurns 把它渲染成只含一条消息的矮 `section.agent-turn`（StableHistory.tsx:59）→ 流式回复在 LiveTail 裸渲染（LiveTail.tsx:58，无 section）→ user 消息的 sticky 包含块高度塌缩为 0，回复超一屏后直接滚出视口。
- 重放丢失机理：`mergeHistorySnapshotCore` 用 `findHistoryOverlapIndex` 把磁盘历史尾部（运行中 turn 已落盘部分，含 user 消息）整体切掉；事件快照里 user 消息只有 `message_id`(role:user) 事件（convertPiEvent 不产 type:'user'，message_end 时 push 的是 idMessage），reducer 对它只做「升级本地乐观消息 id」不会新建 → 两头都拿不到，user 消息整条消失。turn 结束 loadHistory 全量重载自愈，故只在运行中窗口期丢。wechat-bot 消息重放时进 `next.stable` 被 `withChanges(next, stable, …)` 整体丢弃，同丢。
