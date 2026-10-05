---
step: 3
title: tab 栏与列表行未读渲染
status: pending
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
- 改动文件清单：

### 给下一步的接力棒
- 关键签名 / 数据结构：
- 下个 step 该从哪里继续：
- 待办或已知限制：
