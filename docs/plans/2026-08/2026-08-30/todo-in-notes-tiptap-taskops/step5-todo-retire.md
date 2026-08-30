---
step: 5
title: 待办实体退役
status: in_progress
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
  - 迁移函数改名 `migrateTodosToNotes` / `migrateTodosToNotesAllWorkspaces`（旧名 migrateNotesTodos* 删除，旧 frontmatter→任务/人待办方向代码全删，理由：三实体迁移已跑完存量已清）；测试文件同步重写为反向迁移 6 用例（旧 4 用例删）
  - 回收站条目（deletedAt 非空）不迁，随 todos.json 改名一并退役（step 未明说，按删除语义拍板）；rename 前先清理遗留 .migrated 防 Windows 下目标已存在报错
  - NotesPanel 的 `Ctrl+\` 无需改动（本就只作用 notes/tasks 两 mode）；onOpenNote 链路保留给 TaskPanel（仅删 TodosPanel 分支）
  - 提示词除任务点名的两处表述外，同段落其余 todos 表述（"笔记不带待办字段"/"无 todos"/triggerDescription"存卡（无 todos）"）一并清理；补"可实施工作仍走 dogear__CreateTask"
  - agent.md 实际为工作区级 `.dogear/workspaces/15d3447b-…/agent.md`（项目根无 agent.md）；codebase-map 顺手还清 Step 3/4 doc-sync 债（NoteEditor MDXEditor→Tiptap、新增 TiptapEditor 条目、note.ts/notes-store/notes-service 条目 todos 表述清理）
  - 计划外删除：`electron/main/services/todo-service.test.ts`（grep 复核发现，随 todo-service 一并退役）
- 改动文件清单：
  - 删除（git rm 8 个）：`components/notes/TodosPanel.tsx`、`components/notes/TodoItem.tsx`、`stores/todo-store.ts`、`types/todo.ts`、`electron/main/services/todo-service.ts`、`electron/main/services/todo-service.test.ts`、`electron/main/tipc/todos.ts`、`electron/main/agents/tools/todo-tools.ts`
  - 修改：`electron/main/services/migrate-notes-todos.ts`（反向迁移重写）、`electron/main/services/migrate-notes-todos.test.ts`（重写 6 用例全绿）、`electron/main/index.ts`（启动调用改名）、`electron/main/tipc/index.ts`、`electron/main/tipc/renderer-handlers.ts`、`electron/main/agents/pi-session/pi-session.ts`、`electron/main/agents/session-append-templates.ts`、`components/notes/NotesPanel.tsx`（三 mode）、`components/notes/TrashView.tsx`（两段）、`.dogear/workspaces/15d3447b-…/agent.md`、`docs/codebase-map.md`
  - 验证：build:electron + build:renderer + lint（0 error）+ tsc（20 个全为历史遗留，改动文件零新增）+ 真实 todos.json 临时目录实测（建新卡成功、.migrated 生成、二次跑零操作）+ 全局 grep 归零（仅 docs/plans 历史文档例外）

### 给下一步的接力棒
- 关键签名 / 数据结构：`migrateTodosToNotes(workspacePath): Promise<{ migratedTodos, appendedNotes, createdNotes, skipped }>`；todoLine 格式 `- [ ]|- [x] text[ 📅 YYYY-MM-DD]`（due 正则取 ISO 前缀 10 位）；迁移走 notes-service（appendNote/createNote，自动刷索引+广播），不依赖已删的 todo-service；todos.json 迁完原子改名 `.dogear/todos.json.migrated`
- 下个 step 该从哪里继续：计划 5 步已全部完成；GUI 验收项（重启看迁移、三 mode 顶栏、两段回收站、工具列表无 dogear-todos、正文 checkbox 落盘回归）待用户走查；改动未 commit，由主会话验收后提交
- 待办或已知限制：新卡标题由 extractTitle 从 `- [ ] text` 首行提取，显示为 `[ ] text`（剥了 `- ` 前缀，用户可改）；todos.json 解析失败的极端情况文件保留不改名下次重试；安装版实例的工作区 agent.md 副本漂移问题（three-entities 遗留）不在本步范围
