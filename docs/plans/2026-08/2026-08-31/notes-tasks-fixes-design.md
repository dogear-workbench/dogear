# 笔记编辑器与任务系统修复设计

**日期**：2026-08-31
**背景**：用户走查笔记/任务功能后反馈四类问题：①编辑器表格无法删除、代码块浅底白字、插入菜单遮挡；②任务详情里 plan 文档相对路径解析错位、按钮布局不合理；③任务流程要拆「计划 → 待办 → 完成」三段、可实施工作不应再污染笔记；④笔记/任务的来源会话定位不上。

**目标**：修复上述四类问题；任务系统重构为「计划 → 待办 → 执行 → 完成」模型，计划栏支持无文档占位，完成可移回计划。

---

## 一、编辑器三修（TiptapEditor）

### 1a 表格操作
- `TableKit` 已含数据层，补装 columnResizing（若 TableKit 未内置则单独 import `@tiptap/extension-table` 的 columnResizing，实施时查 node_modules 确认）。
- 新建 `components/notes/tiptap/TableToolbar.tsx`：监听 editor `selectionUpdate`，光标（含空选区）在表格内时定位浮条到表格元素上方；按钮组：删除表格 / 删行 / 删列 / 上方插行 / 左侧插列，调 `editor.chain().deleteTable() / deleteRow() / deleteColumn() / addRowBefore() / addColumnBefore()`。样式复用 `.notes-bubble`。
- 定位实现：表格 DOM 用 `view.nodeDOM($pos.start($pos.depth - depthToTable))` 或遍历 `editor.view.dom.querySelector('table')` + `PosAtDOM` 反查；浮条挂在编辑器容器内 absolute，top 取表格元素 offsetTop。

### 1b 代码块配色
- `src/globals.css` `.notes-editor .ProseMirror pre` 深色化（background `#0d1117`、color `#e6edf3`），对齐聊天区代码块风格；行内 code 维持 prose 现状。

### 1c 插入菜单定位
- `SlashMenu.tsx` position() 修时序：root.render 后双 rAF 再量 offsetHeight 定位（首次弹出时 React 未 commit、量高为 0，导致底部空间不足时向上翻的逻辑失效）。
- 向下空间不足时向上弹：`top = max(8, rect.top - h - 8)`；加 window resize 监听。

---

## 二、任务详情渲染

### 2a 路径解析基准
- `MarkdownRenderer` 加 `baseDir?: string`：`a` 链接（相对路径 md 链接）解析基准改 `baseDir ?? workspacePath`（markdown 标准语义=相对文档自身位置）；正文裸路径 `splitPathSegments` 仍以 workspacePath 为基准（那是绝对路径/工作区相对路径）。
- `TaskDetail` 传 `baseDir = dirname(detail.planPath)`；占位任务无 planPath 时不传。
- 路径白名单维持 md/markdown/txt/json 不扩展（代码文件预览效果差，用户否决）。

### 2b 详情页按钮
- 删除按钮改为 meta 行返回箭头旁 icon 小按钮（同 NoteEditor：`ArrowLeft` + destructive 色 `Trash2`），原操作行里的删除大按钮移除；执行/手动完成/通过/打回等操作按钮保留。

### 2c 列表行按钮
- `TaskCardItem` 的执行/取消/··· 按钮与状态徽章从标题行移到下方 meta 行，标题全宽不再被挡。

---

## 三、任务三栏重构

### 状态机（`electron/main/services/task-store.ts` + `types/task.ts` 镜像）

```
新增 status 'plan'（计划）
plan     → backlog / queued / done
backlog  → queued / done
queued   → running / rejected / backlog
running  → review / queued / rejected / backlog
review   → done / rejected
done     → plan            （新：移回计划）
rejected → plan            （改：打回归计划）
```

- TaskGroups 加 `plan` 键。
- tasks.json `version: 1 → 2` 读时迁移：存量 backlog 全部转 plan（均未经用户确认）；version 2 后不再动。
- 新 transition：`moveTaskToBacklog`（plan → backlog）、`moveTaskToPlan`（done/rejected → plan）。
- `executeTask`：from 扩为 ['plan', 'backlog']。
- `completeTaskManually`：from 扩为 ['plan', 'backlog']。
- 实施时 grep 旧 `rejected → queued` 迁移的调用方并清理。

### 占位任务
- `Task.planPath` 变 optional；`CreateTaskInput.planPath` 同步。
- createTask 改 **upsert**：同 workspace 下存在 status==='plan' 且 title 相同的任务时，更新其 planPath/updatedAt 并返回（不新建）——agent 后续写完文档再次挂载即补路径。
- 传入 planPath 时仍校验存在；省略时允许创建（占位）。
- 执行侧防御：`task-queue.executeOne` 前校验 planPath 存在（文件级 fs.access），缺失则 reject「任务尚无 plan 文档，请先补文档再执行」。

### agent 工具（`electron/main/agents/tools/task-tools.ts`）
- `dogear__CreateTask`：planPath optional；描述改「默认落计划栏；方案未定型可省略 planPath 占位；计划栏同标题任务已存在时更新其 planPath」。
- `dogear__ExecuteTask`：允许 plan/backlog（plan 直接入队，语义=用户已确认）；planPath 缺失报错引导补文档。
- 术语统一为「计划 / 待办」。

### 提示词改写（`session-append-templates.ts` NOTES_DISCIPLINE_APPEND）
- 动线：聊透方案 → 落 plan 文档（docs/plans/...）→ `dogear__CreateTask` 落**计划栏**；在回复中告知用户。
- **可实施工作只进任务，不存笔记卡片**；笔记只收：脑暴思路、用户明确要求记录的内容、琐事备忘（正文 `- [ ]` 勾选项）。
- 执行：用户明确要做 → `dogear__ExecuteTask`；结果摘要由队列自动写回任务，完成后不再 `dogear__AppendNote`。
- `getSystemPromptSegments` 的 notes-discipline 段描述同步。

### UI（TaskPanel / TaskDetail / TaskStatusBadge / TrashView）
- 分组顺序：**计划**（plan + rejected 合并展示，rejected 徽标区分）→ **待办**（backlog，执行按钮仅此栏）→ 排队中 → 执行中 → 待审核 → **已完成**（done，行内「移回计划」按钮）。
- 计划栏行内按钮「移到待办」；占位任务显示「无文档」标识。
- 新任务不再写 noteId；字段与存量展示保留兼容（存量任务的来源笔记 chip 保留）。
- TaskStatusBadge 加 plan 状态（「计划」）。
- tipc 加 `moveCollabTask`（to: 'backlog' | 'plan'）路由 + 前端 store action。

---

## 四、会话定位修复

`lib/reference-guard.ts` `jumpToSourceConversation` 重写（现状只在已开 tab 里找，未开即 toast「来源会话未打开」= 永远定位不上）：

1. tab 已开 → `switchTab` + `requestFocus`（现状保留）。
2. 独立窗口已开 → `client.openSessionWindow` focus 现有窗口。
3. 未开 → `conversation-store` 当前分片按 id 找 Conversation；conversations 未加载先 `loadConversations` 再找；找到 → `selectConversation` + `openTab`（跨工作区由 conversation-store 焦点联动订阅自动切工作区，无需手动处理）；找不到 → toast「会话不存在或已删除」。

NoteEditor 来源跳转、TaskDetail 执行会话跳转共用该入口。

---

## 模块边界

| 模块 | 文件 |
|------|------|
| 编辑器 | `components/notes/TiptapEditor.tsx`、`tiptap/TableToolbar.tsx`（新）、`tiptap/SlashMenu.tsx`、`src/globals.css` |
| 渲染 | `components/MarkdownRenderer.tsx`、`components/notes/TaskDetail.tsx`、`components/notes/TaskPanel.tsx`、`TaskStatusBadge.tsx` |
| 任务数据 | `electron/main/services/task-store.ts`、`task-service.ts`、`task-queue.ts`、`types/task.ts` |
| IPC | `electron/main/tipc/tasks.ts` |
| agent | `electron/main/agents/tools/task-tools.ts`、`session-append-templates.ts` |
| 定位 | `lib/reference-guard.ts` |

## 错误处理 / 边界

- 占位任务执行拦截（队列侧 + 工具侧双层）。
- upsert 仅匹配 plan 态同标题；backlog/queued 等其他态同标题仍新建（避免误改用户确认过的任务）。
- version 迁移幂等，二次读取跳过。
- 搜索过滤 `planPath.toLowerCase()` 在 undefined 时跳过该字段（前端过滤链路）。

## 未决问题

- TableKit 是否内置 columnResizing（实施时查证，未内置则显式引入）。
- rejected → queued 旧路径调用方待 grep 清理。
