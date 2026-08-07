---
step: 1
title: turns effect turnId 守卫
status: done
---

## 目标

流式输出时，消息持续追加到最后一轮的 `memberIdxs`，但不产生新 turnId。当前 turns effect 每次都设 `dirtyRef = true` → `setTurnHeights(new Map(...))` → 全量重渲染。加入守卫：只有 turnId 集合真正变化（新增或删除轮次）时才设 dirtyRef。

## 依赖上下文（接力棒输入）

- 关键文件：`components/agent-chat/hooks/useVirtualTurns.ts`
- turns effect 当前代码（`:108-125`）：

```typescript
useEffect(() => {
  const cache = heightCacheRef.current;
  const validIds = new Set(turns.map((t) => t.turnId));

  for (const turn of turns) {
    if (!cache.has(turn.turnId)) {
      cache.set(turn.turnId, estimate);
    }
  }
  for (const key of cache.keys()) {
    if (!validIds.has(key)) cache.delete(key);
  }

  dirtyRef.current = true;   // ← 问题：每次都设 true
  scheduleFlush();
}, [turns, estimate, scheduleFlush]);
```

- `scheduleFlush` 内部：rAF 里 `if (dirtyRef.current) { setTurnHeights(new Map(heightCacheRef.current)); } recompute();`
- `recompute` 由 scroll 事件独立驱动，不依赖此 effect 的 dirtyRef

## 计划改动

- [ ] 在 `useVirtualTurns` 内部加一个 `prevTurnIdsRef = useRef<Set<number>>(new Set())`，记录上次的 turnId 集合
- [ ] turns effect 里计算当前 turnId 集合后，与 prev 对比：
  - 集合相同（无新增无删除）→ **不设 dirtyRef**，但仍执行 cache 清理（清掉 validIds 外的旧 key）和 `scheduleFlush()`（让 recompute 跑一次，以防 turns 引用变了但 turnId 没变时视口需要刷新）
  - 集合不同 → 正常设 dirtyRef = true + scheduleFlush
- [ ] effect 末尾更新 `prevTurnIdsRef.current = validIds`

## 验证路径

1. 启动一个长会话（≥5 轮），让 agent 回复一段较长的内容
2. 观察流式输出期间画面是否还有跳动/闪烁
3. 在 agent 输出期间向上滚动，确认滚动流畅、不被拉回底部
4. agent 输出期间滚回底部，确认续滚恢复正常
5. 新发一条消息（产生新 turnId），确认新轮次正常渲染、高度缓存正常工作
