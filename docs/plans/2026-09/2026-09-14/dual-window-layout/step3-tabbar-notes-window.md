---
step: 3
title: tab 栏改版与笔记窗口页面
status: done
---

## 目标

WorkspaceTabBar 哨兵 tab 固定右侧一组 + 弹出按钮；笔记 tab 改可开关；空态兜底改造；新建 `app/notes-window` 页面（复用 NotesPanel，含任务定位监听）；数据中心 tab 弹出入口。弹出/关窗恢复全链路可用。

## 依赖上下文（接力棒输入）

- 前置 step 产出：[step1-main-infra.md] openNotesWindow RPC、notesWindowOpened/Closed、dataCenterWindowOpened/Closed 广播已就绪
- 当前关键文件状态：
  - `components/WorkspaceTabBar.tsx` — 现有会话 tab + 哨兵 tab 混排；会话 tab 有 hover 弹出按钮（ExternalLink）与右键菜单可参考
  - `stores/session-store.ts` — `NOTES_TAB_ID` 常驻不可关；`dataCenterTabOpen` + localStorage 是可开关模板；`closeTab` 兜底回 NOTES_TAB_ID（本 step 改空态）
  - `app/workbench-window/page.tsx` — 独立窗口初始化模板（loadSettings → getDefault → setWorkspace skipSetDefault → 加载数据）
  - `components/notes/NotesPanel.tsx` — 复用主体；`stores/task-focus-store.ts` 有 requestTaskFocus（focusTask 现链路用它定位任务）
- 关键决策回顾：弹出 = tab 从栏里隐藏（开关状态保留不重置），关窗 = 恢复显示；笔记 tab 默认开；哨兵组顺序 = 笔记/数据中心/文章固定最右

## 计划改动

- [ ] `stores/session-store.ts`：
  - 加 `notesTabOpen`（localStorage 默认 true）+ open/closeNotesTab（照 dataCenterTabOpen 模式）
  - 加 `notesWindowOpen` / `dataCenterWindowOpen`（广播驱动）
  - `closeTab` / `closeDataCenterTab` 兜底逻辑：无可用 tab 时 `activeTabId = null`（空态），不再回 NOTES_TAB_ID
- [ ] `components/WorkspaceTabBar.tsx`：
  - 布局分两组：会话 tabs 在左（可滚动），哨兵 tab 固定最右一组（笔记/数据中心/文章），组间分隔
  - 哨兵 tab（笔记/数据中心）hover 弹出按钮（ExternalLink）：点击 → client.openNotesWindow / openDataCenterWindow；弹出中（notesWindowOpen 等）tab 隐藏
  - 笔记 tab 加关闭按钮（可开关）；数据中心 tab 已有开关语义，对齐交互
- [ ] `app/page.tsx`：订阅 notesWindowClosed / dataCenterWindowClosed → 清 session-store 弹出态（恢复 tab 显示）；NotesPanel 挂载条件由 notesTabOpen && !notesWindowOpen 驱动；activeTabId 为 null 时渲染空态（EmptyFocusState 或现有空态组件，实施时看现状）
- [ ] 新建 `app/notes-window/page.tsx`：照 workbench-window 初始化模式 + 渲染 NotesPanel；监听 `notesTaskFocus` 事件 → 切对应工作区（如需）+ taskFocusStore.requestTaskFocus(taskId)
- [ ] `src/App.tsx` 加路由 `/notes-window`
- [ ] 验证：笔记 tab 关闭/打开有记忆；点弹出 → tab 消失 + 笔记窗口打开（位置记忆生效，拖动后关开验证）；关窗 → tab 回来且开关状态未被重置；数据中心同链路；关掉所有会话 tab 出现空态不报错

## 实施回填（做完后填）

### 实际改动
- 与计划差异：
  1. `pickFallbackConversationTab` helper 收敛回退逻辑（最近可用会话 tab → null，排除弹出窗口中的会话 tab），`closeNotesTab` / `closeDataCenterTab` / `fallbackActiveTab` 共用；`article-store.clearSelectedArticle` 的关文章兑底也一并改走 `fallbackActiveTab()`（原兑底 NOTES_TAB_ID，与「不再兑底回笔记」决策对齐）
  2. `switchTab(NOTES_TAB_ID)` 收口防御：笔记 tab 被用户关闭时视为重新打开（openNotesTab 语义，写 localStorage）；笔记窗口弹出中落回最近可用 tab —— 避免通知中心/AI 卡片链接等 7+ 个跳转入口产生指向不可见 tab 的悬空态
  3. `setNotesWindowOpen(true)` / `setDataCenterWindowOpen(true)` 内部处理 activeTabId 悬空（弹出时正停在哨兵 tab 则回退），page.tsx 订阅因此只调 setter，逻辑内聚在 store
  4. DataCenterPage 挂载条件同步加 `!dataCenterWindowOpen`（与 NotesPanel 对称：弹出期间卸载，关窗恢复重挂载，store 缓存数据不丢）
  5. 哨兵组分隔不加额外 border-l，靠会话区末 tab 既有 border-r 自然分隔（避免双线）；会话区为空时哨兵组直接贴左
- 改动文件清单：
  - `stores/session-store.ts`：`notesTabOpen`（localStorage 默认 true）+ `openNotesTab`/`closeNotesTab`；`notesWindowOpen`/`dataCenterWindowOpen`（广播驱动）+ setter；`closeTab`/`closeDataCenterTab` 兑底改空态；`switchTab` 笔记分支收口；初始/`reset` 的 `activeTabId` 随 `notesTabOpen`（关了笔记 tab 冷启动不悬空）；新增 `fallbackActiveTab`
  - `components/WorkspaceTabBar.tsx`：布局改两组（左会话区 ScrollArea 可滚动 + 右哨兵组固定：笔记/数据中心/文章）；笔记 tab 改 div+group（弹出/关闭按钮）；哨兵 tab 按 `xxxTabOpen && !xxxWindowOpen` 条件渲染；`showSentinelGroup` 全隐藏时不渲染组容器
  - `app/page.tsx`：订阅 4 个哨兵窗口广播（getState 模式）；NotesPanel 挂载条件 `notesTabOpen && !notesWindowOpen`；`activeTabId === null` 渲染 EmptyFocusState
  - `app/notes-window/page.tsx`（新建）：loadSettings → getDefault/getAll → setWorkspace(skipSetDefault) → 渲染 NotesPanel + TitleBar「笔记」；监听 `notesTaskFocus` → 切工作区（如需）+ `requestTaskFocus(taskId)`
  - `src/App.tsx`：注册 `/notes-window` 路由
  - `stores/article-store.ts`：`clearSelectedArticle` 兑底改 `fallbackActiveTab()`

### 给下一步的接力棒
- 关键签名 / 数据结构：
  - session-store：`notesTabOpen` / `notesWindowOpen` / `dataCenterWindowOpen`；`openNotesTab()` / `closeNotesTab()` / `setNotesWindowOpen(open)` / `setDataCenterWindowOpen(open)` / `fallbackActiveTab()`；`pickFallbackConversationTab`（模块私有）
  - notes-window 页面：`NotesWindowPage`（命名导出），路由 `/notes-window`，hash `#/notes-window` 已通
  - NotesPanel 在独立窗口内的 `isActive`（activeTabId===NOTES_TAB_ID）依赖窗口自身 session-store 初始值；能开窗口时 notesTabOpen 必为 true（入口在 tab 上），恒成立
- 下个 step 该从哪里继续：Step 4（session-window 改版）与本 step 无文件交叠；Step 5 focusTask 分流时注意：主窗口 focusTask 监听里的 `switchTab(NOTES_TAB_ID)` 已被收口（弹出中自动回退），分流后主进程直发 `notesTaskFocus` 即可
- 待办或已知限制：
  1. 既有缝隙（非本 step 引入）：弹出「当前正看的会话」到独立窗口后，主窗口 activeTabId 仍指向该弹出 tab，内容区空白（popOutInternal 不动 activeTabId，Step 4/5 未覆盖，可考虑弹出时切走或空态条件扩展）
  2. 全部 tab 隐藏（笔记关+数据中心关+无文章+无会话）时 tab 栏只剩一条 border 线，空态正常显示，可接受
  3. UI 视觉响应待 dev 人工确认（沙盒无 UI；状态机已脚本冒烟 22 项全过）
