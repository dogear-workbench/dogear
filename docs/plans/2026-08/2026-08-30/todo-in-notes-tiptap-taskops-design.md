# 待办并入笔记 + Tiptap 编辑器 + 任务操作权限 设计

**日期**：2026-08-30
**来源**：用户反馈三则——①待办没必要独立，它就是笔记里的勾选项；②编辑器要所见即所得、清爽、有选框；③任务面板缺手动操作（完成/取消/删除），plan 文档里的链接点不开。

## 背景

- 三实体分离（笔记/HumanTodo/Task）刚实施完，但实际使用中用户发现待办独立实体是负担：待办本质是笔记正文的一个勾选项，笔记本身可以承载待办语义。
- NoteEditor 仍是 MDXEditor：有编辑态/渲染态的割裂感，工具栏存在感强，checkbox 不可交互。此前调研（卡片 16b1h86d）已拍板长期路线为 Tiptap，布局 Bear 化已完成，编辑器本体未换。
- 任务状态机只服务自动流转（backlog→queued→running→review→done），用户无法：手动标记已完成（vgizyoja/ruy2lktb 两个实际已实施完的任务卡在 backlog）、取消排队/执行中的任务、删除任务（tipc 已有软删但 UI 未暴露）。
- TaskDetail 渲染 planContent 时，plan 里的相对路径链接（`docs/plans/**.md`、`components/**.tsx`）是纯文本，点不开。

## 目标

1. 撤掉独立待办：待办 = 笔记正文 `- [ ]` 勾选项，编辑器里可直接点选框勾选；待办 tab、HumanTodo 实体、agent todo 工具全部退役。
2. NoteEditor 换 Tiptap：所见即所得 + markdown 输入规则（`# `、`- [ ] `、`**` 敲完即渲染）+ 选中浮现迷你工具栏 + `/` 插入菜单；文件真源仍是 markdown。
3. 任务面板补全用户操作：任意状态可删除、backlog 可手动完成、queued/running 可取消；plan 文档内相对路径可点开预览。

## 架构

### 一、待办并入笔记（checkbox 模型）

**数据模型**：待办没有独立数据。笔记正文里的一行 `- [ ] xxx` 就是一条待办；`- [x]` 为已完成。due 不做结构化字段——需要时在行内写 `📅 2026-09-01` 纯文本（未来如需聚合/高亮再解析，当前 YAGNI）。

**退役清单**：
- 前端：`components/notes/TodosPanel.tsx`、`TodoItem.tsx`、`stores/todo-store.ts`、`types/todo.ts`
- 主进程：`services/todo-service.ts`、`tipc/todos.ts`（路由注册移除）、`agents/tools/todo-tools.ts`（工具注册表清理）、renderer-handlers 的 `todosChanged` 事件
- NotesPanel 四 mode → 三 mode（笔记/任务/回收站），待办搜索分域删除
- TrashView 三段 → 两段（笔记/任务）

**迁移**（`migrate-notes-todos.ts` 反向改造，启动 fire-and-forget，幂等）：todos.json 的每条 HumanTodo → 有 noteId 的 appendNote 到关联卡片正文尾部；无 noteId 的创建新卡（正文一行 `- [ ] text` / `- [x] text`，due 转行尾 `📅 YYYY-MM-DD`）。迁完把 todos.json 改名 `.migrated` 防重跑。当前工作区仅 1 条测试数据，成本≈0。

**agent 工具链**：删除 `mcp__dogear-todos__createTodo / completeTodo / listHumanTodos`。系统提示词「笔记存卡纪律」段更新：琐事备忘改用 `dogear__CreateNote` 存卡片，正文可用 `- [ ]` 勾选项供用户勾选，仍不与任务积压混用（可实施工作走 CreateTask 不变）。

### 二、Tiptap 编辑器（markdown 真源）

**选型**：Tiptap（v2/v3 实施时按当时 stable 定）+ task-list/task-item 扩展 + markdown 序列化（优先社区包 tiptap-markdown，Spike 不达标再自写 serializer）+ bubble-menu（选中浮现）+ suggestion（自建 `/` 菜单）。排除 BlockNote/Milkdown：块结构/自建工程量与「agent 以 markdown 字符串读写笔记」的既有链路冲突。

**交互**：
- 默认渲染态即编辑态，无固定工具栏
- input rules 内置：`# `/`## `→标题、`- [ ] `→待办、`- `/`1. `→列表、`> `→引用、`**x**`→加粗、`` `x` ``→行内代码、`---`→分割线、```` ``` ````→代码块
- 待办行选框直接点击勾选/取消，写回 markdown
- 选中文字浮现 BubbleMenu：粗体/斜体/行内代码/删除线/链接
- 输入 `/` 弹插入菜单：待办、标题、无序/有序列表、引用、代码块、分割线、表格
- 粘贴 markdown 文本自动解析为富文本
- 富文本上限 = markdown 可表达（标题/待办/粗斜/高亮/行内代码/代码块/引用/列表/表格/链接/图片/分割线）；之外的内容粘贴时降级

**数据流不变**：保存 800ms 防抖 + 卸载 flush；内容序列化为 markdown 落盘；加载时 markdown → ProseMirror doc。

**NoteEditor 清理**：移除 MDXEditor 及插件配置；三态待办区删除（待办在正文）；`NoteMeta.todos / TodoItem / TodoStatus` 类型链随之清理（frontmatter 解析保留容忍旧文件）。

### 三、任务操作权限

**状态机放宽**（`task-store.ts` ALLOWED_TRANSITIONS）：
- `backlog` + `done`（手动完成，跳过执行）
- `queued` + `backlog`（取消排队）
- `running` + `backlog`（取消执行）

**新增 cancelTask 语义**（tipc 层）：
- queued：直接迁移回 backlog；队列 drain 时发现任务已非 queued 则跳过（现状已兼容，需验证）
- running：经 execSessionId 中断执行会话（复用现有 interrupt 链路）→ 任务回 backlog；task-queue 写回结果前检查状态，已被取消则不覆盖（竞态保护）
- 手动完成：复用 transition，带 `result: '手动标记完成'`

**UI**：
- TaskCardItem 行 hover：backlog 显主操作「执行」，queued/running 显「取消」；其余操作（手动完成/删除）收进 hover `···` 菜单，删除走 showConfirm
- TaskDetail 常显对应状态操作按钮：backlog=执行/手动完成/删除，queued/running=取消/删除，done/rejected=删除，review=通过/打回（现状）+ 删除

**plan 链接修复**：MarkdownRenderer 增可选 props（`workspacePath` 开启路径链接）；TaskDetail 渲染 planContent 时开启——正文中的 `[text](相对路径)` 链接与裸路径渲染为可点胶囊，复用 path-link 基础设施（白名单扩展名 + resolve 后限工作区内才可点），md 点击走 markdown-preview 浮窗。只在 TaskDetail 场景开启：plan 文档里的路径基本真实存在，规避此前「agent 提到的路径可能未落盘」而移除正文路径识别的问题。

## 模块边界

| 层 | 删除 | 修改 | 新增 |
|---|---|---|---|
| 渲染层 | TodosPanel、TodoItem、todo-store、types/todo.ts | NotesPanel（三 mode）、TrashView（两段）、TaskPanel/TaskCardItem（操作）、TaskDetail（按钮+链接 props）、NoteEditor（Tiptap 重写正文区）、MarkdownRenderer（可选路径链接）、agent.md 提示词段 | TiptapEditor 组件（编辑器本体，含 BubbleMenu/slash 菜单） |
| 主进程 | todo-service、tipc/todos.ts、todo-tools | task-store（状态机）、tipc/tasks.ts（cancel/手动完成）、task-queue（取消竞态）、session-append-templates（存卡纪律段）、migrate-notes-todos（反向迁移）、renderer-handlers（todosChanged） | — |

## 错误处理 / 边界情况

- **取消 running 的竞态**：用户点取消与队列完成写回并发——写回前必查任务状态仍为 running，否则丢弃结果
- **迁移幂等**：todos.json 改名 `.migrated` 而非删除，二次启动跳过；单条迁移失败不阻断其余
- **markdown 往返损耗**：Spike 阶段用真实存量卡片（含 `\-\ [` 转义、HTML 实体、表格）做 md→doc→md 对比，可接受差异才继续；task list 语法、中文 IME 组合输入、长文滚动为验收项
- **手动完成误触**：列表行 `···` 菜单内完成/删除均走 showConfirm；详情页按钮直接执行（有视觉上下文）
- **plan 链接安全**：路径解析失败/越出工作区/非白名单扩展名 → 渲染回纯文本，不可点

## 未决问题

- Tiptap v2 还是 v3（按实施当日 stable 与 tiptap-markdown 兼容性定）
- tiptap-markdown 序列化是否覆盖全部所需节点（高亮/表格/task），不覆盖时补自定义 serializer 的范围
- `/` 菜单与 BubbleMenu 的具体条目最终形态（按 Spike 后手感微调）
- TaskCardItem 行内操作若显拥挤，退化为全部进 `···` 菜单
