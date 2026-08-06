---
step: 2
title: useVirtualTurns 虚拟滚动调度
status: done
---

## 目标

新建 `useVirtualTurns` hook，实现轮次级虚拟滚动的核心调度：监听滚动位置，用高度缓存算出可视范围，输出"哪些轮次渲染、哪些占位"。接入 AgentChat 替换现有的全量渲染。

## 依赖上下文（接力棒输入）

- 前置 step 产出：MessageItem 已 React.memo（step 1），props 引用稳定
- 关键文件状态：
  - `components/agent-chat/turns.ts` — `buildTurns(messages, { collapsed })` 返回 `{ turns: Turn[], turnByIndex }`，Turn 有 `turnId` / `headerIdx` / `memberIdxs[]`
  - `components/agent-chat/AgentChat.tsx:~230` — 现有渲染逻辑：`turns.map(turn => turn.memberIdxs.map(i => renderMessage(messages[i], i)))`，全量渲染所有轮次
  - `components/agent-chat/AgentChat.tsx:~165` — `scrollAreaRef` 是 ScrollArea 的 ref
- 关键决策回顾：
  - 缓冲范围 = 可视区域 + 上下各 1 轮
  - 预估高度默认 400px/轮
  - 占位用空 div 撑高度

## 计划改动

### 1. 新建 useVirtualTurns hook

- `components/agent-chat/hooks/useVirtualTurns.ts`

  **接口**：
  ```ts
  interface UseVirtualTurnsParams {
    turns: Turn[];
    scrollContainerRef: React.RefObject<HTMLElement>;
    estimateTurnHeight?: number; // 默认 400
  }

  interface UseVirtualTurnsResult {
    /** 需要真实渲染的 turnId 集合 */
    visibleTurnIds: Set<number>;
    /** turnId → px 高度缓存（含已测量的真实值和预估值） */
    turnHeights: Map<number, number>;
    /** 注册某轮 DOM 节点用于测量高度 */
    registerTurnElement: (turnId: number, el: HTMLElement | null) => void;
    /** 强制将某轮加入可见范围（搜索跳转用） */
    ensureTurnVisible: (turnId: number) => void;
  }
  ```

  **内部逻辑**：
  - `turnHeights` 用 `useState<Map>` 持久化（或 useRef + 手动触发更新）
  - 监听 scrollContainer 的 scroll 事件（rAF 节流）
  - 每次滚动：读 scrollTop + clientHeight，遍历 turns 累加 turnHeights 算出哪些轮落在 [scrollTop - bufferSize, scrollTop + clientHeight + bufferSize] 范围内
  - `registerTurnElement`：收到真实 DOM 后用 `getBoundingClientRect().height` 测量，写入缓存（如果与当前值不同则更新 state）
  - 首次加载时无缓存，所有轮用预估高度

  **渲染时序**：
  - 初始：所有轮预估高度 → 算出 visible 范围 → 渲染可见轮
  - 可见轮挂载 → registerTurnElement 测量 → 更新 turnHeights → 可能微调 visible 范围
  - 滚动 → 重算范围 → 新进入的轮渲染 + 测量，离开的轮卸载

### 2. AgentChat 接入虚拟滚动

- `components/agent-chat/AgentChat.tsx`

  **改动渲染逻辑**（`{(() => { ... })()}` IIFE 块）：
  ```
  const { visibleTurnIds, turnHeights, registerTurnElement } = useVirtualTurns({
    turns: turnsFromBuildTurns,
    scrollContainerRef: scrollAreaRef,
  });

  turns.map(turn => {
    if (visibleTurnIds.has(turn.turnId)) {
      return (
        <section ref={el => registerTurnElement(turn.turnId, el)} key={turn.turnId}>
          {turn.memberIdxs.map(i => renderMessage(messages[i], i))}
        </section>
      );
    } else {
      return (
        <div key={turn.turnId} style={{ height: turnHeights.get(turn.turnId) ?? estimateHeight }} />
      );
    }
  })
  ```

  **collapsed 适配**：
  - compact_boundary 折叠时，折叠区域的轮次本来就不渲染（`buildTurns` 的 `hiddenUntilIdx` 过滤了），折叠 banner 的高度是固定的，不进虚拟化
  - 展开时折叠区域的轮次重新进入 turns[]，高度缓存可能过期，需要清空

  **首次加载历史**：
  - 加载完历史后 scrollToBottom（现有逻辑），此时底部轮次进入可视范围 → 渲染 → 测量 → 建立缓存

### 3. 高度缓存生命周期

- 会话切换（conversationId 变化）：不需要清空（每个 tab 独立实例，display:none 保留 state）
- compact_boundary 折叠/展开：清空展开区域的轮次缓存
- 流式输出最后一轮：每次 token 更新该轮高度（通过 ResizeObserver 或 useLayoutEffect 测量）

## 实施回填（做完后填）

### 实际改动
- 改动文件清单（2 个文件）：
  1. `components/agent-chat/hooks/useVirtualTurns.ts`（新建）— 轮次级虚拟滚动调度 hook
  2. `components/agent-chat/AgentChat.tsx`（修改）— buildTurns 提升到 useMemo，渲染逻辑改为可见轮 section + 不可见轮占位 div
- 与计划差异：
  1. 缓冲范围从「上下各 1 轮」改为「上下各 1 屏（clientHeight）」，按轮缓冲在高频滚动时可能空白闪烁
  2. 额外提供 `getTurnRef`（缓存的 ref callback），避免每次渲染产生新引用导致无谓 detach/attach
  3. buildTurns 从 IIFE 提升到 useMemo（hooks 必须在组件顶层调用）

### 给下一步的接力棒
- `useVirtualTurns` 返回值签名：`{ visibleTurnIds: Set<number>, turnHeights: Map<number, number>, getTurnRef, registerTurnElement, ensureTurnVisible }`
- `registerTurnElement` 的调用方式：通过 `getTurnRef(turnId)` 返回缓存的 ref callback，传给 `<section ref={...}>`
- `ensureTurnVisible` 的调用方式：`ensureTurnVisible(turnId)` 将该轮强制加入 visibleTurnIds，下一帧自动释放；step3 需在 AgentChat 中解构并在 scrollToMessage / Minimap 跳转 / 搜索跳转前调用
- 下个 step 该从哪里继续：`useChatScroll.scrollToMessage` 需要先调 `ensureTurnVisible(turnId)` 强制渲染目标轮，等下一帧 DOM 出现后再 scrollTo；Minimap 点击跳转同理；可通过 buildTurns 的 `turnByIndex` 从 messageIndex 查到 turnId
