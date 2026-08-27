---
step: 2
title: 前端骨架——notes-store + NOTES_TAB_ID + 时间流只读
status: done
---

## 目标

主窗口出现「笔记」哨兵 Tab（紧挨首页，固定 Tab 在前、动态会话 Tab 在后），Tab 内能以时间流只读列表展示卡片。

## 依赖上下文（接力棒输入）

- 前置 step 产出：读 step1 实施回填，拿 tipc 路由名、NoteMeta 结构、notes-changed 事件 payload
- 哨兵 Tab 范式：`stores/session-store.ts:10` `HOME_TAB_ID = '__home__'`；渲染 `app/page.tsx:283-300`——所有内容同时挂载、`display` 切换、组件不卸载。加 `NOTES_TAB_ID = '__notes__'` 照抄
- TabBar：`components/WorkspaceTabBar.tsx`（抽取注释见 page.tsx:280）——执行时先读它，看 HOME 固定项的现有实现方式，笔记照抄成第二个固定项，排在首页右侧、所有动态会话 Tab 之前
- IPC 调用：渲染层一律 `lib/client.ts` 的 tipc client，禁止直连 fs

## 计划改动

- [x] `stores/session-store.ts`：导出 `NOTES_TAB_ID`；检查 activeTabId 类型注释（session-store.ts:24）与关闭逻辑（:95 关到最后一个 Tab 回 HOME 的行为不需要改，笔记是固定 Tab 不参与关闭）
- [x] `components/WorkspaceTabBar.tsx`：固定 Tab 区加「笔记」项（图标用 lucide `StickyNote` 或同类），点击 `setActiveTab(NOTES_TAB_ID)`；布局保证 固定区(首页|笔记) + 动态会话区 顺序
- [x] `app/page.tsx`：HOME 渲染 div 旁加同构的 NOTES div（display 切换挂 `<NotesPanel />`）
- [x] `stores/notes-store.ts`：`notes: NoteMeta[]`、`loading`；action：`loadNotes()`（listNotes）、`subscribeNotesChanged()`（监听 step1 的广播事件刷新）；初始化时机——首次激活笔记 Tab 时惰性加载
- [x] `components/notes/NotesPanel.tsx`：骨架 = 左侧窄视图栏（时间流/待办/标签/回收站，本步仅时间流可用，其余 disabled 占位）+ 右侧列表区
- [x] 时间流列表项：时间、正文摘要（首行 ≤80 字）、标签 chips、未完成待办计数（`2/3`）；按 created 倒序
- [x] 订阅渲染层类型：`types/electron-api.ts` 若集中声明 tipc 类型，同步补齐

## 验证

- `bun run dev`：Tab 栏出现「首页 | 笔记 | 会话…」；切到笔记 Tab 列出 Step 1 冒烟残留/手工放置的测试卡片；切走再切回列表状态保持（组件不卸载）

## 实施回填（做完后填）

### 实际改动
- 与计划差异：
  1. `types/electron-api.ts` 条件项不适用：该文件声明 IPC 类型安全由 tipc 提供，notesChanged 已在 renderer-handlers.ts（Step 1）声明，无需补齐
  2. 时间流列表项「正文摘要」直接用 NoteMeta.title（Step 1 写入时提取首行 ≤40 字，比计划的 ≤80 更严格），前端不再截断，line-clamp-1 视觉兑底
  3. 「未完成待办计数」解释为 未完成数/总数（pending+in_progress 算未完成），todos 为空不显示；`2/3` 格式 tabular-nums
  4. listNotes 索引序是 updated 倒序，notes-store 内重排为 created 倒序（时间流语义）
  5. tipc client 对数组返回字段的类型推断带 `| undefined`（同 getAll().workspaces 惯例），loadNotes 里 `?? []` 兑底
- 改动文件清单：
  - `stores/session-store.ts`：导出 NOTES_TAB_ID；activeTabId 注释同步；closeTab 关到最后回 HOME 的行为未动（笔记固定 Tab 不参与关闭）
  - `components/WorkspaceTabBar.tsx`：固定区第二个固定项「笔记」（lucide StickyNote），位于首页右侧、动态会话 Tab 之前，高亮样式与首页项同构
  - `app/page.tsx`：HOME div 旁新增同构 NOTES div（display 切换挂 NotesPanel，常驻不卸载）
  - `stores/notes-store.ts`（新）：notes/loading/loadedWorkspacePath + loadNotes/subscribeNotesChanged
  - `components/notes/NotesPanel.tsx`（新）：左侧窄视图栏（时间流可用 + 待办/标签/回收站 disabled 占位）+ 右侧时间流列表
- 验证：lint 0 errors（76 warnings 均为历史遗留，本次改动文件 0 warning）；tsc --noEmit 本次改动文件无错误；未涉及 electron/ 主进程，无需 build:electron

### 给下一步的接力棒
- 关键签名 / 数据结构：`useNotesStore = { notes: NoteMeta[], loading, loadedWorkspacePath, loadNotes(workspacePath), subscribeNotesChanged(): () => void }`；NotesPanel 惰性加载条件 = activeTabId===NOTES_TAB_ID 且 workspace.path !== loadedWorkspacePath（切工作区自动重拉）；notesChanged 订阅在面板 useEffect 挂载时建立、卸载时清理，仅当事件 workspacePath === loadedWorkspacePath 时重拉
- 下个 step 该从哪里继续：NotesPanel 列表项目前无点击行为；后续接列表项点击 → getNote 详情视图；左栏 待办/标签/回收站 三个 disabled 视图接 listTodos/searchNotes/listTrashNotes；新建卡片入口走 client.createNote({ workspacePath, input })
- 待办或已知限制：正文摘要仅有首行 title（NoteMeta 无 content，无正文预览）；搜索无 snippet（Step 1 已知限制）；左栏其余三项为纯占位
