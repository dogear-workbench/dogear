---
step: 3
title: 成果卡片渲染器
status: done
---

## 目标
四组 dogear__ 业务动作工具（子会话/记忆/笔记/任务）渲染为「成果卡片」：业务语义收起态标题 + 结构化展开态 + lucide 简笔彩色图标；查询类工具不动。

## 依赖上下文（接力棒输入）
- 前置 step 产出：（执行后回填）
- 当前关键文件状态：`components/ToolBlock.tsx` 内 `TOOL_ICONS`（约 52 行，dogear__ 无条目落灰色 Wrench）、`normalizeToolName`、specializedRenderer 分发（约 215 行 if 链）、`getToolSummary` default 分支取第一个字符串属性；专属渲染器均放 `components/agent-chat/tool-renderers/`，容器基座 `ToolDetailShell.tsx`
- 关键决策回顾：图标与会话列表子会话的 Network 图标保持心智统一；跳转按钮**不在本步**（Step 4 统一在 ToolBlock 层做，renderer 保持纯展示）；颜色新写一律带 `dark:` 双态。

## 计划改动
- [x] 新建 `tool-renderers/SubAgentCardRenderer.tsx`：`dogear__CreateSession`（title/task/profile/outputPath）+ `dogear__CreateSessionBatch`（items 列表，一卡多行）；收起态「派遣子会话 · {task 前 ~30 字}」
- [x] 新建 `tool-renderers/MemoryCardRenderer.tsx`：`dogear__SaveMemory`（title/slug/keywords chips/正文预览 max 3 行）；收起态「保存记忆 · {title}」；`dogear__ForgetMemory` 轻渲染（删除 · slug）
- [x] 新建 `tool-renderers/NoteCardRenderer.tsx`：`dogear__CreateNote`（首行标题/tags chips/正文预览）+ `UpdateNote`（noteId + patch 摘要）+ `AppendNote`（追加片段预览）；收起态「创建/更新/追加笔记 · {标题}」
- [x] 新建 `tool-renderers/TaskCardRenderer.tsx`：`dogear__CreateTask`（title/planPath/状态）+ `ExecuteTask`（taskId/状态）；收起态「挂载/执行任务 · {title}」
- [x] `ToolBlock.tsx`：TOOL_ICONS 补 `Network`（sky）/`Brain`（teal）/`StickyNote`（amber）/`ListTodo`（blue）四色简笔条目（`dogear__Xxx` 精确名或前缀匹配，别名归一）；specializedRenderer 分发接入四个新 renderer；getToolSummary 加各工具业务语义摘要（替代「取第一个字符串属性」）
- [x] 工具入参是 camelCase（CreateSession 的 outputPath/task 等），注意与 pi 工具入参命名一致，执行时以 `electron/main/agents/tools/` 实际 schema 为准
- [ ] 验证：让会话实际触发四组工具（或翻有历史调用的会话），确认收起/展开态与图标（lint/tsc 已过；UI 视觉待 dev 人工过目）

## 实施回填（做完后填）

### 实际改动
- 与计划差异：
  1. 收起态标题实现为「中文业务标签 · 详情」整体替换工具名（如「派遣子会话 · 帮我验证 xx」而非「dogear__CreateSession · 帮我验证 xx」）：新增 `DOGEAR_CARD_TITLES` 表在 titleText 层短路，getToolSummary 开头同步短路，避免这 9 个工具走「取第一个字符串属性」兜底
  2. 图标映射用精确名（9 工具 × 4 色）而非前缀匹配：`dogear__CreateSession` 是 `dogear__CreateSessionBatch` 的前缀且与 `dogear__CreateNote` 共享 `dogear__Create`，前缀表需次序敏感，精确名直白无歧义
  3. 新增共享 `ChipList` 组件放 `ToolDetailShell.tsx`（SaveMemory keywords 与 Note tags/patch.tags 复用）
  4. `ExecuteTask` 非 error 时状态固定「已转入执行队列」（该工具非 error 唯一结果）；`CreateTask` 状态由入参推导（autoExecute→立即执行 / planPath 有无→落计划栏或占位）
  5. 四个 renderer 统一 `{ toolInput?, toolOutput?, isError? }` 签名，内部按入参 schema 形状分支（items/patch/noteId/content 有无），不传 kind
- 改动文件清单：
  - `components/ToolBlock.tsx`：DOGEAR_TOOL_ICONS（9 条精确名，颜色均带 dark:）/ DOGEAR_CARD_TITLES / DOGEAR_CARD_RENDERERS / getToolIcon 查表 / getToolSummary 短路 / titleText 分支 / 分发接入
  - `components/agent-chat/tool-renderers/ToolDetailShell.tsx`：新增导出 `ChipList`
  - `components/agent-chat/tool-renderers/SubAgentCardRenderer.tsx`（新建）
  - `components/agent-chat/tool-renderers/MemoryCardRenderer.tsx`（新建）
  - `components/agent-chat/tool-renderers/NoteCardRenderer.tsx`（新建）
  - `components/agent-chat/tool-renderers/TaskCardRenderer.tsx`（新建）

### 给下一步的接力棒
- 关键签名：
  - `DOGEAR_CARD_TITLES: Record<string, (input?) => { label, detail }>`：收起态标题唯一真源，加新 dogear 卡片工具先填这里
  - `DOGEAR_CARD_RENDERERS: Record<string, ComponentType<CardRendererProps>>`：分发映射，与 titles 表同 key
  - `ChipList({ items, className })`：标签 chip 列表，可复用
- 下个 step 该从哪里继续：Step 4 在 ToolBlock 层做跳转按钮；renderer 已保持纯展示未含任何跳转逻辑；previewAction（buildPreviewAction）是现成的 headerActions 挂载点
- 待办或已知限制：
  - SaveMemory/CreateNote/AppendNote 正文预览 line-clamp-3（按计划），展开态无全文入口，需 Step 4 跳转按钮补足
  - UI 视觉效果需 dev 环境人工过目（无单测/截图能力）
  - 查询类工具（RecallMemory/GetNote/SearchNotes/ListTasks/ListLinkedSessions 等）未动，仍走 KeyValueList 兜底 + Wrench 灰图标
