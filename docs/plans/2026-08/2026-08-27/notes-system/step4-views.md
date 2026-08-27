---
step: 4
title: 视图完善——待办聚合/标签/回收站/搜索
status: done
---

## 目标

视图栏四个视图全部可用：待办聚合视图（agent 实施队列的人类侧入口）、标签过滤、回收站、搜索框。

## 依赖上下文（接力棒输入）

- 前置 step 产出：读 step3 实施回填，拿 notes-store 现有 action 与 NotesPanel 视图栏结构（step2 建的 disabled 占位）
- 数据能力已就绪：step1 的 `listTodos({status?, hasPlan?})`、`searchNotes({query?, tag?})`、`listTrash`/`restoreNote`/`purgeNote` tipc 路由
- 「可实施待办」判定 = todo 有 `plan` 字段（设计文档「执行纪律」节）

## 计划改动

- [x] `components/notes/TodosView.tsx`：聚合所有卡未完成待办
  - 分组：「可执行（有 plan）」在前、「普通待办」在后；组内按卡片聚合显示来源卡片标题（点击跳卡片详情）
  - 待办行：勾选（updateNote 置 done）、状态徽标（pending/in_progress）、plan 路径可点击（一期只展示完整路径文本，跳转 plan 编辑器不做）
- [x] `components/notes/TagsView.tsx`：标签列表（计数）→ 点标签过滤时间流
- [x] `components/notes/TrashView.tsx`：.trash 列表 + 恢复 + 彻底删除（彻底删除走 confirm-store 的 `showConfirm()`，**禁止 window.confirm**）
- [x] 搜索框：NotesPanel 顶栏，输入 300ms 防抖调 searchNotes，结果替换时间流列表
- [x] `components/notes/NotesPanel.tsx`：视图栏四项全部启用，视图切换为组件内 state（不落盘）

## 验证

- 应用内手测：造 3 张卡（含带 plan 待办/普通待办）→ 待办视图分组正确、勾选回写卡片 → 标签过滤 → 删一张卡进回收站 → 恢复/彻底删除（确认弹窗出现）→ 搜索关键词命中

## 实施回填（做完后填）

### 实际改动
- 与计划差异：
  - 从 NotesPanel 抽出 `NoteCardItem.tsx`（卡片行 + formatNoteTime）与 `NoteState.tsx`（NoteLoading/NoteEmpty 空态/加载态）供时间流/搜索结果/各视图复用，避免 NotesPanel 超 300 行
  - 标签过滤点击后同样替换时间流列表（与搜索共用 filter/filterResults 管线），搜索框输入会覆盖标签过滤，切视图时重置过滤态（组件内 state，不落盘）
  - TodosView 勾选回写后依赖主进程 notesChanged 广播自动刷新聚合列表与时间流计数，不手动重拉
  - TrashView 恢复/彻底删除后仅本地移除条目，时间流刷新交给 notesChanged 广播，避免双闪
- 改动文件清单：
  - `components/notes/NotesPanel.tsx`：视图栏四项启用（view state 切换不落盘）；顶栏加搜索框（300ms 防抖 searchNotes，结果替换时间流列表，竞态用 seq ref 保护）；标签过滤接入；无工作区时列表区提示
  - `components/notes/TodosView.tsx`（新）：listTodos 聚合未完成待办，过滤 status!=done；「可执行待办（有 plan）」在前、普通待办在后；组内按卡片聚合，卡片标题点击跳详情；待办行含勾选（getNote 取全量 todos → 置 done → updateNote 整体回写）、pending/in_progress 状态徽标、plan 路径完整文本展示（一期不跳转）；监听 notesChanged 刷新
  - `components/notes/TagsView.tsx`（新）：从 notes store 计算 tag→计数（按计数降序），点标签过滤时间流
  - `components/notes/TrashView.tsx`（新）：listTrashNotes 列表 + 恢复 + 彻底删除（showConfirm 二次确认，禁止 window.confirm）
  - `components/notes/NoteCardItem.tsx`（新）：从 NotesPanel 抽出的卡片行组件 + formatNoteTime
  - `components/notes/NoteState.tsx`（新）：NoteLoading / NoteEmpty 复用空态组件

### 给下一步的接力棒
- 关键签名 / 数据结构：
  - NotesPanel 内部 state：`view: 'timeline'|'todos'|'tags'|'trash'`（不落盘）；`filter: {query?, tag?} | null` + `filterResults: NoteMeta[]` 为生效过滤态，`runSearch()` 统一走 searchNotes；`activeQueryRef` 区分 query/tag 过滤（清空搜索框只退 query 过滤，保留 tag 过滤）
  - TodosView 勾选回写协议：`client.getNote` 取全量 todos → map 置 done → `client.updateNote` patch.todos 整体提交；刷新全靠 notesChanged 广播（TodosView 与 notes-store 各自监听）
  - 新视图组件均接收 `workspacePath` prop（TagsView 除外，读 notes store）；空态/加载态用 `NoteEmpty`/`NoteLoading`（components/notes/NoteState.tsx）
- 下个 step 该从哪里继续：Step 5 移除旧速记板链路（getNotes/saveNotes 旧路由 + ScratchpadSection），接入新卡片笔记；NotesPanel 顶栏「新建卡片」按钮与 NoteEditor 已就绪，无前端阻塞项
- 待办或已知限制：
  - 搜索结果无 snippet 高亮（step1 searchNotes 本就不返回 snippet）
  - todo plan 路径仅展示文本，跳转 plan 编辑器未做（按计划一期范围）
  - 标签视图数据源自 notes store（时间流索引），极端情况下与磁盘不同步靠 notesChanged 兑底刷新
  - 回收站列表不监听 notesChanged（避免双请求双闪），仅初始进入视图时拉取 + 本地增删
