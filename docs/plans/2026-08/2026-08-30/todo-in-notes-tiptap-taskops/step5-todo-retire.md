---
step: 5
title: 待办实体退役
status: pending
---

## 目标

编辑器已支持正文 checkbox（Step 3/4 就绪）后，撤掉独立待办：存量 HumanTodo 迁移为笔记、待办 tab 与全链路代码删除、agent todo 工具退役、提示词改指向 CreateNote。

## 依赖上下文（接力棒输入）

- 设计文档第一节；前置：Step 3/4 完成（用户在编辑器里已可点选框，撤面板无痛）
- 当前链路全名单（删前 grep 复核引用，防漏）：`components/notes/TodosPanel.tsx`、`TodoItem.tsx`、`stores/todo-store.ts`（导出 `filterByQuery` 被 NotesPanel 用）、`types/todo.ts`、`electron/main/services/todo-service.ts`、`electron/main/tipc/todos.ts`（tipc/index.ts 注册处）、`electron/main/agents/tools/todo-tools.ts`（tool-registry 注册处）、renderer-handlers `todosChanged` 事件
- 四 mode 所在：`components/notes/NotesPanel.tsx`（MODES 笔记|待办|任务|回收站 + 搜索分域把 query 传 TodosPanel）；TrashView 三段：`components/notes/TrashView.tsx`（笔记/待办/任务 Promise.all）
- 迁移改造对象：`electron/main/services/migrate-notes-todos.ts`（当前方向是卡内 todos→todos.json，本步反向）
- 提示词两处：`electron/main/agents/session-append-templates.ts` 存卡纪律段（提及 mcp__dogear-todos__createTodo）；项目根 `agent.md`「笔记存卡纪律」节同样表述
- 当前 todos.json 仅 1 条测试数据（「是哒是哒」，manual，无 due），迁移成本≈0 但逻辑按通用写

## 计划改动

- [ ] `migrate-notes-todos.ts` 反向迁移（启动 fire-and-forget，幂等）：读 todos.json——todo 带 noteId 且该笔记存在 → appendNote 到该卡正文尾部一行；无 noteId → createNote 新卡（正文首行 `- [ ] text` / `- [x] text`，due 存在则行尾加 ` 📅 YYYY-MM-DD`，tags 置 `['待办']` 便于找回）；全量迁完把 todos.json 原子改名为 todos.json.migrated 防重跑；单条失败 warn 跳过不阻断
- [ ] 删除清单（含各注册处/引用清理）：上文名单全删 + `lib/manual-task-toasts.ts` 等处 grep `todo` 复核（大小写敏感区分 Task/TaskPanel 等任务系统命名，勿误伤）
- [ ] `NotesPanel.tsx`：四 mode → 三 mode（笔记|任务|回收站），待办搜索分域、onOpenNote 给 TodosPanel 的链路删除；`Ctrl+\` 列表显隐只剩笔记/任务两用
- [ ] `TrashView.tsx`：三段 → 两段（笔记/任务），todos 恢复/清理代码删
- [ ] 提示词更新两处：琐事备忘表述改为「用 dogear__CreateNote 存卡片，正文可用 `- [ ]` 勾选项供用户勾选」，强调可实施工作仍走 dogear__CreateTask 不混入
- [ ] `docs/codebase-map.md` 同步（doc-sync）：删 todo 系条目、NotesPanel 三 mode、TrashView 两段、tools 清单
- [ ] 全局 grep `dogear-todos|mcp__dogear-todos|TodosPanel|todo-store|todosChanged|listTodos|createTodo|HumanTodo` 归零（记忆/文档历史引用除外）

## 验收

- 重启应用：todos.json 消失（.migrated 在），「是哒是哒」变成一张带未勾选待办的笔记卡
- 顶栏只有 笔记|任务|回收站 三个 mode；回收站只有笔记/任务两段
- agent 工具列表（client.getRegisteredTools 或设置页）无 dogear-todos 三件套
- 笔记正文勾选/取消勾选 checkbox 正常落盘（Step 3 能力的回归确认）
- `bun run build:electron` + `bun run build:renderer` + lint + tsc 通过

## 实施回填（做完后填）

### 实际改动
- 与计划差异：
- 改动文件清单：

### 给下一步的接力棒
- 关键签名 / 数据结构：
- 下个 step 该从哪里继续：
- 待办或已知限制：
