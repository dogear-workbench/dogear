---
step: 2
title: tabs LRU 排序 + 满员回收
status: pending
---

## 目标

session-store 的 tabs 数组按「未读 > 最近活跃」自动排序；openTab 满员时自动回收最久未活跃的可回收 tab。

## 依赖上下文（接力棒输入）

- 前置 step 产出：[step1-unread-data.md](./step1-unread-data.md) — conversation-store 提供 unread 状态（接力棒以其实际回填为准）
- `stores/session-store.ts` 现状：`openTab`（达 MAX_TABS=10 时 toast 拒绝返回 false）、`closeTab`、`switchTab`（写 lastActiveConversationTabId）、`pickFallbackTab` 回退链；tabs 数组顺序目前 = 打开顺序，尾部回退逻辑依赖「数组尾部最近打开」语义
- `components/WorkspaceTabBar.tsx` 现状：渲染时按 tabs 顺序平铺，`resolveTabTitle` 实时取 conversation-store 标题
- 关键决策回顾：排序键 = 未读优先 > lastActiveAt 降序；运行中不特殊置顶；重排仅由「焦点变化 / unread 翻转」触发，closeTab 保持剩余相对顺序

## 计划改动

- [ ] `SessionTab` 加 `lastActiveAt: number`；`switchTab` 与焦点联动路径（focusConversationById 到达本 store 的入口）更新该值并重排
- [ ] 重排纯函数 `sortTabs(tabs, unreadIds)`：unread 在前（组内按 unread 置位时间降序，无则按 lastActiveAt），其余 lastActiveAt 降序；在 unread 翻转事件处也调用（订阅 conversation-store，或由 Step 3 渲染层派生排序——若选择渲染层派生则本步仅做 lastActiveAt 与回收，排序实现在 step3 说明，回填时写清实际选择）
- [ ] `openTab` 满员分支改造：先在 tabs 中找「非运行中、非等待确认、非未读」且 lastActiveAt 最小者 → closeQueryBasedSession + closeTab + toast「已释放闲置会话 {title}」→ 继续开新 tab；无可回收者维持现有 toast 拒绝
- [ ] 排查 `pickFallbackTab` / `pickFallbackConversationTab` 对「数组尾部 = 最近打开」的依赖：重排后尾部语义变为「最久未活跃」，确认回退目标选取仍合理（回退到最近的会话 tab 语义应改为按 lastActiveAt 取，而非数组尾部）
- [ ] 排查 `closeTab` 的 `newTabs[newTabs.length - 1]` 同类依赖，一并改为 lastActiveAt 语义

## 实施回填（做完后填）

### 实际改动
- 与计划差异：
- 改动文件清单：

### 给下一步的接力棒
- 关键签名 / 数据结构：
- 下个 step 该从哪里继续：
- 待办或已知限制：
