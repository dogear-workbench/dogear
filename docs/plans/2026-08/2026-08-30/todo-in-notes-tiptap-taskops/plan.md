# 待办并入笔记 + Tiptap 编辑器 + 任务操作权限 实施计划

**目标**：待办退役为笔记正文 checkbox、NoteEditor 换 Tiptap 所见即所得（markdown 真源）、任务面板补全手动完成/取消/删除与 plan 链接可点。

**架构设计**：见 [../todo-in-notes-tiptap-taskops-design.md](../todo-in-notes-tiptap-taskops-design.md)（背景/决策/未决问题都在那里，执行前先读）。

**涉及模块**：
- 任务系统：`electron/main/services/task-store.ts`、`task-queue.ts`、`tipc/tasks.ts`、`stores/task-store.ts`、`components/notes/TaskPanel.tsx`、`TaskDetail.tsx`
- 编辑器：`components/notes/NoteEditor.tsx`（重写正文区）、新建 `TiptapEditor.tsx`
- 待办退役：`components/notes/TodosPanel.tsx`/`TodoItem.tsx`、`stores/todo-store.ts`、`types/todo.ts`、`electron/main/services/todo-service.ts`、`tipc/todos.ts`、`agents/tools/todo-tools.ts`、`NotesPanel.tsx`、`TrashView.tsx`、`migrate-notes-todos.ts`、`session-append-templates.ts`
- 链接：`components/MarkdownRenderer.tsx`、`components/agent-chat/path-link.tsx`（复用）

## 步骤索引

- [x] [Step 1: 任务手动操作（状态机放宽 + 取消/完成/删除 + UI）](./step1-task-manual-ops.md) — 后端状态机与队列竞态 + 前端按钮/菜单
- [x] [Step 2: plan 文档路径链接可点](./step2-plan-path-links.md) — MarkdownRenderer 可选路径链接 + TaskDetail 接入
- [ ] [Step 3: Tiptap 编辑器核心替换](./step3-tiptap-core.md) — 依赖安装、NoteEditor 正文区换 Tiptap、markdown 往返与 checkbox
- [ ] [Step 4: Tiptap 交互完善](./step4-tiptap-polish.md) — BubbleMenu、`/` 插入菜单、排版打磨
- [ ] [Step 5: 待办实体退役](./step5-todo-retire.md) — 数据迁移 + 全链路删除 + 提示词更新

## 全局决策

- 包管理一律 bun；主进程（electron/）改动后必须 `bun run build:electron` 验证编译
- 每步完成跑 `bun run lint` + `bunx tsc --noEmit`（至少改动文件零新增错误）+ 涉及渲染层再跑 `bun run build:renderer`
- 不写注释（WHY 非显而易见时允许一行）；UI 文案中文；破坏性操作走 `confirm-store` 的 showConfirm
- 新 IPC 一律走 tipc，禁止直接 ipcMain/ipcRenderer
- Tiptap 版本（v2/v3）在 Step 3 开工时按当日 stable 与 tiptap-markdown 兼容性定，定完写进回填供后续步骤接力
- markdown 序列化优先 tiptap-markdown 社区包；Spike 不达标（表格/task/高亮往返有损）再自写 serializer
- 步骤间接力：每步「实施回填」必须写关键签名/数据结构，执行下步前先读上一步回填
