---
step: 4
title: 工具渲染三件套（ReportTaskResult / NoteCard / SendMessage 交付卡）
status: pending
---

## 目标

三个工具专属渲染：`dogear__ReportTaskResult` 结果卡+跳转、NoteCardRenderer 标题化+行级跳转、`dogear__SendMessage`（delivery=true）交付卡。

## 依赖上下文（接力棒输入）

- 设计文档 #6 #7 #10 节
- 当前关键文件状态：
  - `components/ToolBlock.tsx`：`DOGEAR_TOOL_ICONS` / `DOGEAR_CARD_TITLES` / `DOGEAR_CARD_RENDERERS` 三张注册表；`buildResultAction`（约 :250）已有 CreateNote/CreateTask/CreateSession 三类跳转模式可照抄
  - `components/agent-chat/tool-renderers/NoteCardRenderer.tsx`：Update/Append 分支显示裸 `卡片: noteId`（KeyValueList）；Create 分支有标题
  - `useNotesStore` 有 `notes` 列表（含 title）可作标题缓存初值，缺卡再 `client.getNote` 补
  - workspacePath 获取：`useWorkspacePath(workspaceId)`（ToolBlock 内已有）
- 关键决策回顾：标题缓存模块级 Map（noteId → title），notesChanged 广播时失效；SendMessage 仅 delivery=true 用专属卡

## 计划改动

- [ ] 新 `tool-renderers/TaskResultRenderer.tsx`：从 toolInput.result 渲染摘要正文；从输出文本解析任务 ID（`/任务 ID: ([^\s"\\]+)/`）与标题显示状态徽章「review 待审核」；isError 走错误样式（ToolDetailShell isError 既有约定）
- [ ] `ToolBlock.tsx`：注册 `dogear__ReportTaskResult`（图标 ListTodo 蓝系、卡片标题「申报任务结果 · <首行摘要>」、RENDERERS 挂 TaskResultRenderer）；`buildResultAction` 加 ReportTaskResult 分支（getCollabTask 校验存在 → switchTab NOTES + requestTaskFocus，照抄 CreateTask 分支）
- [ ] `NoteCardRenderer.tsx`：新 hook 或模块函数 `useNoteTitle(noteId)`（缓存 Map + useNotesStore 初值 + miss 时 client.getNote 异步补，组件内 state 触发重渲）；Update/Append 分支「卡片: noteId」→「卡片: {标题}（{id 前 8 位}）」，标题缺失（已删卡）显示「{id}（卡片不存在）」灰字；整行变可点按钮 → 打开笔记面板定位（与 ToolBlock buildResultAction 同逻辑：getNote 校验 + switchTab + setActiveNoteId——注意此处是渲染器内部，不依赖 headerActions，自行实现点击）
- [ ] 新 `tool-renderers/DeliveryCardRenderer.tsx`（SendMessage 专属）：判断 `toolInput?.options?.delivery === true` 才渲染交付卡（绿色系边框呼应注入交付色），显示 message 正文摘要 + 目标 toSessionId；delivery 非真时返回通用 ToolDetailShell 渲染（兜底）
- [ ] `ToolBlock.tsx`：注册 `dogear__SendMessage`（图标 Send 绿系、卡片标题 delivery=true 时「交付摘要 · <首行>」否则「发送消息 · <首行>」）

## 验证

- 任务执行会话跑完申报 → ReportTaskResult 卡显示摘要 + review 徽章；点 ExternalLink 跳任务面板定位
- 主会话让 agent 记笔记（CreateNote 已有卡）再 UpdateNote → 渲染器显示卡片标题而非裸 id，点击跳笔记面板
- 删除一张已引用的笔记卡 → Update 渲染降级「卡片不存在」
- 子会话会话流：SendMessage delivery=true 显示绿色交付卡

## 实施回填（做完后填）

### 实际改动
- 与计划差异：
- 改动文件清单：

### 给下一步的接力棒
- 关键签名 / 数据结构：
- 下个 step 该从哪里继续：
- 待办或已知限制：
