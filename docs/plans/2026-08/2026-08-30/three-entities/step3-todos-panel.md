---
step: 3
title: 待办 mode 视图
status: done
---

## 目标

待办 mode 完整可用：todo-store + TodosPanel（快速输入、due 排序、双链跳转、软删、agent 记录标识）。

## 依赖上下文（接力棒输入）

- 前置 step 产出：step2 的 tipc todos 路由（listTodos/createTodo/updateTodo/setTodoStatus/deleteTodo/restoreTodo）
- 关键决策：due 仅排序标红不做通知；`source: agent` 带小图标；noteId 悬空（目标笔记在回收站/已删）时链接灰态不自动清理

## 计划改动

- [x] 新建 `stores/todo-store.ts`：todos/loading/load/create/update/setStatus/softDelete（调 tipc）+ `subscribeTodosChanged`（主进程 todosChanged 广播，step1 若未加广播此处补主进程侧）；分域搜索用 `filterByQuery(query)` 辅助
- [x] 新建 `components/notes/TodosPanel.tsx`：
  - 顶部常驻快速输入行（Enter 即建，不走顶栏 + 按钮）
  - 列表排序：未完成在前（due 升序、过期标红、无 due 靠后）→ 完成折叠区收底（默认折叠）
  - 行结构：checkbox + 文本 + due（行内编辑，日期选择器不做自然语言解析）+ 关联笔记 chip（点击切笔记 mode 并打开该卡；悬空灰态）+ hover 编辑/删除（软删）
  - `source: agent` 行首小图标
  - 顶部接收 `query` prop 做文本过滤（step6 接顶栏分域搜索）
- [x] 组件暂以独立路由/临时入口验证（正式挂载在 step6 收口）

## 验收

- 手动建/勾选完成/编辑 due/软删后进回收站（step4 呈现）全链路可用
- due 过期行标红且排最前；完成项折叠
- agent 记录的待办（用 createTodo 工具）显示 agent 图标

## 实施回填（做完后填）

### 实际改动
- 与计划差异：
  1. 广播未建独立包装文件：todosChanged 广播直接下沉到 todo-service.ts 写函数内（动态 import('electron') + try/catch 保持非 Electron 环境可用）。tipc todos 路由与 todo-tools 本就直调 todo-service，零改动即全写入方收口（UI + Agent），比 task-service 独立包装文件模式更收口；renderer-handlers.ts 新增 todosChanged 类型
  2. 未建独立路由：主会话决断提前替换挂载点——NotesPanel 'todos' view 直渲染 TodosPanel（旧 TodosView.tsx 文件按计划留给 step6 删）
  3. 快速输入行右侧附一个 Plus 按钮（计划只说 Enter 即建，补充鼠标入口）
  4. 行内组件拆为 TodoItem.tsx（TodosPanel + TodoItem 各自 < 200 行，避免单文件超 300）
- 改动文件清单：
  - electron/main/services/todo-service.ts：写函数（create/patchTodo/status/softDelete/restore/purge）尾部广播 todosChanged；新增 broadcastTodosChanged
  - electron/main/tipc/renderer-handlers.ts：todosChanged 类型
  - stores/todo-store.ts（新建）：todos/loading/loadedWorkspacePath/loadTodos/createTodo/updateTodo/setTodoStatus/softDeleteTodo/subscribeTodosChanged + filterByQuery（分域搜索，step6 接顶栏）
  - components/notes/TodosPanel.tsx（新建）：快速输入行、pending 排序（due 升序、无 due 靠后、过期最先标红）、done 折叠区（默认折叠）、query 过滤；props { workspacePath, query?, onOpenNote }
  - components/notes/TodoItem.tsx（新建）：checkbox + agent Bot 图标 + 文本行内编辑 + due 行内编辑（原生 input[type=date]）+ 笔记 chip（悬空灰态）+ hover 浮出 设日期/编辑/软删（照 ConversationRow 写法）
  - components/notes/NotesPanel.tsx：todos view 挂载 TodosView → TodosPanel；chip 点击切回时间流并打开卡片（switchView('timeline') + setActiveNoteId）

### 给下一步的接力棒
- 关键签名 / 数据结构：
  - `client.listTodos/createTodo/updateTodo/setTodoStatus/deleteTodo/restoreTodo/purgeTodo`（签名不变，step2 产出）
  - `useTodoStore`：todos/loading/loadedWorkspacePath/loadTodos/createTodo/updateTodo/setTodoStatus/softDeleteTodo/subscribeTodosChanged（订阅内部自动按 loadedWorkspacePath 匹配重拉）
  - `filterByQuery(todos, query)`：stores/todo-store.ts 导出，step6 顶栏分域搜索直接用 `<TodosPanel query={...} />`
  - TodosPanel props：`{ workspacePath: string; query?: string; onOpenNote: (noteId: string) => void }`；step6 提为独立 mode 时自包含（订阅 + 惰性加载都在面板内），NotesPanel 无需再接订阅
  - `dueDateOf(todo)` / `isOverdue(todo)`：TodoItem.tsx 导出（due 取 slice(0,10) 与今天比较）
- 下个 step 该从哪里继续：step4 回收站三段——todos 已有 restoreTodo/purgeTodo 路由 + listTodos 需含已删（当前 listTodos 过滤 deletedAt，回收站段需要 service 层新增 listDeletedTodos 或复用 todos.json 原语，见 todo-service）
- 待办或已知限制：
  - due 展示/排序取 due 前 10 位（YYYY-MM-DD），agent 传完整 ISO 时间时时间部分不参与排序
  - 悬空 chip 判定依赖 notes store 已加载（todos view 仅在 NotesPanel 激活后可达，notes 已惰性加载，实际不会误判）
  - 旧 TodosView.tsx 未删（step6 删）；types/note.ts 的 NoteTodoEntry/NoteMeta.todos 同 step2 caveat，step6 一并评估
