# 伴随工作台独立窗口焦点跟随同步 设计

## 背景

伴随工作台独立窗口（`#/workbench-window`）不跟随会话、数据不刷新，主窗口侧边栏一切正常。

**根因**（调查结论，非猜测）：

1. 主进程广播链路本身是通的——`renderer-broadcast.ts` 的 `broadcastToWindows` 遍历所有窗口，`conversationListChanged` / `groupDataChanged` / `workspaceFilesChanged` / PTY 三事件都发到独立窗口，且各 store 是模块级订阅，独立窗口 import 即生效。
2. 断点在「当前会话」锚点：
   - 主窗口侧边栏：`activeTabId → activeConv → groupId`（`app/page.tsx:99-103`），切会话即时跟随
   - 独立工作台：`pinnedConversationId → groupId`（`app/workbench-window/page.tsx`），pinnedId 初始化时定死为 `conversations[0]`，之后永不变化
3. 系统里没有「活跃会话切换」的跨窗口信号——`session-store` 的 `activeTabId` 只活在主窗口渲染进程，没有任何主进程事件把它广播出去。独立工作台即使想跟随也没有信号源。
4. 终端「跟随」模式同样失效：`TerminalPanel.tsx` 跟随锚点是 `session-store.activeTabId`，工作台窗口没有 tabs，`activeTabId` 永远是哨兵值——这正是工作台初始化被迫 pin 死 `conversations[0]` 的原因。

连锁表现：TopicPanel 的 `groupDataChanged` 广播匹配 `groupId` 才重拉，锚点停在旧会话 → 当前活跃组的共享文件/组卡/背景变更不刷新；终端看不到主窗口跟随模式下开的终端。

## 目标

- 独立工作台跟随当前活跃会话（不管焦点来自主窗口还是独立会话窗口），效果与主窗口侧边栏一致：话题 tab 切换、组数据变更刷新、终端跟随。
- 焦点切到别的工作区的会话时，工作台完整跟随（连工作区一起切）。

## 架构

**主进程维护全局焦点会话状态 + 广播**，语义为「最近一次被激活的会话」：

- 内存状态 `{ conversationId, workspaceId } | null`；`setFocusedConversation` 被调用且值变化时广播 `focusedConversationChanged` 到所有窗口
- 纯选择动作驱动：不监听 OS 窗口前置/最小化（YAGNI）
- 哨兵 tab（笔记/数据中心）**不上报**，全局焦点自然保持——「保持最近焦点」语义不需要 null 覆盖逻辑
- RPC 只做内存写 + 条件广播，无去抖必要

**已拍板的取舍**：

| 决策点 | 选择 | 排除项及原因 |
|---|---|---|
| 跨工作区焦点 | A 完整跟随（连工作区一起切，文件树/会话列表重载） | B 只在本工作区内跟随——多工作区重度使用时工作台"卡死"在旧区 |
| 哨兵 tab 时工作台行为 | A 保持最近焦点，不清空 | B 严格清空显示空态——常驻窗口频繁闪空态体验差 |
| 焦点信号源 | 全局唯一焦点，主窗口 + session-window 都上报 | 只主窗口上报——在独立会话窗口聊天时工作台无法跟随 |
| 会话删除后的焦点悬空 | 不做主进程清理，渲染层 find 不到自然空态 | 主进程监听删除清焦点——悬空焦点效果等同空态，等主窗口切会话即恢复 |

## 模块边界

**主进程（新增/修改）**：

- 新增 `electron/main/services/focused-conversation-service.ts`：内存状态 + `setFocused`（值变化才广播）+ `getFocused`
- 新增 `electron/main/tipc/focus.ts`：RPC `setFocusedConversation({ conversationId, workspaceId })` / `getFocusedConversation()`，在 `tipc/index.ts` 聚合注册
- `electron/main/tipc/renderer-handlers.ts`：新增 `focusedConversationChanged({ conversationId, workspaceId })` 事件类型

**渲染层（修改）**：

- `stores/conversation-store.ts`：焦点联动 `useSessionStore.subscribe`（activeTabId 变化唯一入口，~:890）内追加上报——焦点 tab 有真实会话才上报 `client.setFocusedConversation`，fire-and-forget 失败静默；哨兵 tab 不上报。通知点击深链（`focusConversation`/`focusTask`）经 activeTabId 变化走同一订阅，无需单独处理
- `app/session-window/page.tsx`：初始化 `selectConversation` 成功后上报一次（一会话一窗口，后续无变化）
- `app/workbench-window/page.tsx`：
  - state `focusedConv`，订阅 `focusedConversationChanged` + 冷启动 `getFocusedConversation()` 拉取
  - 锚点：`anchorConvId = focusedConvId ?? conversations[0].id`（后者为冷启动无焦点兜底，保持现状体验）；`groupId = conversations.find(anchorConvId)?.groupId ?? null`
  - 跨工作区：effect 监听 focusedConv，焦点 `workspaceId` ≠ 当前工作区 → `setWorkspace(目标, { skipSetDefault: true })` + `loadConversations()`
  - `workspaceId` prop 改读 workspace-store 当前值（不再用初始化时定死的 state）
  - 初始化默认模式从「pin 死第一个会话」改为跟随模式，删除 `pinConversation(convs[0])`
- `components/companion/CompanionPanel.tsx`：加可选 prop `terminalAnchor?: string | null`，转发给 TerminalPanel；不传 = 主窗口现状（`activeTabId`）
- `components/companion/TerminalPanel.tsx`：`activeTabId` 三处引用（anchor 计算 / pin 按钮目标 / 跟随态标题文案）统一换成 windowAnchor（props 优先、回退 `activeTabId`）；主窗口行为不变（`activeTabId` 必在 tabs 中，等价替换）；pin 模式仍优先于跟随

**零改动**：TopicPanel（groupId 正确后订阅刷新自然生效）、AdditionalFilesPanel（跟 workspaceId 走）、BrowserPanel（本就广播驱动）。

## 数据流

```
主窗口切 tab ──→ session-store activeTabId 变化
              ──→ conversation-store 焦点联动 subscribe
              ──→ RPC setFocusedConversation（有会话才发）
              ──→ 主进程存状态，值变化则广播 focusedConversationChanged
              ──→ 工作台窗口收到 → 更新 focusedConv
                  ├─ 同工作区：groupId/terminalAnchor 随 conversations 重算
                  └─ 跨工作区：setWorkspace(skipSetDefault) + loadConversations → 全套换新

session-window 打开 ──→ selectConversation 成功 ──→ 上报一次 ──→ 同上

工作台冷启动 ──→ getFocusedConversation ──→ 有焦点直接跟随 / 无焦点兜底 conversations[0]

哨兵 tab ──→ 不上报 ──→ 全局焦点保持 ──→ 工作台不受影响
```

## 错误处理 / 边界情况

- 上报 RPC 失败：fire-and-forget 静默，不影响主流程
- 广播竞态：`broadcastToWindows` 已处理窗口销毁；工作台初始化期间收到广播 → state 覆盖，最终一致
- 焦点会话被删/归档：`conversations.find` 不到 → groupId null 显示空态、终端走 `reconcileActive` 回退链，等主窗口切会话后自动恢复
- 快速连续切 tab：RPC 轻量（内存写 + 条件广播），无需去抖
- 工作台为单例窗口（`openWorkbenchWindow`），不存在多工作台实例竞争

## 未决问题

无——实施时如遇终端跟随态标题在主窗口的显示差异（`activeTab.conversationTitle` vs `conversations.find` 取标题），以统一用 conversations 查找为准（数据同源）。
