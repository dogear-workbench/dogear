# 轮次级虚拟滚动 + 输入框隔离 设计

## 背景

长会话场景下（几十轮对话后），渲染层出现明显卡顿，包括：
- 滚动卡顿
- 输入框打字卡顿（每个字符都触发全组件树 reconciliation）
- 流式输出时全量重渲染（每来一个 token，所有 MessageItem 都重新 render）

根因：
1. **全量 DOM 渲染**：所有历史消息（可能上百条）全部挂载为真实 DOM，每条 AI 消息内多个 ContentBlockItem + MarkdownRenderer（ReactMarkdown + remarkGfm + rehypeHighlight 语法高亮），DOM 节点可达上千
2. **MessageItem 没有 React.memo**：流式更新时 `streamReducer` 浅拷贝整个 `messages[]` 数组，所有 MessageItem 跟着重渲染
3. **ChatInputArea 与消息列表同树**：messages 变化触发 AgentChat 重渲染，ChatInputArea 跟着重渲染，输入卡顿
4. **流式高频 setMessages**：每个 token 触发一次 state 更新 + 全量重渲染

## 目标

- 超长会话（几百轮）也不卡：滚动流畅、输入不卡、流式输出不触发历史消息重渲染
- DOM 节点数量恒定（可视区域内的轮次 + 缓冲），与总会话长度无关
- 对现有交互（搜索跳转、Minimap、sticky 吸顶、compact 折叠、自动跟随）影响最小

## 架构

### 核心做法：轮次级虚拟滚动

以 `buildTurns` 产出的 Turn 为最小渲染单元（一个用户提问 + AI 回复 = 一轮），而非逐条消息。

```
messages[]
  → buildTurns() 切分成 turns[]              （现有逻辑不变）
  → 虚拟化渲染层分配 "渲染 or 占位"
     ├─ 可视区域内 + 上下各 1 轮缓冲 → 渲染真实 MessageItem
     └─ 范围外的轮次 → <div style={{ height: 缓存高度 }} /> 占位撑高度
  → 滚动事件 → 重新计算范围 → 增删轮次 → 更新 DOM
```

### 高度缓存策略

缓存数据结构：`Map<turnId, number>`（turnId → 真实像素高度）

- **首次渲染某轮**：无缓存，用预估高度（~400px/轮）撑占位 → 渲染后用 `useLayoutEffect` / `ResizeObserver` 测量真实高度 → 写入缓存
- **后续滚动经过**：直接用缓存高度，不重新测量
- **流式输出的最后一轮**：高度持续变化，每次更新覆盖缓存值（不跳）
- **compact_boundary 折叠/展开**：清空折叠区域之前所有轮次的缓存，重新预估
- **会话切换**：不需要额外处理。每个 tab 是独立 `AgentChat` 实例（`display: none` 隐藏），`useVirtualTurns` 的 hook state 天然保留，切回来缓存还在

### 首次加载历史优化

加载历史后先跳到底部（现有行为），顺势渲染最后几轮、测量高度、建立缓存。从后往前逐轮缓存，而非从第一轮预估。最新的几轮高度最先确定，用户加载完第一时间看到的就是底部。

## 模块边界

### 新增

- `components/agent-chat/hooks/useVirtualTurns.ts` — 虚拟化调度 hook
  - 输入：`turns[]`（BuildTurnsResult）、滚动容器 ref
  - 输出：`{ visibleTurnIds: Set<number>, turnHeights: Map<number, number> }`
  - 内部管理：高度缓存、可视范围计算、滚动位置监听

### 改动

- `components/agent-chat/AgentChat.tsx`
  - 渲染逻辑从 `turns.map(turn => renderMessage(...))` 改为：可视范围内的轮次渲染真实 MessageItem，范围外渲染占位 div
  - 接入 `useVirtualTurns`，ScrollArea 的 onScroll 接入滚动监听
  - ChatInputArea 拆出独立渲染边界（React.memo 或独立组件隔离），避免 messages 变化触发输入框重渲染

- `components/agent-chat/MessageItem.tsx`
  - 加 `React.memo`，浅比较 message 对象引用（streamReducer 已保证不变的消息引用不变）
  - props 中的回调用 useCallback 稳定引用

- `components/agent-chat/hooks/useChatScroll.ts`
  - `scrollToMessage` 适配：目标轮次可能未渲染，先加入渲染范围 → requestAnimationFrame 等挂载 → 用缓存累计高度算偏移 → scrollTo
  - 自动跟随到底部：流式输出最后一轮进入可视范围时正常跟随

### 不动

- `buildTurns`（turns.ts）— 切分逻辑不变
- `streamReducer`（transformers.ts）— 消息更新逻辑不变
- `useMessageHistory` — 历史加载不变
- 后端 / IPC 层 — 全部不变
- `useSessionMessages` — 消息流监听不变

## 数据流

```
正常渲染：
  messages[] → buildTurns → turns[]
    → useVirtualTurns(turns, scrollRef)
       监听 scroll 事件，用 turnHeights 缓存算出可视范围
       输出 visibleTurnIds: Set<number>
    → AgentChat.map(turns):
       turn.id ∈ visibleTurnIds → <TurnBlock> 渲染真实 MessageItem
       turn.id ∉ visibleTurnIds → <div style={{height: cache}} />  占位

流式输出（最后一轮）：
  后端推 token → streamReducer 更新 messages[]
    → buildTurns 重新切分（最后一轮的 memberIdxs 可能增长）
    → 最后一轮在 visibleTurnIds 内（因为在底部，可视区域）
    → MessageItem 正常渲染，memo 保证历史轮次不重渲染

搜索跳转：
  用户搜索命中第 N 条消息
    → 找到该消息所属的 turnId
    → 如果该 turn 不在 visibleTurnIds → 强制加入渲染范围
    → requestAnimationFrame 等 DOM 挂载
    → 用缓存的累计高度算精确偏移量 → scrollTo
    → 如果该 turn 是首次渲染（高度为预估值），挂载后测量校正一次
```

## 错误处理 / 边界情况

1. **display:none 下的高度测量**：tab 切换时 `display: none` 的 AgentChat 实例，`useVirtualTurns` 的 hook state 保留（React 不卸载）。切回来时 ScrollArea 的 scrollTop 和 offsetHeight 由浏览器保留，验证是否需要主动触发一次重算
2. **轮次内消息高度突变**：用户手动展开/收起 sticky 消息、展开 thinking block 等，该轮高度变化。ResizeObserver 监听每轮容器的 resize 事件，自动更新缓存
3. **compact_boundary 折叠/展开**：展开时折叠区域的轮次从"不渲染"变为"虚拟化渲染"，清空这些轮次的高度缓存（可能已过期），重新预估
4. **Minimap 联动**：Minimap 视口指示器反映当前 visibleTurnIds 范围。点击跳转复用搜索跳转逻辑
5. **预估高度偏差**：首次经过某轮时会有一次高度校正（预估 → 真实），可能导致轻微跳动。由于缓冲轮的存在（上下各 1 轮），用户正常滚动速度下感知不到

## 未决问题（留给实施时补）

- 预估高度的具体默认值（400px 是初步估算，实施时按实际数据调整）
- 滚动事件 throttle / rAF 节流的频率（太频繁影响性能，太慢滚动时会出现空白）
- ResizeObserver 的性能开销（如果每轮都挂 observer 是否过重，可能改为渲染时一次性测量 + 关键交互后重测）
- 独立会话窗口（`session-window/page.tsx`）也使用 AgentChat，需验证虚拟滚动在独立窗口中同样生效
