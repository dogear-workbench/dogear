# 虚拟滚动流式闪烁修复 实施计划

**目标**：消除 agent 流式输出时虚拟滚动导致的画面上下跳动和闪烁，恢复到无虚拟滚动时的流畅度。

**架构思路**：在 `useVirtualTurns` 的 turns effect 中加入守卫——当 turns 变化仅是最后一轮 `memberIdxs` 增长（流式追加消息），而非新增/删除 turnId 时，跳过 `dirtyRef` 和 `setTurnHeights`。这样流式期间占位高度完全静止，续滚退化为 `useChatScroll` 单链路行为，消除两条 ResizeObserver 链路的竞争。

**涉及模块**：
- `components/agent-chat/hooks/useVirtualTurns.ts` — 唯一改动文件

## 步骤索引

- [x] [Step 1: turns effect turnId 守卫](./step1-turnid-guard.md) — 流式追加不触发 setTurnHeights
- [x] [Step 2: measureElement 跳过最后一轮](./step2-skip-last-turn-measure.md) — 最后一轮高度更新不触发全局重渲染

## 全局决策

- 「最后一轮」= `turns[turns.length - 1]`，即 turnId 最大的那一轮
- 守卫判断依据：比较前后两次 turns 的 turnId 集合是否一致（不含新增也不含删除 → 纯流式追加 → 守卫生效）
- `recompute()` 本身不受影响——它由 scroll 事件和 viewport resize 驱动，不依赖 turns effect
- `useChatScroll` 不需要改动——续滚逻辑原本就独立于 `setTurnHeights`
