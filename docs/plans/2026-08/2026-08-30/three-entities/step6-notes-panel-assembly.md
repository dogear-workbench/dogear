---
step: 6
title: 顶栏收口组装与 e2e
status: done
---

## 目标

NotesPanel 骨架收口：四 mode 顶栏、分域搜索常驻、笔记卡片会话化、标签过滤合流搜索行、删旧组件，最后 e2e 走查全动线。

## 依赖上下文（接力棒输入）

- 前置 step 产出：step3 TodosPanel（props 含 query）、step4 TrashView（props 含 query）、step5 TaskPanel backlog 分组
- 现状：`components/notes/NotesPanel.tsx` 双 mode（笔记/任务）+ 笔记内二级 tab（时间流/待办/标签/回收站）+ mode 内搜索框；`NoteCardItem.tsx` 右侧按钮容器常驻占位
- 关键决策：二级切换整排撤掉；标签 tab 与 TodosView 删除；搜索框常驻四域分发

## 计划改动

- [x] `components/notes/NotesPanel.tsx`：
  - MODES 改四项：笔记 | 待办 | 任务 | 回收站；任务 review 徽章保留
  - 搜索框常驻，按 mode 分域：笔记走 searchNotes（query+tag 叠加）、待办/任务/回收站传 query 给对应面板（内部 store 过滤）
  - 右侧按钮：笔记 mode 显「新建卡片」，其余隐藏
  - 笔记 mode 左侧二级切换撤掉，时间流独占列表区；回收站视图从列表区移除（mode 已有）
- [x] `components/notes/NoteCardItem.tsx` 会话列表化（照 `components/conversation-list/ConversationRow.tsx:100`）：标题独占全宽 truncate；meta 行 = 相对时间 + hover 浮出引用/删除（`ml-auto`、`opacity-0 pointer-events-none → group-hover:opacity-100`）；移除标签 Badge
- [x] 搜索行 `#` 标签下拉：列出全部标签带计数（数据从 notes store 聚合），点选过滤、选中变 chip 显示于搜索框旁可单独点掉，与 query 叠加（复用 searchNotes tag 参数）
- [x] 删除 `components/notes/TodosView.tsx`、`components/notes/TagsView.tsx` 及其引用
- [ ] e2e 走查（代码层面对照完成，真机走查待主会话/用户）：
  - 存卡动线：新对话聊方案 → 存卡（无 todos）→ agent 落 backlog → 任务 tab 点执行 → 队列跑完 review
  - 待办动线：手动快速建（due 过期标红）/ 聊天让 agent 记 / 勾完成 / 软删 → 回收站恢复
  - 搜索四域各自过滤正确；# 标签 chip 与关键词叠加
  - 回收站三段恢复/彻底删除
- [x] doc-sync 同步 `docs/codebase-map.md`（一并补齐 step1~5 未登记的 task/todo 三层产物）

## 验收

- 四 mode 切换各自独立可用；笔记详情打开关闭不再有撑大回归（NoteEditor 未动，走查确认）
- 时间流卡片样式与会话列表一致；标签不再出现在卡片上

## 实施回填（做完后填）

### 实际改动
- 与计划差异：
  1. **NotesPanel 拆出 NotesTimelinePane.tsx**（计划未列）：四 mode 重写后单文件 388 行超 300 纪律，把笔记 mode 内容区（时间流 aside + 分隔线 + NoteEditor 详情区）自包含拆出，NotesPanel 剩 296 行只管 mode 分发 + 顶栏
  2. **新增 TagFilterMenu.tsx**（计划未列）：# 标签下拉是自包含 Popover 组件，避免 NotesPanel 再膨胀
  3. **无工作区时笔记 mode 整区显示「请先选择工作区」**（原为列表区提示 + 编辑区占位两段）：拆分时的合理化，与其他三 mode 无工作区时的呈现一致
  4. **NoteTodoEntry 类型同步删除**（计划未列，step2 caveat 的「评估清理」结论）：前端唯一使用方 TodosView 已删，主进程镜像 note-types.ts 在 step2 已删该类型，对齐；NoteMeta.todos / TodoItem / TodoStatus 保留（NoteEditor 三态待办区 + frontmatter 解析容忍旧文件仍在用）
  5. **笔记卡片 meta 行相对时间取 created**（计划只说「相对时间」）：时间流按 created 倒序，显示与排序一致，避免「排最前却显示旧时间」
  6. **codebase-map.md 补齐 step1~5 未登记产物**：task-store/task-service/task-queue/todo-service/migrate-notes-todos 服务、tipc tasks.ts/todos.ts、前端 task-store/task-focus-store/todo-store、types task.ts/todo.ts、task-tools/todo-tools——此前 step 的 doc-sync 只回填了 step 文档未动 map
- 改动文件清单：
  - 改：`components/notes/NotesPanel.tsx`（四 mode 重写）、`components/notes/NoteCardItem.tsx`（会话化）、`components/notes/TaskPanel.tsx`（+query 过滤）、`types/note.ts`（删 NoteTodoEntry）、`docs/codebase-map.md`
  - 增：`components/notes/NotesTimelinePane.tsx`、`components/notes/TagFilterMenu.tsx`
  - 删：`components/notes/TodosView.tsx`、`components/notes/TagsView.tsx`

### 给下一步的接力棒
- 本计划六个实施 step 全部完成；后续从「e2e 真机走查」开始（见上方走查清单，对照要点：四 mode 动线 / 搜索四域 / # 标签 chip 叠加 / 回收站三段）
- 关键签名：NotesPanel 零 props（自读 store）；`NotesTimelinePane { listHidden, onToggleListHidden, filter, filterResults, filterLoading }`；`TaskPanel { workspacePath, query?, listHidden, onToggleListHidden, onOpenNote }`；`TagFilterMenu { selected, onToggle }`；`export interface NoteFilter { query?, tag? }`（NotesPanel 导出）
- 待办或已知限制：
  - TrashView 无 changed 订阅（step4 已知限制延续）：mode 内他人软删新条目需切出切回刷新；回收站内操作后即时移除
  - 笔记 mode 防抖搜索的 spinner 只在 filterLoading 时显示；待办/任务/回收站为前端即时过滤无 spinner（数据量小无感知）
  - 标签计数来自 notes store（时间流全量列表），搜索过滤结果中的标签不在下拉中额外加权
  - TodosView.tsx 的 3 条 tsc 存量类型错已随文件删除消失；全量 tsc 剩余错误均为 agent-chat/app-debug/AboutTab/KLineChart/settings-store/tool-registry-store 存量
