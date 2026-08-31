---
step: 3
title: 成果卡片渲染器
status: pending
---

## 目标
四组 dogear__ 业务动作工具（子会话/记忆/笔记/任务）渲染为「成果卡片」：业务语义收起态标题 + 结构化展开态 + lucide 简笔彩色图标；查询类工具不动。

## 依赖上下文（接力棒输入）
- 前置 step 产出：（执行后回填）
- 当前关键文件状态：`components/ToolBlock.tsx` 内 `TOOL_ICONS`（约 52 行，dogear__ 无条目落灰色 Wrench）、`normalizeToolName`、specializedRenderer 分发（约 215 行 if 链）、`getToolSummary` default 分支取第一个字符串属性；专属渲染器均放 `components/agent-chat/tool-renderers/`，容器基座 `ToolDetailShell.tsx`
- 关键决策回顾：图标与会话列表子会话的 Network 图标保持心智统一；跳转按钮**不在本步**（Step 4 统一在 ToolBlock 层做，renderer 保持纯展示）；颜色新写一律带 `dark:` 双态。

## 计划改动
- [ ] 新建 `tool-renderers/SubAgentCardRenderer.tsx`：`dogear__CreateSession`（title/task/profile/outputPath）+ `dogear__CreateSessionBatch`（items 列表，一卡多行）；收起态「派遣子会话 · {task 前 ~30 字}」
- [ ] 新建 `tool-renderers/MemoryCardRenderer.tsx`：`dogear__SaveMemory`（title/slug/keywords chips/正文预览 max 3 行）；收起态「保存记忆 · {title}」；`dogear__ForgetMemory` 轻渲染（删除 · slug）
- [ ] 新建 `tool-renderers/NoteCardRenderer.tsx`：`dogear__CreateNote`（首行标题/tags chips/正文预览）+ `UpdateNote`（noteId + patch 摘要）+ `AppendNote`（追加片段预览）；收起态「创建/更新/追加笔记 · {标题}」
- [ ] 新建 `tool-renderers/TaskCardRenderer.tsx`：`dogear__CreateTask`（title/planPath/状态）+ `ExecuteTask`（taskId/状态）；收起态「挂载/执行任务 · {title}」
- [ ] `ToolBlock.tsx`：TOOL_ICONS 补 `Network`（sky）/`Brain`（teal）/`StickyNote`（amber）/`ListTodo`（blue）四色简笔条目（`dogear__Xxx` 精确名或前缀匹配，别名归一）；specializedRenderer 分发接入四个新 renderer；getToolSummary 加各工具业务语义摘要（替代「取第一个字符串属性」）
- [ ] 工具入参是 camelCase（CreateSession 的 outputPath/task 等），注意与 pi 工具入参命名一致，执行时以 `electron/main/agents/tools/` 实际 schema 为准
- [ ] 验证：让会话实际触发四组工具（或翻有历史调用的会话），确认收起/展开态与图标

## 实施回填（做完后填）

### 实际改动
- 与计划差异：
- 改动文件清单：

### 给下一步的接力棒
- 关键签名 / 数据结构：
- 下个 step 该从哪里继续：
- 待办或已知限制：
