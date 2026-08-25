# Dogear 会话渲染边界与状态管理重构计划

## 目标

在不牺牲历史消息交互能力的前提下，将会话状态和渲染更新拆成稳定历史与当前流式尾部，先降低流式期间的 React、派生计算和布局压力，再决定是否需要继续使用虚拟化或迁移到成熟虚拟列表库。

本计划不预先承诺改成完整 DOM，也不预先承诺引入 Virtuoso。先修正更新边界并建立基准，避免用虚拟化掩盖状态管理和高频更新问题。

## 调研结论

### 已确认的高优先级问题

1. `useSessionMessages` 对每个 IPC 会话消息直接调用 `setMessages`。流式 text/thinking delta 会逐事件复制外层数组并触发 `AgentChat` 重新执行。
2. `useTaskListAggregator` 在 `messages` 变化后重新扫描全部消息并做签名比较：Task* 工具结果变化时会通过 `setMessages` 注入 UI-only 的 `task_summary`，产生第二次消息状态更新；且签名计算本身是每次更新都执行的全表扫描（普通 text/thinking delta 虽不触发写回，扫描仍每帧跑）。
3. `useMessageSearch` 虽然延迟 150ms，但依赖整份 `messages`。搜索打开期间，流式内容仍会触发全历史扫描。
4. `AgentChat` 的 `buildTurns`、compact boundary 查找、搜索跳转依赖和虚拟滚动都依赖整数组引用。即使历史 `Message` 对象本身没有变化，派生链仍会被高频唤醒。
5. 当前 `useVirtualTurns` 还承担可见区计算、测量、占位、强制挂载和部分跳转职责；状态边界未稳定前继续扩展它会放大维护成本。
6. 历史加载与 attach 快照回放存在竞态：`getConversationHistory`（返回后 `setMessages(result.messages)` 非函数式直接替换）与 attach 后的 `applyLiveSnapshot`（函数式叠加）是两条并发 IPC，完成顺序无保证。快照先应用、历史后返回时，正在流式的 turn 会被整段冲掉。
7. `streamReducer` 没有消息级去重：`tool_use` 仅按 `toolUseId` 匹配更新，push 分支无去重键。磁盘历史若已含当前 turn 的部分落盘消息，live snapshot 重放整个 turn 事件流会产生重复渲染。`useSessionMessages` 中「按 sdk_uuid 去重」的注释与实际实现不符——插话不重复的真实机制是「SDK 推送的 user 事件一律不渲染（wechat-bot 除外）」这个副作用。
8. 扁平下标深度耦合渲染与定位：`MessageItem` 的 `key={index}`、`data-message-id="msg-${index}"`、`scrollToMessage` 的 querySelector、搜索 matchId、minimap 回调、`turnByIndex: Map<number, number>` 全部依赖「全局扁平下标」；拆分历史/流式后该概念失效（两段列表各有自己的下标空间），必须整体迁移到稳定 ID。

### 已确认的可复用基础

- `streamReducer` 在普通 text/thinking/tool_result 流式路径上主要只替换最后一个 assistant 消息，历史消息对象引用通常会保留。
- `MessageItem` 使用 `memo`，历史对象引用稳定后具备跳过父级无效更新的基础。
- `childrenForThis`、`failoverNotices` 等 Zustand selector 已按当前 conversationId 做了局部选择，且空数组引用已有缓存，方向正确。
- 会话消息不适合全部搬进全局 Zustand。消息状态应继续靠会话局部状态或专用 transcript store 管理，避免全局 store 更新唤醒无关页面。

## 目标状态结构

```text
TranscriptState
├── stableHistory       已完成、可交互、低频变化
├── liveTail            当前正在生成的 turn，允许高频变化
├── pendingActions      权限 / AskUser 等交互状态
├── structuralVersion   turn、compact、minimap 等结构变化标记
└── sessionMeta         sessionId、running、pendingCount 等低频状态
```

渲染边界：

```text
ChatViewport
├── StableHistory       历史 turn 可展开、可复制、可 Fork、可搜索
└── LiveTail            当前流式 turn 单独更新
```

“分开”只表示更新边界分开，不表示历史消息只读或不渲染。

## 实施阶段

### 阶段 1：建立基准和消息身份

- 为历史消息、turn、content block 梳理稳定身份来源。
- 为真实消息补充稳定 message ID / SDK UUID 归一化策略。
- turn key 不再使用 compact 折叠后重新从 0 编号的临时序号。
- 澄清并固定 `streamReducer` 的去重语义：现注释称「按 sdk_uuid 去重」但实现中不存在该逻辑，插话不重复实际依赖「SDK user 事件一律不渲染（wechat-bot 除外）」的副作用。重构后的去重必须基于显式稳定 ID，不依赖渲染过滤副作用。
- 稳定 message ID 的用途同时覆盖：历史/快照合并去重键、渲染 key、`data-message-id` 跳转定位、搜索 matchId、minimap 回调、`turnByIndex` 映射，即整条「全局扁平下标」定位链的替换。该迁移横跨阶段 2 和阶段 5，作为贯穿任务单独跟踪，避免散落漏改。
- 记录基准指标：流式期间每秒 React 更新次数、`streamReducer` 调用次数、`buildTurns` 调用耗时、搜索扫描耗时、滚动帧率、长任务期间长帧数量。
- 使用 React Profiler 或轻量性能标记，不在生产路径保留高频日志。

涉及文件候选：

- `components/agent-chat/types.ts`
- `components/agent-chat/turns.ts`
- `components/agent-chat/transformers.ts`
- `components/agent-chat/hooks/useMessageHistory.ts`

### 阶段 2：拆分历史与流式消息状态

- 将现有单一 `messages` 状态重构为“稳定历史 + 当前 live tail”的逻辑模型。
- 保持对外兼容的消息访问接口，降低一次性改动范围。
- 定义历史与快照的合并协议：`getConversationHistory`（非函数式直接替换）与 attach 后的 live snapshot 回放是两条并发 IPC，顺序无保证。需等两者到齐再合并渲染，或快照仅在 history loaded 后应用、期间缓冲流事件；合并时按稳定 message ID 去重，覆盖磁盘历史已含当前 turn 部分落盘消息的情况。
- 流事件先进入按 session 隔离的 pending buffer，再按 `requestAnimationFrame` 或固定短批次合并提交，避免每个 delta 单独触发 React 更新。批处理需含 `setTimeout` 兜底：Electron 窗口最小化/隐藏时 rAF 停止，buffer 会无限积压。
- 终态与交互事件（result、permission_request、ask_user_question）绕过缓冲立即提交；旁路状态与 buffer 保持一致——现状 `result → setIsLoading(false)` 不走 `setMessages`，批处理后会出现 isLoading 已置位而 result 消息仍在 buffer 的错位，影响 StreamingIndicator 与 followMode 切换。
- 普通 text/thinking delta 只更新 live tail 对象及其最后一个 content block。
- 事件完成、compact boundary、用户插话、权限和 AskUser 事件要明确归属：更新 live tail、结束 live tail 或追加新的稳定消息。
- live tail 的终结条件是 settled/complete 且无 pending action，不是单个 result 事件：现有 `useSessionEvents` 中权限请求和 AskUser 可能在 result 之后到达并继续往尾部追加 block，甚至新建 `isStreaming: true` 的 assistant 消息；提升判定必须覆盖这条路径，否则权限卡片会打破历史边界。
- 流结束时将 live tail 一次性提升为 stable history，使用稳定 key，避免重复挂载和重复消息。
- `pendingActions` 覆盖两条来源路径：`rendererEvents` 实时事件与 live snapshot 回放（`applyLiveSnapshot` 构造的 permission_request 事件），响应后的 UI 恢复行为保持现状。
- 保留插话不重复渲染、tool_use/tool_result 关联、权限请求和 AskUser 的现有行为；去重实现改为基于稳定 ID 的显式比较。

涉及文件候选：

- `components/agent-chat/hooks/useSessionMessages.ts`
- `components/agent-chat/hooks/useMessageHistory.ts`
- `components/agent-chat/hooks/useAgentSession.ts`
- `components/agent-chat/AgentChat.tsx`
- `components/agent-chat/transformers.ts`
- `components/agent-chat/hooks/useSessionEvents.ts`
- `components/agent-chat/hooks/useSendMessage.ts`

### 阶段 3：把 UI-only 派生状态移出消息写回链路

- 移除 `useTaskListAggregator` 对 `messages` 的二次 `setMessages` 写回。
- 将 TaskCreate/TaskUpdate 聚合结果作为派生数据或独立 live task state 传给渲染层。
- 只有真实事件改变任务内容时才更新任务派生状态，不重新复制整份历史消息。
- 搜索建立稳定历史索引：历史内容只在历史结构变化时重建；流式期间只增量检查 live tail。
- minimap、turn map、compact boundary 等结构派生只依赖结构快照，不依赖每个 token 的正文变化。
- 对 `messages.map` 类更新保留未修改对象引用，必要时按 message ID 直接定位目标，而不是扫描后重建整表。

涉及文件候选：

- `components/agent-chat/hooks/useTaskListAggregator.ts`
- `components/agent-chat/task-aggregator.ts`
- `components/agent-chat/hooks/useMessageSearch.ts`
- `components/agent-chat/MessageMinimap.tsx`
- `components/agent-chat/turns.ts`
- `components/agent-chat/AgentChat.tsx`

### 阶段 4：收窄 Zustand 订阅边界

- 不把高频 transcript delta 放入现有 `conversation-store`，避免左侧列表、Tab 和其他页面被消息流唤醒。
- 检查 `AgentChat` 顶层 selector，尽量只订阅当前 conversation 所需的标量或稳定对象引用。
- `useTopicArchiveState` 当前订阅整个 `groups` 数组并把它放入异步解析 effect 依赖，改为只订阅当前 conversation 对应 group 的必要字段或稳定版本号。
- `MessageItem` / `ContentBlockItem` 内部对 settings、selectedConversation 的订阅保持局部化；能从父级传入稳定 conversationId 的地方不重复订阅全局 store。
- `runningConversationIds`、`pendingActionConversationIds`、子会话快照等低频状态继续留在 Zustand，但确保 selector 不返回无关的整张 Map/Record。
- 检查 actions 是否因 hook 参数数组变化而频繁重建，必要时使用 ref 读取最新数据，避免把完整 `messages` 放进高频 callback 依赖。

涉及文件候选：

- `components/agent-chat/AgentChat.tsx`
- `components/agent-chat/hooks/useTopicArchiveState.ts`
- `components/agent-chat/hooks/useAgentSession.ts`
- `components/agent-chat/hooks/useSendMessage.ts`
- `components/agent-chat/ContentBlockItem.tsx`
- `components/agent-chat/MessageItem.tsx`
- `stores/conversation-store.ts`

### 阶段 5：重做渲染和滚动边界

- 抽出 `StableHistory` 与 `LiveTail` 组件，历史区使用稳定 props 和 `memo`，当前流式区单独更新。
- 历史消息的展开、复制、Fork、权限卡片和 AskUser 交互保持不变。
- 先修复手动滚动时退出 auto-follow 的逻辑，原生滚动条拖拽必须被识别为用户操作。
- `useChatScroll` 只负责 auto/manual、程序跳转和会话位置恢复；续滚 ResizeObserver 保持仅在 auto 模式写 `scrollTop`，配合滚动条拖拽识别后不再与用户滚动竞争。
- 拆分 DOM 结构时保持滚动容器的直接内容包裹节点：`useChatScroll` 的续滚 ResizeObserver 监听 `vp.firstElementChild`（现为 `<div className="px-6">`），StableHistory/LiveTail 需作为该包裹节点的子树，否则续滚静默失效。
- 对当前可见内容建立滚动锚点，历史高度变化和缩放测量时保持锚点稳定。
- 修正或替换 `useVirtualTurns` 的稳定 key 和测量策略；不在状态边界未稳定前继续叠加复杂补丁。

涉及文件候选：

- `components/agent-chat/AgentChat.tsx`
- `components/agent-chat/hooks/useChatScroll.ts`
- `components/agent-chat/hooks/useVirtualTurns.ts`
- `components/agent-chat/MessageItem.tsx`
- `src/globals.css`

### 阶段 6：基准验证后决定是否保留或替换虚拟化

先用阶段 2 至 5 的实现测试完整 DOM 和当前虚拟化两种模式。

验证场景：

- 50、100、300 轮普通对话
- 长 Markdown 和长代码块
- 大量工具调用与工具结果
- Thinking 折叠/展开
- 历史工具块展开后继续流式输出
- 流式期间向上滚动和拖动原生滚动条
- 快速滚动、滚动到搜索结果、minimap 跳转
- compact 折叠/展开
- 浏览器缩放和窗口宽度变化
- 图片或异步内容加载后高度变化
- 权限请求与 AskUser 卡片交互

决策标准：

- 若完整 DOM + 稳定历史/流式边界已经满足帧率和长帧目标，保留 Proma 风格方案。
- 若主要瓶颈仍然是历史 DOM 的 layout/paint，迁移到 `react-virtuoso`，按稳定 turn ID 虚拟化。
- 若迁移 Virtuoso，删除重复的手写可见区计算和抢写 `scrollTop` 逻辑，不叠加两套 virtualizer。

## 明确不做

- 不把整个消息 transcript 搬进全局 `conversation-store`。
- 不用数组索引作为消息或 turn 的长期身份。
- 不在每个流事件后扫描和重建全部历史派生数据。
- 不让 task_summary 这类 UI-only 数据反向修改主消息数组。
- 不在没有性能基准的情况下直接引入虚拟列表库或继续扩大当前手写虚拟化复杂度。
- 不改变历史消息已有的展开、复制、Fork、权限和 AskUser 功能。

## 完成标准

- 流式 delta 可以合并提交，历史消息不因每个 token 重复参与重渲染。
- StableHistory 的历史对象和组件 props 在流式期间保持稳定。
- task summary、搜索、minimap、turn map 不再通过整份消息数组高频重算。
- 原生滚动条拖拽不会被自动跟随拉回。
- 切换到正在流式输出的会话（含 agent 派出的子会话）不丢消息、不重复渲染：合并协议有验证场景覆盖。
- 权限/AskUser 卡片晚于 result 到达时仍落在 live tail，不破坏已提升的历史边界。
- 窗口最小化期间流式输出，恢复前台后消息完整、无一次性积压后的卡顿。
- 动态高度、缩放、展开折叠和图片加载不会造成明显跳位或白板。
- 现有 `turns.test.ts` 继续通过，并补充消息 reducer、稳定 ID、任务派生和流式批处理测试。
- 完成 renderer build，并使用真实长会话进行手动性能验收。
