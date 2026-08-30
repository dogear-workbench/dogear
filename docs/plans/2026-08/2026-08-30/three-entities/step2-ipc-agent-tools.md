---
step: 2
title: IPC 路由与 agent 工具、提示词纪律
status: pending
---

## 目标

tipc 三件套（todos 新建、tasks 扩展、notes 瘦身）+ agent 工具组（dogear-todos 新建、task-tools 调整、notes 瘦身）+ 提示词/纪律联动改写全部就位。

## 依赖上下文（接力棒输入）

- 前置 step 产出：step1 的 service 签名（todo-service 各方法、task-service 的 executeTask/deleteTask/restoreTask/purgeTask）
- 关键决策：CreateTask 加 `autoExecute` 默认 false（积压是常态，执行是决定）；ListTodos 概念随笔记 todos 消亡而移除

## 计划改动

- [ ] 新建 `electron/main/tipc/todos.ts`：listTodos（人待办）/createTodo/updateTodo/setTodoStatus/deleteTodo(软删)/restoreTodo/purgeTodo；注册进 tipc index
- [ ] `electron/main/tipc/tasks.ts`：加 executeTask / deleteTask / restoreTask / purgeTask 路由；listCollabTasks 输出含 backlog 分组
- [ ] `electron/main/tipc/notes.ts`：移除 listTodos 路由；CreateNote 输入 schema 去 todos；updateNote patch 去 todos
- [ ] `electron/main/agents/tools/`（notes 工具组）：CreateNote 去 todos 参数；移除 ListTodos 工具；UpdateNote patch schema 去 todos——同步更新 registerTools 元数据
- [ ] `electron/main/agents/tools/task-tools.ts`：CreateTask 加 `autoExecute`（默认 false → backlog；true → 现有直接入队行为）；新增 `executeTask(taskId)` 工具（backlog → queued）
- [ ] 新建 `electron/main/agents/tools/todo-tools.ts`：`mcp__dogear-todos__createTodo(text, due?, noteId?)` / `completeTodo(id)` / `listHumanTodos()`；zod 校验；错误 `isError: true`；末尾 `registerTools()`
- [ ] 提示词改写：
  - agent.md「笔记存卡纪律」段：四步动线——聊完方案 → 落 plan 文档 → 存卡（无 todos）→ `CreateTask(autoExecute=false)` 落积压；「把待办里能做的做了」改为「看任务积压分组」
  - 全局「笔记存卡纪律」段（通用偏好/系统提示词处）同步改
  - skill 模板 `staged-execution/SKILL.md`：`dogear__ListTodos(hasPlan=true)` → `dogear__ListTasks` 看 backlog 分组
- [ ] `bun run build:electron` 并验证：`client.getRegisteredTools()` 列表含 dogear-todos 组；CreateTask 不传 autoExecute 落 backlog

## 实施回填（做完后填）

### 实际改动
- 与计划差异：
- 改动文件清单：

### 给下一步的接力棒
- 关键签名 / 数据结构：
- 下个 step 该从哪里继续：
- 待办或已知限制：
