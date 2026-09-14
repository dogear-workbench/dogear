---
step: 3
title: tab 栏改版与笔记窗口页面
status: pending
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
- 改动文件清单：

### 给下一步的接力棒
- 关键签名 / 数据结构：
- 下个 step 该从哪里继续：
- 待办或已知限制：
