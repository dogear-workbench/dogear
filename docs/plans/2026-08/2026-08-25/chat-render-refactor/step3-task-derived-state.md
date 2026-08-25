---
step: 3
title: task summary 派生化
status: done
---

## 目标

移除 `useTaskListAggregator` 对 messages 的二次 setMessages 写回，task 清单改为纯派生数据直接渲染；minimap 复用 AgentChat 已算好的 turns，消除重复 buildTurns。

## 依赖上下文（接力棒输入）

- 前置 step：[step2-frontend-identity-keys.md] 消息已有稳定 id，turns 结构为 `{ turnId: string, headerId, memberIds }` 形态。
- 关键现状（已核实）：
  - `components/agent-chat/hooks/useTaskListAggregator.ts`：messages 变化 → 全表扫描做签名 → 变化时 `setMessages(injectTaskSummary(messages))`。
  - `components/agent-chat/task-aggregator.ts`：`aggregateTasks(messages)` 纯函数已有；`injectTaskSummary` 把 `task_summary` 虚拟块吸附到最后一条含 Task* 的 assistant 消息，且保证唯一吸附点。
  - 渲染端 `ContentBlockItem.tsx` case 'task_summary' → TodoListBlock。
  - `MessageMinimap.tsx` useMemo 内部又跑一遍 buildTurns（依赖整份 messages）。
  - `AgentChat.tsx` 顶部已算 `chatTurns`（含 collapsed 状态），minimap 未复用。

## 计划改动

- [ ] 删除 `hooks/useTaskListAggregator.ts` 与 `AgentChat.tsx` 中的调用点。
- [ ] `task-aggregator.ts`：保留 `aggregateTasks`（微调：入参不变，内部跳过 task_summary 块的判断可删——没有注入就没有该类型）；删除 `injectTaskSummary`。
- [ ] `types.ts`：ContentBlock type 联合删 `'task_summary'` 与 `tasks?` 字段（虚拟类型不再存在）。
- [ ] `ContentBlockItem.tsx`：删 case 'task_summary'。
- [ ] 新增渲染位置：AgentChat 在消息列表尾部渲染 `<TaskSummaryCard tasks={...}/>`？——**位置对齐现有行为**：吸附点是「最后一条含 Task* 的 assistant 消息之后」。实现：AgentChat 里 `const tasks = useMemo(() => aggregateTasks(messages), [messages])`（messages 引用每帧变，扫描仍每帧跑——这是过渡期妥协，step 4 拆分后改为依赖 stableHistory 结构快照 + liveTail 结构变化，见该 step）；插入位置 `lastTaskMessageId = useMemo(...)` 找最后含 Task* tool_use 块的消息 id，渲染循环里在该消息后插 `<TodoListBlock todos={...}>`（用 message.id 定位，不动消息数组）。
  - 行为差异说明：现状 task_summary 是消息内 block（滚在消息流里），派生方案是渲染期插入，视觉效果等价（同一位置同一组件）。
  - 若该消息在折叠区（collapsed 时最后 boundary 之前）：现状注入块随消息一起被隐藏 → 派生方案同样跳过（lastTaskMessageId 不在可见 turns 的 memberIds 中则不渲染）。
- [ ] `MessageMinimap.tsx`：props 改为接收 `turns`（AgentChat 传 chatTurns + messages 查询句柄），删除内部 buildTurns。预览文案抽取仍需按 memberIds 查消息——AgentChat 一并传 `messagesById: Map<string, Message>`（useMemo 随 chatTurns 一起算）。
- [ ] `useMessageSearch.ts`：删除 task_summary 跳过逻辑（若有）——它只搜 text/thinking，本来就不搜 task_summary，确认无引用即可。

## 验证

- `bun run build:renderer` 通过。
- 手动：跑一段含 TaskCreate/TaskUpdate 的会话，任务卡片在流式期间实时更新、位置吸附正确；TaskCreate 全回滚后卡片消失；compact 折叠后卡片随隐藏区隐藏；无任务会话无渲染残留。
- 性能观察（非正式基准）：流式期间 React DevTools Profiler 确认不再出现二次 setMessages 波形。

## 实施回填

### 实际改动
- 改动 7 文件 +1 删除（+90/-186）：删除 hooks/useTaskListAggregator.ts（二次 setMessages 写回链路彻底移除）；task-aggregator.ts 删 injectTaskSummary（aggregateTasks 原样保留）；types.ts 删 'task_summary' 联合与 tasks? 字段；ContentBlockItem.tsx 删 case；AgentChat.tsx 新增纯派生（tasks/taskTodos/lastTaskMessageId/showTaskSummary/messagesById）+ 渲染循环 Fragment 内吸附消息后插 TodoListBlock（折叠隐藏区由 byMessageId 判定自动跳过）；MessageMinimap.tsx 改收 turns + messagesById 删内部 buildTurns；docs/codebase-map.md 同步三行过时描述。
- 与计划差异：
  1. 卡片位于吸附消息 footer 之后（渲染期插入 vs 旧行为在 footer 之前的 block 列表末尾），同组件同吸附消息，视觉等效；实测观感受影响可在 MessageItem 内插 slot，未做。
  2. aggregateTasks 本无 task_summary 跳过判断，无需删。
  3. 计划外附带收益：MessageMinimap 删除 useConversationStore/useCompactCollapseStore 全局订阅（改收 AgentChat 的 chatTurns），顺带修复 step2 交接记录的多 tab 折叠态不一致存量问题——注意 step8 计划里 minimap 相关项需重新评估剩余范围（boundary 组件与 useTopicArchiveState 仍待做）。
- 验证：build:renderer ✓ / lint 0 errors ✓ / turns.test.ts 11 pass ✓ / tsc 无新增错误；useTaskListAggregator/injectTaskSummary 全仓零残留。手工 GUI 验证（流式任务卡片实时更新/吸附/回滚消失/折叠隐藏/Profiler 无二次 setMessages 波形）待人工补验。

### 给下一步的接力棒
- aggregateTasks 唯一调用点：AgentChat.tsx `useMemo(() => aggregateTasks(messages), [messages])`；taskTodos 映射 {content: subject, activeForm: activeForm||subject, status}；lastTaskMessageId 逆序找最后含 TaskCreate/TaskUpdate tool_use 块的 assistant 消息（`msg.id ?? idx-${i}`）。
- 派生输入（step 4 改依赖 [stableHistory, structuralVersion] 的铺nite）：aggregateTasks 与 lastTaskMessageId 都只消费 assistant 消息的 tool_use 块结构（text/thinking delta 不影响结果）→ 纯 delta 帧可跳过重算；messagesById（minimap 查询句柄，key = `id ?? idx-i`）也随 messages 每帧重建，step 4 后随结构快照重建；showTaskSummary 还依赖 byMessageId（折叠态）→ derived 输入 = 消息结构 + 折叠状态，不依赖内容 delta。
- 待办或已知限制：
  - 每帧全表扫描（aggregateTasks + 逆序扫 + Map 重建）流式期间仍跑，step 4 structuralVersion 落地后消除（刻意的迁移顺序）。
  - TaskState 接口未导出，AgentChat 用解构映射；step 4 挪派生逻辑进 transcript 层时可顺手导出。
  - MessageMinimap 的 props 契约变更为 { turns, messagesById, hidden, scrollAreaRef, onJumpToMessage }，无全局订阅。
