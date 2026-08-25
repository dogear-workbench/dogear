# 会话渲染边界与状态管理重构 实施计划

**目标**：把会话状态拆成 stableHistory + liveTail，流式更新只落在 liveTail，历史部分引用稳定不再参与高频重渲染；修复合并竞态、提升时机、滚动条拖拽等正确性问题；最后以基准数据决定虚拟化去留。

**架构思路**：稳定 ID 由主进程补齐（拦截 harness `appendMessage` 返回的 SessionTreeEntry.id，经 `message_id` 事件回流前端），前端 key 与磁盘 ID 职责分离；transcript 状态留在 AgentChat 组件内（不上全局 Zustand）；先断 UI-only 写回链路再拆状态，避免过渡期没有单一 setMessages 可桥接。前置调研：`docs/plans/2026-08/2026-08-25/chat-render-boundary-state-plan.md`（重构纲领）+ 会话组共享区 `pi-message-pipeline-research.md`（主进程管道调研，执行 step1 前必读）。

**涉及模块**：`electron/main/agents/pi-session/`（pi-session、message-converter、history-adapter、pi-harness-adapter、task-types）、`components/agent-chat/`（types、transformers、turns、AgentChat、MessageItem、ContentBlockItem、MessageMinimap、task-aggregator 及 hooks/*）、`types/electron-api.ts`、`app/page.tsx`（多 tab 挂载）。

## 步骤索引

- [x] [Step 1: 主进程消息级稳定 ID 管道](./step1-main-process-message-id.md) — 拦截 entryId、emit `message_id` 事件、snapshot 附 turnEntryIds、历史侧 user/compact 补 ID
- [x] [Step 2: 前端消息身份与渲染 key 体系](./step2-frontend-identity-keys.md) — key/id 职责分离、定位链（data-message-id / 搜索 / minimap / turnByIndex）迁移、turnId 稳定化
- [x] [Step 3: task summary 派生化](./step3-task-derived-state.md) — 断掉 useTaskListAggregator 写回链路，minimap 复用共享 turns
- [ ] [Step 4: TranscriptState 拆分](./step4-transcript-state.md) — stableHistory/liveTail 数据模型 + 全事件归属表，对外提供兼容合成视图
- [ ] [Step 5: 流事件批处理](./step5-stream-batching.md) — rAF buffer + setTimeout 兜底、终态/交互事件直通、隐藏 tab 降频
- [ ] [Step 6: 合并协议与 live tail 提升](./step6-merge-promote.md) — history/snapshot 到齐合并去重、settled 且无 pendingActions 时提升
- [ ] [Step 7: 渲染边界拆分与滚动修复](./step7-render-scroll.md) — StableHistory/LiveTail 组件、scrollbar 拖拽识别、useVirtualTurns 收窄到历史区
- [ ] [Step 8: 订阅收窄与多 tab 修复](./step8-subscriptions.md) — useTopicArchiveState 窄化、minimap/boundary 的 conversationId 显式传参
- [ ] [Step 9: 基准验证与虚拟化决策](./step9-benchmark.md) — 跑基准场景，决定保留手写虚拟化 / 完整 DOM / 迁移 Virtuoso

## 全局决策

### 稳定 ID 协议（跨 step 1/2/6）

- 唯一权威消息 ID = harness `SessionTreeEntry.id`（uuidv7 随机尾，fork 已依赖，见 `createFork`）。
- 流侧获取路径：`PiSession.start()` 里给 session 对象包一层代理，拦截 `appendMessage` 返回值，`WeakMap<AgentMessage, string>` 记录 message→entryId；`handleAgentEvent` 收到 `message_end` 时查表 emit `message_id` 事件（字段 `{ uuid, role, model?, timestamp }`，timestamp 用 pi-ai message.timestamp 创建时刻而非 emit 时刻）。harness 保证先落盘后 emit，时序安全。
- `message_id` 同时 push 进 `liveTurnMessages`，snapshot 重放时前端同样收到，贴 ID 路径一致。

### key / id 职责分离（step 2 核心）

- `Message.id`：磁盘对齐的稳定 ID。assistant = run 内 entryIds 的最后一个（= 历史 sdkUuid 规则）；user = entryId；本地乐观 push 的消息先用 `local-{crypto.randomUUID()}`，收到 `message_id` 后原地升级。
- React `key`：同一挂载会话内稳定即可，直接用 `message.id`（本地临时 id → 升级会引发该消息一次 remount，仅 user 消息低频发生，可接受；assistant 的 message_id 只覆盖 sdkUuid 不换 key——见 step2 的 key 升级规则）。
- `Message.entryIds?: string[]`：assistant 消息记录 run 内累积的全部 entryId，合并去重用它（历史侧合并消息对应多个 entry，去重键是集合而非单 ID）。

### live 与历史的同构规则

- 前端 streamReducer 把整个 run 的 assistant 内容合成为尾部一条大消息（isStreaming 期间持续吸收 block），与 history-adapter 的「连续 assistant entry 合并成一条、sdkUuid 取最后」天然同构。`message_id` 事件到达时覆盖尾部消息的 sdkUuid/id 并 push entryIds，即自动对齐历史规则。
- tool_result 按toolUseId 并入 tool_use 块：流侧（streamReducer）与历史侧（history-adapter 预扫 toolResult Map）行为一致，toolUseId 是唯一三处稳定键，不动。
- 提升 = 关闭 isStreaming 后 append 到 stableHistory，无需大改形状。

### 事件归属表（step 4 依据）

| 事件 | 归属 |
|---|---|
| text / thinking / tool_use / tool_result / compacting / error / task_notification 等 block 类 | live tail |
| `message_id` | 贴 ID：尾部 assistant（live）或本地 push 的 user（stable 尾部原地升级） |
| `compact_boundary` | 关闭 live assistant → stable append boundary 消息 |
| permission_request / ask_user_question | pendingActions 独立状态 + live tail 挂占位 block（决议后更新 block） |
| 本地乐观 push 的 user | stable append |
| settled / complete 广播 | 触发提升检查（settled 且 pendingActions 空 → promote） |

### 合并协议（step 6 依据）

- attach snapshot 与磁盘历史重叠是必然（harness 逐消息实时落盘，message_end 即落盘）。协议：等 history 与 snapshot 都到齐 → `stableHistory` = 磁盘历史中裁掉「entryIds 与 snapshot.turnEntryIds 有交集」的尾部消息 → liveTail = snapshot 事件流重放。裁剪按消息粒度（消息级 entryIds 数组与 turnEntryIds 交集非空即截断该消息及其后）。
- 本地乐观 push 的 user 消息：收到 `message_id` 后按 ID 与磁盘历史对齐，refetch/重载时同一 ID 不重复。

### 状态位置

- transcript 状态（stableHistory / liveTail / pendingActions）放 AgentChat 组件内的 `useTranscriptState` hook，不上全局 Zustand；`runningConversationIds` 等低频会话元状态留 Zustand。
- 兼容期（step 4-6）：`messages = [...stableHistory, ...liveTail]` 合成视图供 AgentChat 旧渲染逻辑使用，AgentChat 每帧重渲染维持现状，性能收益到 step 7 才兑现。这是刻意的迁移顺序，不是遗漏。

### 顺序调整说明

- 纲领文档里阶段 2（状态拆分）在阶段 3（派生移出）之前；本计划调换为 step 3（task 派生化）先于 step 4（状态拆分），理由：`useTaskListAggregator` 通过 setMessages 写回 messages，若先拆状态则没有单一 setMessages 可桥接，过渡代码更复杂。

### 每步通用验收

- `bun run lint` 通过；涉及渲染层的 step 跑 `bun run build:renderer`（或 `bun run dev` 手动验证）。
- `components/agent-chat/turns.test.ts`：step 2 改动后更新并保持通过；其余 step 保持通过。
- 主进程改动（step 1）需 `bun run build:electron` 后手动验证会话流式输出正常。
- 行为基线：展开/折叠、复制、Fork、权限/AskUser 卡片、搜索跳转、minimap 跳转、compact 折叠，每步完成后抽查不回归。

### 明确不做

- 不把 transcript 搬进全局 conversation-store。
- 不用数组索引做消息或 turn 的长期身份（过渡期 buildTurns 内部下标允许，对外的 Turn 标识必须是稳定 ID）。
- 不修 /compact 遗留缺陷（前端发字面文本，见调研报告 §5）——记录为已知问题，另行处理。
- 不在没有基准数据的情况下引入 react-virtuoso。
