---
step: 2
title: tabs LRU 排序 + 满员回收
status: done
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
  1. **排序实现在 store 层**（session-store 持有 `sortTabs`），未选 Step 3 渲染层派生：tabs 顺序还被 `pickFallbackConversationTab`/`closeTab` 回退逻辑消费，store 层排序让全部消费者语义一致；Step 3 只需按 store 顺序渲染 + 加未读视觉。
  2. **unread 组内排序用 lastActiveAt 降序**（计划的「unread 置位时间降序」走 fallback 条款）：conversation 记录无 unreadAt 字段（step1 未加），不专为排序引入新持久化字段；后台完成置未读的会话其 lastActiveAt 即最近活跃时间，作为组内序合理。
  3. **lastActiveAt 更新点两处**：`switchTab`（会话 tab 分支，同步即时重排）+ conversation-store 底部 `focusedConversationChanged` 订阅处 `touchTabActivity`（step1 建议挂点，覆盖列表点击/独立窗口聚焦/关 tab 回退等全部焦点入口）；重排仅由「焦点变化 / unread 翻转」触发（focusedConversationChanged 主进程值变化才广播，天然满足排序稳定性要求）。
  4. **满员回收候选在三条红线外加第四条保护**：`sessionWindowIds`（独立窗口弹出中）——closeQueryBasedSession 会杀掉独立窗口正在使用的后端 session，且手动关闭路径（tab 栏渲染过滤 + closeOthers 用过滤后列表）从不关闭弹出 tab，自动回收不打破该不变量。
  5. **openTab 签名 sync → `Promise<boolean>`**：回收需 await closeQueryBasedSession；全仓 7 个调用方均不消费返回值，零波及。
- 改动文件清单：
  - `stores/session-store.ts` — SessionTab.lastActiveAt；sortTabs/mostRecentTab/collectUnreadIds/recycleIdleTab；openTab async+满员回收；switchTab touch；新增 touchTabActivity/reorderTabs actions；pickFallbackConversationTab 与 closeTab 的数组尾部依赖改 lastActiveAt 语义
  - `stores/conversation-store.ts` — focusedConversationChanged 订阅并列挂 touchTabActivity；markUnreadFromComplete 末尾调 reorderTabs

### 给下一步的接力棒
- 关键签名 / 数据结构：
  - `SessionTab.lastActiveAt: number`（epoch ms；openTab 创建时 Date.now()，焦点到达时刷新）
  - `sortTabs(tabs: SessionTab[], unreadIds: Set<string>): SessionTab[]`（export 纯函数，稳定排序：未读在前 → 组内 lastActiveAt 降序 → 其余 lastActiveAt 降序）
  - `touchTabActivity(conversationId)`：刷新 lastActiveAt + 重排；无此 tab 则 no-op
  - `reorderTabs()`：按当前 unreadIds 重排；顺序不变时保持数组引用（避免多余 re-render）
  - `openTab(...): Promise<boolean>`：满员 → recycleIdleTab → toast「已释放闲置会话 {title}」→ 继续开新 tab；无可回收者维持原 toast 拒绝
  - session-store 经模块级动态 import 持有 conversation-store getState 引用（`conversationStoreState`，循环依赖按项目惯例延迟导入），读 running/pendingAction/unread 集合；conversation-store → session-store 仍是既有顶层 import
- 下个 step 该从哪里继续：
  - Step 3（tab 栏 UI）直接按 store tabs 顺序渲染：未读组已置前，绿点/加粗读 conversation-store 会话记录的 `unread` 字段（已就绪）；渲染层无需再排序，WorkspaceTabBar 零排序逻辑
- 待办或已知限制：
  - 未读组内序用 lastActiveAt 而非 unread 置位时间（无该字段）；若产品要求严格按置位序，需数据层补 unreadAt
  - 主进程焦点 RPC 失败时（.catch 静默）该次焦点变化不刷新 lastActiveAt，下次焦点变化自然修正
  - 手测未做（子会话无 UI 环境）：建议路径 = 开满 10 tab → 开第 11 个观察回收 toast 与后端 session 释放；后台会话完成观察 tab 跳到未读组；点击未读 tab 观察落回活跃组
