---
step: 2
title: IPC 路由与 agent 工具、提示词纪律
status: done
---

## 目标

tipc 三件套（todos 新建、tasks 扩展、notes 瘦身）+ agent 工具组（dogear-todos 新建、task-tools 调整、notes 瘦身）+ 提示词/纪律联动改写全部就位。

## 依赖上下文（接力棒输入）

- 前置 step 产出：step1 的 service 签名（todo-service 各方法、task-service 的 executeTask/deleteTask/restoreTask/purgeTask）
- 关键决策：CreateTask 加 `autoExecute` 默认 false（积压是常态，执行是决定）；ListTodos 概念随笔记 todos 消亡而移除

## 计划改动

- [x] 新建 `electron/main/tipc/todos.ts`：listTodos（人待办）/createTodo/updateTodo/setTodoStatus/deleteTodo(软删)/restoreTodo/purgeTodo；注册进 tipc index
- [x] `electron/main/tipc/tasks.ts`：加 executeTask / deleteTask / restoreTask / purgeTask 路由；listCollabTasks 输出含 backlog 分组
- [x] `electron/main/tipc/notes.ts`：移除 listTodos 路由；CreateNote 输入 schema 去 todos；updateNote patch 去 todos
- [x] `electron/main/agents/tools/`（notes 工具组）：CreateNote 去 todos 参数；移除 ListTodos 工具；UpdateNote patch schema 去 todos——同步更新 registerTools 元数据
- [x] `electron/main/agents/tools/task-tools.ts`：CreateTask 加 `autoExecute`（默认 false → backlog；true → 现有直接入队行为）；新增 `executeTask(taskId)` 工具（backlog → queued）
- [x] 新建 `electron/main/agents/tools/todo-tools.ts`：`mcp__dogear-todos__createTodo(text, due?, noteId?)` / `completeTodo(id)` / `listHumanTodos()`；zod 校验；错误 `isError: true`；末尾 `registerTools()`
- [x] 提示词改写：
  - agent.md「笔记存卡纪律」段：四步动线——聊完方案 → 落 plan 文档 → 存卡（无 todos）→ `CreateTask(autoExecute=false)` 落积压；「把待办里能做的做了」改为「看任务积压分组」
  - 全局「笔记存卡纪律」段（通用偏好/系统提示词处）同步改
  - skill 模板 `staged-execution/SKILL.md`：`dogear__ListTodos(hasPlan=true)` → `dogear__ListTasks` 看 backlog 分组
- [x] `bun run build:electron` 并验证：`client.getRegisteredTools()` 列表含 dogear-todos 组；CreateTask 不传 autoExecute 落 backlog

## 实施回填（做完后填）

### 实际改动
- 与计划差异：
  - pi-session.ts 挂载 dogear-todos 组（计划未列但必需，不挂载工具不可用）；ListTasks status enum 加 backlog（提示词改写的必要支撑）
  - service 层死代码清理：notes-service 删 listNoteTodos/ListTodosInput，note-types 删 NoteTodoEntry（调用方删光后无引用）；TodoStatus/TodoItem 保留（notes-store 解析容忍旧文件仍在用）
  - staged-execution/SKILL.md 无需改：项目内 `resources/skill-templates/` 版本实际无 `dogear__ListTodos(hasPlan=true)` 句（该句在 session-append-templates.ts 的 NOTES_DISCIPLINE_APPEND 中，已重写为四步动线）
  - tipc/notes.ts 的 CreateNote/UpdateNote schema 无需再动（tipc 透传 service 类型，step1 已去 todos）
  - 工作区 agent.md（实例数据目录，不入 git）新增「笔记存卡纪律」段：四步动线 + 积压执行动线 + 琐事分流
- 改动文件清单：
  - `electron/main/tipc/todos.ts`（新建）+ `tipc/index.ts`（注册）
  - `electron/main/tipc/tasks.ts`（executeCollabTask 含 kick/deleteCollabTask/restoreCollabTask/purgeCollabTask）
  - `electron/main/tipc/notes.ts`（删 listTodos 路由）
  - `electron/main/agents/tools/task-tools.ts`（CreateTask autoExecute 默认 backlog 显式传 status；ExecuteTask 新增；ListTasks enum）
  - `electron/main/agents/tools/todo-tools.ts`（新建，registerToolGroup）
  - `electron/main/agents/tools/notes-tools.ts`（删 ListTodos 工具与 todos 展示）
  - `electron/main/agents/pi-session/pi-session.ts`（挂载 dogear-todos）
  - `electron/main/agents/session-append-templates.ts`（NOTES_DISCIPLINE 四步动线 + triggerDescription）
  - `electron/main/services/notes/notes-service.ts` + `note-types.ts`（死代码清理）

### 给下一步的接力棒
- 关键签名 / 数据结构：
  - 前端可用 tipc：`client.listTodos/createTodo/updateTodo/setTodoStatus/deleteTodo/restoreTodo/purgeTodo`；`client.executeCollabTask`（内部已 kick，UI 执行按钮直接调）
  - todo-service 仍无广播层：step3 接 TodosPanel 前需补 todosChanged 广播 + renderer-handlers 类型 + todo-store（参照 task-service 模式）
  - agent 工具全量：dogear-notes 6 工具 / dogear-tasks 3（CreateTask{autoExecute?}/ExecuteTask/ListTasks）/ dogear-todos 3（createTodo/completeTodo/listHumanTodos）
- 下个 step 该从哪里继续：step3 待办 mode 视图；**TodosView.tsx 挂载点（NotesPanel.tsx:251）须在 step3 替换**——step2 删路由后旧 TodosView 已是坏 UI（拿到 HumanTodo[] 渲染旧结构），step6 只删文件不换挂载
- 待办或已知限制：
  - agent.md 双副本：安装版实例（APPDATA db291a2d）的同工作区副本未同步，两份已漂移，待用户应用内同步
  - 工具命名两套风格并存（mcp__dogear-todos__* vs dogear__Xxx），邏10 照 plan 拍板，后续可统一
  - NoteMeta.todos 字段仍存在（前端 types/note.ts:37 + note-types.ts），step6 删 TodosView 时一并评估清理
