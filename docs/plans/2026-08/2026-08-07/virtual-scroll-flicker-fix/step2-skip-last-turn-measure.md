---
step: 2
title: measureElement 跳过最后一轮
status: done
---

## 目标

`measureElement` 被 ResizeObserver 调用，监听每个 turn 元素的高度变化。流式输出时最后一轮高度持续增长，每次变化都 `dirtyRef = true` + `scheduleFlush`，与 step 1 的守卫形成矛盾（turns effect 挡住了，但 ResizeObserver 又放出来了）。需要让最后一轮的高度更新不触发全局 `setTurnHeights`。

## 依赖上下文（接力棒输入）

- 前置 step 产出：[step1-turnid-guard.md] 在 turns effect 加了 turnId 集合守卫，流式追加不触发 `setTurnHeights`
- `measureElement` 当前代码（`:133-141`）：

```typescript
const measureElement = useCallback((turnId: number, el: HTMLElement) => {
  const h = el.getBoundingClientRect().height;
  const cache = heightCacheRef.current;
  const current = cache.get(turnId);
  if (current === undefined || Math.abs(current - h) > 1) {
    cache.set(turnId, h);
    dirtyRef.current = true;   // ← 最后一轮长高时也设 true
    scheduleFlush();
  }
}, [scheduleFlush]);
```

- `registerTurnElement` 在元素挂载时调 `measureElement`，并注册到 ResizeObserver 持续监听
- 最后一轮在流式期间始终在 DOM 中（在视口内被真实渲染），高度变化只影响它自己的 `turnBottom`，不影响其他轮次的 `turnTop`（累计从前往后）

## 计划改动

- [ ] `measureElement` 内部增加判断：如果 `turnId` 是当前 `turns` 的最后一轮（`turns[turns.length - 1].turnId`），更新缓存但**不设 dirtyRef、不触发 scheduleFlush**
  - 缓存值仍然更新（`cache.set(turnId, h)`），保证用户滚走再滚回时 `recompute` 能拿到最新高度
  - 但不触发 `setTurnHeights`（不产生全局重渲染）
- [ ] 需要拿到「最后一轮 turnId」——通过 ref 存 `turns.length > 0 ? turns[turns.length - 1].turnId : -1`，在 turns effect 里同步更新

### 为什么安全

最后一轮的 `turnHeights` 值只被占位 div 消费（`style={{ height: turnHeights.get(turnId) }}`）。但最后一轮在视口内时走真实渲染不走占位；不在视口内时（用户翻前面），它的占位高度变化不影响前面轮次的 `turnTop`（累计计算从前往后）。所以不触发全局重渲染是安全的——缓存值已更新，下次 `recompute`（由 scroll 驱动）会读到正确值。

## 验证路径

1. agent 输出一段长文本，观察流畅度（应与 step 1 后一致或更好）
2. agent 输出期间翻到前面，确认无闪烁
3. agent 输出期间翻到前面再滚回底部，确认最后一轮完整渲染、无高度校正跳动
4. 非流式场景（加载历史、切换会话）确认行为不变
