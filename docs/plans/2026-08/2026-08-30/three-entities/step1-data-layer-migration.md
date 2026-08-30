---
step: 1
title: 数据层与迁移
status: done
---

## 目标

主进程数据层就位：Task 支持 backlog/软删/笔记关联，人待办 service 建好，存量笔记 todos 迁移进任务体系，笔记写入侧不再产出 todos 字段。

## 依赖上下文（接力棒输入）

- 设计依据：`docs/plans/2026-08/2026-08-30/three-entities-design.md` §架构
- 现状：`electron/main/services/task-store.ts` 已有五状态状态机与原子写；`task-service.ts` 有 listTasksGrouped/getTaskDetail/reviewTask；`notes-service.ts` frontmatter 写含 todos
- 关键决策：backlog 不建独立实体（Task 状态机扩展）；迁移幂等（frontmatter 有 todos 才迁）

## 计划改动

- [x] `types/task.ts`：Task 类型加 `'backlog'` 状态、`noteId?: string`、`deletedAt?: string`
- [x] `electron/main/services/task-store.ts`：创建任务支持初始 `backlog` 状态；列表/分组输出含 backlog 分组且默认过滤 `deletedAt` 非空项；加软删（置 deletedAt）/恢复（清 deletedAt）/彻底删除（移出数组）
- [x] `electron/main/services/task-service.ts`：加 `executeTask`（backlog → queued，复用现有入队逻辑）；加 `deleteTask` / `restoreTask` / `purgeTask`
- [x] 新建 `electron/main/services/todo-service.ts`：`.dogear/todos.json` 的 create/list（过滤 deletedAt）/updateText/updateDue/setStatus（pending↔done）/软删/恢复/彻底删除；原子写照抄 task-store 模式
- [x] 新建 `types/todo.ts`：HumanTodo 结构（见 plan.md 全局决策）
- [x] 迁移逻辑（放 notes-service 或独立 `migrate-notes-todos.ts`）：启动时检测——遍历笔记文件 frontmatter todos：带 plan 的 `pending` → 创建 backlog Task（挂 noteId、subject 取 todo.text）；带 plan 的 `done` → done Task 保留历史；无 plan → 转人待办（manual source）；迁移完从 frontmatter 删除 todos 字段并回写文件
- [x] `electron/main/services/notes-service.ts`：笔记写入侧（保存/更新）不再输出 todos 字段；读取侧遇到旧文件含 todos 忽略即可
- [x] 迁移与软删恢复广播：复用/新增 tasksChanged 广播（todo 侧本 step 可先不动广播，step3 前补）

## 实施回填（做完后填）

### 实际改动
- 与计划差异：
  - notes-tools.ts 的 CreateNote/UpdateNote 同步去掉了 todos 入参与 schema（编译必需的写入侧适配，仅删不加；ListTodos 工具与 tipc 路由保留，step2 重写工具组时处理）
  - 修复 task-store 隐藏 bug：EMPTY_TASKS/EMPTY_TODOS 模块级共享常量被 mutate 原地 push 污染，跨测试/跨工作区泄漏数据，改为工厂函数每次新建
  - CreateTaskInput 新增 skipPlanCheck（迁移时 plan 文件缺失仍创建任务保留记录）；in_progress 带 plan 归 backlog（设计只覆盖 pending/done）
- 改动文件清单：
  - `types/task.ts`（backlog 状态、noteId/deletedAt、TaskGroups.backlog）、`types/todo.ts`（新建）
  - `electron/main/services/task-store.ts`（镜像类型 + executeTask/softDeleteTask/restoreTask/purgeTask + 列表过滤软删）
  - `electron/main/services/task-service.ts`（executeTask/deleteTask/restoreTask/purgeTask 广播包装）
  - `electron/main/services/todo-service.ts`（新建，todos.json CRUD + 软删，原子写照抄 task-store）
  - `electron/main/services/migrate-notes-todos.ts`（新建，启动迁移，幂等）
  - `electron/main/services/notes/notes-service.ts` + `notes-store.ts`（写入/序列化侧去 todos，读取侧容忍保留）
  - `electron/main/agents/tools/notes-tools.ts`（CreateNote/UpdateNote 去 todos）
  - `electron/main/index.ts`（启动挂载迁移，任务队列启动前）
  - 测试：`task-store.test.ts` 扩展、`todo-service.test.ts`、`migrate-notes-todos.test.ts` 新建

### 给下一步的接力棒
- 关键签名 / 数据结构：
  - `taskService.executeTask(ws, taskId)`：backlog→queued，返回 Task（广播 tasksChanged）；调用方需自行 `getTaskQueue().kick()`（参照 task-tools.ts:60 模式）
  - `taskService.deleteTask/restoreTask(ws, taskId)` / `purgeTask(ws, taskId): boolean`
  - `taskStore.createTask` input 新增 `noteId?/status?('queued'|'backlog'|'done')/skipPlanCheck?`
  - `todo-service.ts`：createTodo/listTodos（过滤软删，updatedAt 倒序）/getTodo/updateTodoText/updateTodoDue（null 清除）/setTodoStatus/softDeleteTodo/restoreTodo/purgeTodo；**本层无广播，step3 接 TodosPanel 前需补 service 层包装 + todosChanged 广播**
  - 存储格式：`{ version: 1, todos: HumanTodo[] }` @ `.dogear/todos.json`
- 下个 step 该从哪里继续：step2 的 todos 路由/工具组直接调 todo-service；task-tools CreateTask 加 autoExecute（默认 false 落 backlog，传 status）+ executeTask 工具（记得 kick）；ListTodos 工具与 tipc notes.ts 的 listTodos 路由待删
- 待办或已知限制：
  - 迁移逐文件「创建实体→回写」非事务，进程崩溃窗口内可能重复创建实体（幂等性靠 frontmatter 无 todos 跳过）
  - 迁移创建的任务时间戳用当下而非笔记 updated（CreateTaskInput 未参数化时间）
  - 前端 types/task.ts 的 TaskGroups.backlog 为必填键，TaskPanel（step5）消费前不影响编译
