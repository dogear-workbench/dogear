# 笔记编辑器与任务系统修复 实施计划

**目标**：修复编辑器三处体验 bug、任务详情渲染错位、会话定位失败；任务系统重构为「计划 → 待办 → 执行 → 完成」模型（计划栏支持占位、完成可移回、agent 不再往笔记塞任务卡）。

**架构思路**：设计文档见 [../notes-tasks-fixes-design.md](../notes-tasks-fixes-design.md)。任务状态机加 `plan` 态（tasks.json version 1→2 读时迁移存量 backlog）；agent 侧 CreateTask 改 upsert（同标题计划任务补 planPath）；定位修复复用 conversation-store 焦点联动，不新增跨工作区切换代码。路径渲染只做 md 链接的 baseDir 基准修复，白名单不扩展（用户否决代码文件预览）。

**涉及模块**：`components/notes/`（TiptapEditor + tiptap/ + TaskPanel + TaskDetail）、`components/MarkdownRenderer.tsx`、`lib/reference-guard.ts`、`stores/task-store.ts`、`electron/main/services/task-store.ts` / `task-service.ts` / `task-queue.ts`、`electron/main/tipc/tasks.ts`、`electron/main/agents/tools/task-tools.ts`、`electron/main/agents/session-append-templates.ts`、`types/task.ts`

## 步骤索引

- [x] [Step 1: 编辑器三修](./step1-editor-fixes.md) — 表格操作浮条 + 列宽拖拽、代码块深色化、插入菜单定位修复
- [x] [Step 2: 任务数据层三栏重构](./step2-task-data.md) — 状态机加 plan、version 迁移、upsert 占位、执行防御、moveTask IPC
- [x] [Step 3: 任务 UI 三栏与详情渲染](./step3-task-ui.md) — 分组重排、按钮布局调整、MarkdownRenderer baseDir、详情删除按钮
- [x] [Step 4: agent 工具与提示词](./step4-agent-tools.md) — CreateTask upsert / ExecuteTask 扩 plan、存卡纪律改写（不污染笔记）
- [x] [Step 5: 会话定位修复](./step5-jump-fix.md) — jumpToSourceConversation 未开 tab 走完整打开链路

## 全局决策

- **会话稳定主键统一用 conversationId**（originSessionId / execSessionId / note.source 全是它），跳转一律走 `jumpToSourceConversation`。
- **术语**：UI 与 agent 提示词统一「计划（plan）/ 待办（backlog）」；queued/running/review 照旧（排队中/执行中/待审核）。
- **upsert 仅匹配 plan 态同标题**；其他态同标题仍新建，避免误改用户确认过的任务。
- **主进程代码改动后必须 `bun run build:electron` 重编译**才能生效；Vite 热重载只对渲染层。
- **前端类型镜像**：`types/task.ts` 与 `electron/main/services/task-store.ts` 双向同步改（tsconfig 隔离，不能共享 import）。
- **不写注释**（WHY 非显而易见时一行）；完成后 doc-sync 同步 `docs/codebase-map.md`。

## 完成总结

五个 step 全部实施完毕（每 step 独立 commit）：

- **step1** `b057535` 编辑器三修：表格浮条（TableToolbar，删表/删行/删列/插行/插列）+ TableKit resizable 拖列宽；代码块 github-dark 深色化；`/` 菜单向下空间不足时向上弹 + 双 rAF 定位 + resize 跟随
- **step2** `1a3d254` 数据层：TaskStatus 加 plan 态、tasks.json version 1→2 读时迁移（backlog→plan，模块级 Map 防并发）、createTask upsert（plan 同标题补 planPath）+ planPath 可空占位、moveTaskToBacklog/moveTaskToPlan + moveCollabTask IPC、队列执行前拦截占位任务；16 单测全过
- **step3** `68585f9` UI：TaskPanel 按「计划→待办→排队/执行/待审→已完成」重排（打回并入计划组）、操作按钮下沉 meta 行 hover 浮出、TaskDetail 删除收进回退旁 + 移到待办/移回计划流转、MarkdownRenderer baseDir 修正 plan 文档相对链接基准
- **step4** `291fc54` agent 侧：CreateTask planPath 可省略占位 + upsert 透传 + autoExecute 两步模式（先落 plan 再 executeTask，规避 upsert 撞标题丢排队语义）、ExecuteTask 扩 plan 态 + 占位即时报错、存卡纪律重写（可实施工作只进任务不存笔记卡）；skill 模板 grep 无旧术语零改动
- **step5** `6ed0549` 定位修复：jumpToSourceConversation 改 async 完整链路（已开 tab 聚焦 / 独立窗口唤起 / 未开查会话 openTab+select / 兜底 toast），跨工作区靠既有焦点联动

验证：build:electron 编译通过、task-store 16 测试全过、lint 0 errors（76 warnings 均存量）、codebase-map.md 已同步。GUI 交互走查（表格浮条、三栏流转、跳转链路）留待用户 dev 环境确认。
