# 笔记协作与页面重做 实施计划

**目标**：落地两份设计（人机协作闭环 + 笔记页重做与任务系统），交付「笔记卡可引用进会话、Agent 存卡可溯源、Bear 化编辑区、任务挂载自动执行」的完整体验。

**架构思路**：引用队列锚定化先行（纯逻辑层，不依赖新布局）；笔记页骨架重做后，协作闭环 UI 搭在新布局上；任务系统（数据层+队列+工具）随后，任务视图收尾接通。排除「先在旧布局上加按钮再迁移」的双倍工路线。

**涉及模块**：`stores/reference-store.ts`、`components/notes/*`、`components/agent-chat/{ChatInputArea,utils}.tsx`、`agent-chat/hooks/useSendMessage.ts`、`electron/main/agents/tools/notes-tools.ts`、新 Task 服务与 tipc 路由、新 `dogear-tasks` 工具组

**设计文档**：
- `../note-agent-collaboration-design.md`（协作闭环）
- `../notes-page-redesign-design.md`（页面重做 + 任务系统）

## 步骤索引

- [x] [Step 1: 引用队列锚定化](./step1-anchor-references.md) — 5 类引用加归属会话，根治漂移；顺带 NoteReference 类型
- [x] [Step 2: 笔记页骨架与 Bear 化编辑区](./step2-notes-layout.md) — 顶栏/列表 300px/独立标题/meta 小灰行/760px 正文/聚焦工具栏/待办移出
- [x] [Step 3: 协作闭环 UI](./step3-collab-ui.md) — 笔记引用按钮+跳转锚定、笔记芯片与 XML、来源身份证与来源行
- [x] [Step 4: 任务数据层与队列执行器](./step4-task-engine.md) — Task 存储、状态机、串行队列、自动创建执行会话、通知、tipc、agent 工具
- [x] [Step 5: 任务视图](./step5-task-panel.md) — TaskPanel 列表分组+详情（plan 渲染/会话链接/结果/审核）、顶栏接通、通知深链

## 全局决策

- **布局尺寸**：列表 300px 固定；正文 max-width 760px 居中；meta 行小灰字+图标+tooltip，默认收起
- **锚定语义**：引用项带 `anchorConversationId`；ChatInputArea 只渲染、useSendMessage 只取只清锚定本会话的项；会话 tab 关闭时清其锚定项
- **Task 模型**：`{ id, title, status: queued|running|review|done|rejected, planPath, originSessionId?, execSessionId?, result?, createdAt, updatedAt }`，存储走 `.dogear/` JSON，不引入 SQLite
- **工具命名**：新工具组 `server: 'dogear-tasks'`，工具名 `dogear__CreateTask` / `dogear__ListTasks` 等，zod 校验，错误返回 `isError: true`
- **任务产生唯一入口**：会话侧挂载（agent 工具）；UI 不做「转任务」按钮
- **队列串行**：一次执行一个任务；执行会话=自动创建的普通会话（复用主进程会话创建服务），内部是否派子会话由其自行决定
- **项目纪律**：不写注释（WHY 非显而易见除外）；单文件>300 行拆分；tipc 走 `@egoist/tipc` 不碰裸 ipcMain；主进程改动后 `bun run build:electron`
- **不做**：编辑器更换（Tiptap Spike 另期）、列表拖宽、沉浸完整版、转任务入口、双链、链路 2/4/5

## 完成总结

五个 step 全部完成（2026-08-29），交付「笔记卡可引用进会话、Agent 存卡可溯源、Bear 化编辑区、任务挂载自动执行」完整体验：

1. **引用队列锚定化**（bdab187）：6 类引用项带 anchorConversationId，芯片渲染/发送/清理按会话过滤，tab 关闭清锚定引用
2. **笔记页骨架与 Bear 化编辑区**（fa76ad6）：顶栏+300px 列表+完整编辑区、独立标题、meta 小灰行、760px 正文、聚焦工具栏、待办移出；顺手修复保存失败仍显示「已保存」（状态机+失败 patch 回填）
3. **协作闭环 UI**（41ba1ce/6133bdd）：笔记卡一键引用进最近活跃会话、笔记芯片与 referenced_notes XML、CreateNote 来源身份证（conversationId+标题+日期）与 meta 行 🔗 跳回
4. **任务数据层与队列执行器**（4d2dbf6）：Task 状态机与 .dogear/tasks.json、串行队列自动创建执行会话（autoExecute+task-result 约定写回）、review+系统通知、tipc+tasksChanged 广播、dogear-tasks 工具组
5. **任务视图**（本次提交）：TaskPanel 五状态分组+详情聚合（plan 渲染/执行会话链接/结果/审核）、[任务] tab 接通、通知点击深链待审任务、review 徽章

关键跨 step 决策：会话稳定主键统一用 conversationId（agent sessionId 会漂移，不作跳转 key）；Agent 上下文一律挂载点闭包注入，不让 LLM 抄 ID；「跳转会话」统一走 jumpToSourceConversation；渲染层数据订阅统一三件套（惰性 load+subscribeChanged+workspacePath 匹配）。

已知限制（后续可选）：执行超时 60min 硬编码、执行会话在会话列表无特殊标识、来源会话删除后 🔗 无恢复路径、同项跨会话引用不迁移、卡片无摘要字段。
