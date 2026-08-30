# 三实体分离实施计划

**目标**：笔记/待办（人）/任务（agent）三数据体系分离——笔记去 todos 字段、新建人待办实体、任务加 backlog 积压层、顶栏四 mode + 分域搜索。

**架构思路**：设计已拍板于 [../three-entities-design.md](../three-entities-design.md)，本计划按「主进程数据层 → IPC/agent 工具 → 前端各视图 → 收口组装」顺序实施。排除项见设计文档（backlog 不建独立实体、due 不做通知、B 只改门面已否）。

**涉及模块**：`electron/main/services/`（task-store/task-service/todo-service/notes-service）、`electron/main/tipc/`、`electron/main/agents/tools/`、`stores/`、`components/notes/`、`types/`、提示词（agent.md + staged-execution skill 模板）

## 步骤索引

- [x] [Step 1: 数据层与迁移](./step1-data-layer-migration.md) — Task 加 backlog 状态与新字段、todo-service 新建、存量笔记 todos 迁移、notes-service 瘦身
- [x] [Step 2: IPC 路由与 agent 工具、提示词纪律](./step2-ipc-agent-tools.md) — todos 路由新建、tasks/notes 路由调整、dogear-todos 工具组、存卡纪律重写
- [ ] [Step 3: 待办 mode 视图](./step3-todos-panel.md) — todo-store + TodosPanel（快速输入/排序/双链跳转/软删）
- [ ] [Step 4: 回收站三段](./step4-trash-sections.md) — TrashView 扩展为笔记/待办/任务三段聚合
- [ ] [Step 5: 任务积压分组](./step5-task-backlog-panel.md) — TaskPanel 加 backlog 分组与「执行」按钮
- [ ] [Step 6: 顶栏收口组装与 e2e](./step6-notes-panel-assembly.md) — 四 mode 顶栏、分域搜索、卡片会话化、标签合流、删旧组件、e2e 走查

## 全局决策

- **HumanTodo 结构**（`types/todo.ts`，存储 `.dogear/todos.json`）：`{ id, text, status: 'pending'|'done', due?, noteId?, source: 'manual'|'agent', createdAt, updatedAt, deletedAt? }`
- **Task 扩展**（`types/task.ts`）：状态机 `backlog → queued → running → review → done|rejected`；新增字段 `noteId?`、`deletedAt?`；队列执行器只消费 queued，backlog 不进队列
- **CreateTask 工具**加 `autoExecute` 参数，**默认 false 落 backlog**
- **agent 工具命名**：`mcp__dogear-todos__createTodo / completeTodo / listHumanTodos`；zod 严格校验；错误返回 `isError: true` 不抛异常；文件末尾 `registerTools()` 注册元数据
- **原子写**：todos.json 沿用 task-store 现有原子写模式（参考 `electron/main/services/task-store.ts`）
- **分域搜索**：笔记走 `searchNotes`（query+tag），待办/任务/回收站前端 store 过滤
- **UI 参照**：卡片操作按钮 hover 浮出写法照抄 `components/conversation-list/ConversationRow.tsx:100`（`ml-auto` + `opacity-0 pointer-events-none → group-hover`）
- **主进程改动**每 step 完成后 `bun run build:electron`
- **NoteEditor 不动**：撑大 bug 已修复（`NoteEditor.tsx:308` mt-2 外包 div），本计划不触碰该文件
- 完成后 doc-sync 同步 `docs/codebase-map.md`
