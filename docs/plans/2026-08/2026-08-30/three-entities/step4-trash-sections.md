---
step: 4
title: 回收站三段
status: done
---

## 目标

回收站从笔记单源扩展为笔记/待办/任务三段聚合，恢复与彻底删除分流到各自 service。

## 依赖上下文（接力棒输入）

- 前置 step 产出：step1 软删字段（deletedAt）与恢复/彻底删除 service；step2 tipc 路由（restoreTodo/purgeTodo、restoreTask/purgeTask 已有或本步补）
- 现状：`components/notes/TrashView.tsx` 笔记单列（listTrashNotes/restoreNote/purgeNote 文件级移动机制）

## 计划改动

- [x] `components/notes/TrashView.tsx` 扩展：
  - 三段布局：笔记 / 待办 / 任务，段标题带计数，空段不显示
  - 笔记段沿用现有恢复/彻底删除
  - 待办段：文本 + 删除时间，恢复（清 deletedAt）/彻底删除
  - 任务段：标题 + 删除时间，恢复/彻底删除
  - 接收 `query` prop 过滤三源（笔记标题、待办 text、任务 title）
- [x] 缺的 tipc 路由本步补齐（对照 step2 产出）
- [x] stores：todo-store/task-store 加回收站列表与恢复/彻底删除动作（若 step3 未覆盖）

## 验收

- 三类实体软删后都出现在回收站对应段；恢复回原视图；彻底删除消失且不进回收站
- 搜索过滤三段

## 实施回填（做完后填）

### 实际改动
- 与计划差异：
  1. 未在 todo-store/task-store 加回收站列表与恢复/彻底删除动作：三源走 TrashView 本地拉取（与现有笔记段模式一致），恢复/彻底删除直调 tipc client（任务描述允许项）；恢复后原视图刷新由 service 层已就绪的 todosChanged/tasksChanged/notesChanged 广播兑底，全局 store 存 deleted 列表收益为零
  2. NotesPanel 挂载点传入 query={searchDraft}：计划只说「接收 query prop」，但验收要求「搜索过滤三段」，最小接线让回收站视图下顶部搜索框即时过滤（timeline 的 runSearch 防抖调用对 trash 无影响）
- 改动文件清单：
  - electron/main/services/todo-service.ts：新增 listDeletedTodos（deletedAt 非空，最近删除在前）
  - electron/main/services/task-store.ts：新增 listDeletedTasks（同排序）
  - electron/main/services/task-service.ts：透传 listDeletedTasks
  - electron/main/tipc/todos.ts：新增 listDeletedTodos 路由
  - electron/main/tipc/tasks.ts：新增 listDeletedCollabTasks 路由
  - components/notes/TrashView.tsx：重构为三段（内部拆 TrashRow/SectionHeader，286 行）
  - components/notes/NotesPanel.tsx：TrashView 传 query

### 给下一步的接力棒
- 关键签名 / 数据结构：
  - `client.listDeletedTodos({ workspacePath })` → `{ todos: HumanTodo[] }`；`client.listDeletedCollabTasks({ workspacePath })` → `{ tasks: Task[] }`
  - TrashView props：`{ workspacePath: string; query?: string }`，query 即时前端过滤（笔记 title/待办 text/任务 title，大小写不敏感）
- 下个 step 该从哪里继续：step5/6 按计划继续；顶栏分域搜索接线时 TrashView/TodosPanel 的 query prop 已就绪
- 待办或已知限制：
  - 回收站操作后原视图刷新依赖既有广播（restore/purge → todosChanged/tasksChanged/notesChanged，store 订阅均已就绪）；回收站列表自身不订阅广播，他人软删后需重进视图刷新（与原笔记段行为一致）
  - 笔记段保留常显按钮旧样式；待办/任务段 hover 浮出，若后续统一交互改 TrashRow 的 hoverActions prop 即可
