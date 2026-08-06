---
step: 3
title: 交互适配
status: done
---

## 目标

让搜索跳转、Minimap 点击跳转、compact 折叠展开、自动跟随到底部等交互在虚拟滚动下正常工作。

## 依赖上下文（接力棒输入）

- 前置 step 产出：
  - `useVirtualTurns` hook 已实现，导出 `visibleTurnIds` / `turnHeights` / `registerTurnElement` / `ensureTurnVisible`
  - AgentChat 已接入虚拟渲染，非可见轮次用占位 div
- 关键文件状态：
  - `components/agent-chat/hooks/useChatScroll.ts` — `scrollToMessage(idx, opts)` 当前直接操作 scrollContainer.scrollTop
  - `components/agent-chat/MessageMinimap.tsx` — 点击跳转调 `onJumpToMessage(idx)`
  - `components/agent-chat/AgentChat.tsx` — 搜索激活项切换时 scrollToElement（~line 180）；搜索命中折叠段时自动展开（~line 190）

## 计划改动

### 1. 搜索跳转适配

- `components/agent-chat/hooks/useChatScroll.ts`
  - `scrollToMessage(idx, opts)` 改造：
    1. 用 `turnByIndex` 查出 idx 所属的 turnId
    2. 如果该 turnId 不在 visibleTurnIds → 调 `ensureTurnVisible(turnId)` → 等 requestAnimationFrame 让 DOM 挂载
    3. 累加目标轮次之前所有轮次的 turnHeights 得到精确 scrollTop
    4. scrollTo 到该位置（减去 top-third 或 top 的偏移量）
    5. 如果该轮次首次渲染（高度是预估值），挂载测量后会触发一次微调

- `components/agent-chat/AgentChat.tsx`
  - 搜索命中折叠段时的展开逻辑（~line 190）保持不变，展开后 compact store 变化触发 turns 重建，虚拟滚动重算范围

### 2. Minimap 点击跳转适配

- `components/agent-chat/AgentChat.tsx`
  - `MessageMinimap` 的 `onJumpToMessage={(idx) => scrollToMessage(idx, ...)}` 已经走 `scrollToMessage`，step 3.1 适配后会自动支持
  - Minimap 的视口指示器需要反映当前 visibleTurnIds 范围：
    - `MessageMinimap.tsx` 传入 `visibleRange`（如 `{ startTurnId, endTurnId }`），指示器高度和位置按此计算
    - 或简化：传入 `visibleTurnIds` Set，Minimap 内部算覆盖范围

### 3. 自动跟随到底部适配

- `components/agent-chat/hooks/useChatScroll.ts`
  - `scrollToBottom()` 逻辑：最后一轮永远在可视范围（流式输出时），所以底部轮次是渲染状态，scrollToBottom 直接滚到 scrollHeight
  - 验证：流式 token 追加导致最后一轮高度增长时，占位 div 不会被用到（最后一轮在 visibleTurnIds 内）

### 4. compact 折叠/展开适配

- `components/agent-chat/AgentChat.tsx` 或 `hooks/useVirtualTurns.ts`
  - 展开时（isHistoryCollapsed 变 false）：
    - `buildTurns` 重新切分，折叠区域的轮次重新进入 turns[]
    - 清空这些轮次的 turnHeights 缓存（可能过期），用预估高度
    - 触发虚拟范围重算
  - 折叠时（isHistoryCollapsed 变 true）：
    - 折叠区域的轮次被 `buildTurns` 过滤，自然不渲染
    - 不影响缓存数据（下次展开还能用，但建议清空以防过期）

### 5. 验证 display:none 切换

- `app/page.tsx` 的多 tab 切换用 `display: none/block`
  - 验证 display:none → block 切换后 ScrollArea 的 scrollTop 是否保留
  - 如果不保留，需要在切换回来时主动恢复（记录离开时的 scrollTop 或 visibleTurnIds 的中心 turnId）
  - 同时验证 offsetHeight 在 display:none 时是否为 0 导致可视范围计算异常（需要加守卫：display:none 时跳过范围计算）

## 实施回填（做完后填）

### 实际改动
- 改动文件清单（3 个文件）：
  1. `components/agent-chat/hooks/useChatScroll.ts` — scrollToMessage 新增虚拟滚动支持，UseChatScrollOptions 新增 turnByIndex / ensureTurnVisible 可选入参
  2. `components/agent-chat/AgentChat.tsx` — 解构 ensureTurnVisible / turnByIndex，传入 useChatScroll；搜索 activeMatch effect 增加 ensureTurnVisible 虚拟轮次处理；搜索折叠展开跳转用 scrollToMessageRef 解决 stale closure
  3. `components/agent-chat/MessageMinimap.tsx` — recomputeCurrentTurn 改为扫描 [data-virtual-turn-id] section
- 与计划差异：
  1. 搜索自动展开跳转用 scrollToMessageRef 而非双 effect（避免流式输出时 scrollToMessage 引用频繁变化重复触发）
  2. Minimap 不传 visibleTurnIds，改为扫描 [data-virtual-turn-id] section（只有可见轮次有 section，扫描结果天然只含可见轮次）
  3. display:none / compact 折叠展开经分析确认不需要额外改动（Chromium 保留 scrollTop + ResizeObserver 自愈 / step2 的 useEffect([turns]) 自动处理）

### 给下一步的接力棒
- 无后续 step。虚拟滚动三步全部完成。
