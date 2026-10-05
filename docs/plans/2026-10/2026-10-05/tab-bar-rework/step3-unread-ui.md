---
step: 3
title: tab 栏与列表行未读渲染
status: done
---

## 目标

WorkspaceTabBar 呈现三态（运行中 pulse / 未读绿点加粗 / 闲置淡化）与主子标识；ConversationRow 同源渲染未读。

## 依赖上下文（接力棒输入）

- 前置 step 产出：[step2-tab-sorting.md](./step2-tab-sorting.md) — tabs 排序与 lastActiveAt 就绪（以实际回填为准）
- `components/WorkspaceTabBar.tsx`：会话 tab 渲染在 `tabs.map()` 内（约 L148-220），isActive/isRunning/isPending 已从 conversation-store 取，showPulse=isRunning
- `components/conversation-list/ConversationRow.tsx`：双层高亮（焦点 vs 已打开），运行态已有 pulse 类似呈现，未读渲染并入该行
- 主子关系：conversation 记录有 parentConversationId（`lib/conversation-sort.ts` buildConversationTree 构树用），tab 渲染时从 conversation-store 查该字段判断是否子会话
- 关键决策回顾：同树主子相邻 = 排序时同树会话聚组（主在前子随后，组间按主会话排序键）；子会话标识用 `↳` 前缀或小角标；不引入新组件库组件，绿点用纯 CSS 圆点

## 计划改动

- [ ] `WorkspaceTabBar.tsx` 会话 tab：unread（conversation-store）→ 绿点 + `font-medium`；lastActiveAt 超 24h 且非运行非未读 → `opacity-60`；运行中维持 StatusPulse
- [ ] 主子标识与相邻：排序聚合（若 step2 已实现组内排序则本步只做标识渲染；若 step2 留给渲染层派生则在此实现 useMemo 派生排序列表——与 step2 回填对齐）
- [ ] `ConversationRow.tsx`：unread → 同款绿点 + 标题加粗（覆盖不占 tab 的子会话/bot/定时任务会话）
- [ ] 视觉走查：绿点尺寸、opacity 阈值 24h、主子标识样式，拿实际多会话场景调

## 实施回填（做完后填）

### 实际改动
- 与计划差异：
  1. **主子关系数据源纠正**：step 文档依赖上下文写的 parentConversationId 不准确——lib/conversation-sort.ts:21-37 构树实际用 contractMetadata.parentSessionId（createdBy === 'agent' 时），parentConversationId 是 fork 分叉关系；已按派遣树实现（与 buildConversationTree 同源）
  2. **pendingAction 豁免闲置淡化**：等待确认超 24h 的会话淡化会误导（它在等操作），isIdle 加 !isPending；视觉走查不认可可删
  3. **附带改善**：resolveTabTitle 改查 convById 全集（byWorkspace 各分片 + personal），跨工作区 tab 标题从回退快照变为实时跟随重命名
  4. tab 与列表行绿点 class 两处重复（w-2 h-2 rounded-full bg-emerald-500），一行样式未建共享常量，视觉调整需同步两处
- 改动文件清单：
  - `components/WorkspaceTabBar.tsx` — 数据源换 byWorkspace + personalConversations；convById / displayTabs useMemo 派生（DFS 同派遣树主子相邻，父不在 tabs 的子留原位）；三态视觉（未读绿点 + font-medium / 闲置 opacity-60 / 运行 StatusPulse 不动）；子会话 ↳ 标识；IDLE_FADE_MS=24h 常量
  - `components/conversation-list/ConversationRow.tsx` — isUnread → 标题前同款绿点 + 非选中态 font-medium text-foreground（选中态样式优先）

### 给下一步的接力棒
- 关键签名 / 数据结构：
  - `displayTabs: SessionTab[]`（useMemo 派生展示序，不回写 store）；子会话判定 `conv.contractMetadata?.createdBy === 'agent'`，父匹配 `meta.parentSessionId → tabs 内会话 sessionId`
  - 易调参数：IDLE_FADE_MS（WorkspaceTabBar 顶部，24h）、opacity-60、绿点 w-2 h-2 emerald-500、↳ 标识 text-xs muted
- 下个 step 该从哪里继续：Step 4（子会话已交付提示条，独立）；Step 5（溢出收纳）若「…」菜单复用 tabs 序，菜单序应同样用 displayTabs 聚组序或明确用 store 序，二选一并统一
- 待办或已知限制：
  - 闲置淡化用渲染时 Date.now() 判定，非定时驱动（任意状态变化触发重渲染时自然更新，可接受）
  - 子会话 ↳ 不区分层级深度（孙子也是单 ↳）
  - 手测未做：①后台会话完成 → 绿点加粗且跳最前；②点击 → 绿点消失落回 LRU 位；③派子会话并开 tab → ↳ 且紧随主 tab（主未开 tab 时子留原位带 ↳）；④构造超 24h tab（临时改小 IDLE_FADE_MS）→ 淡化
