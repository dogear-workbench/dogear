---
step: 3
title: 工具块路径按钮与专属渲染器
status: done
---

## 目标

write/edit 走新专属渲染器（常显路径 + 打开按钮，CodeChangeBlock 退役），Read/Glob/Grep/通用工具块的路径均可点击打开。

## 依赖上下文（接力棒输入）

- 前置 step 产出：Step 2 的 `PathText`/`PathChip`/`splitPathSegments`（`components/agent-chat/path-link.tsx`）与 `useWorkspaceId()`，本步直接复用
- 工具名现状：**pi 会话基础工具名小写**（read/write/edit/bash，builtin-tools.ts:14-23）；Glob/Grep 大写（search-tools.ts:95/134）；旧 SDK 历史会话是大写 Write/Edit/Bash
- 路由现状 `ContentBlockItem.tsx`：:199 `['Edit','Write','Bash'].includes(block.toolName)` 分发到 CodeChangeBlock（pi 小写名匹配不到，实际走通用 ToolBlock）；:168-198 Task* 特判
- 入参形状（双兼容要求）：
  - pi write：`{path, content}`，输出 `Successfully wrote ${n} bytes to ${path}`（相对路径原样）
  - pi edit：`{path, edits: [{oldText, newText}, ...]}`，输出 `Successfully replaced ${n} block(s) in ${path}.`
  - 旧 SDK：`{file_path, old_string/new_string}` / `{file_path, content}`
- `ToolBlock.tsx`：`normalizeToolName` :51-59 已做小写归一（仅图标/摘要用）；`getToolSummary` :104-110 Write/Edit 摘要取 `toolInput.file_path`（pi 用 path → 空）；专属 renderer 分发 :134-148（Read/Glob/Grep/Skill 在此注册）
- `tool-renderers/ToolDetailShell.tsx`：KeyValueList（:36-53 key-value 等宽）/ OutputBox（:55-73 纯文本 pre）
- 专属 renderer 现状：ReadRenderer 文件区 `file_path ?? path`（:15-22）；GlobRenderer 结果行相对路径逐行（:36-47）；GrepRenderer 命中行格式 `相对路径:行号: 内容`（:45-56，additionalPaths 根下是绝对路径——工作区外按统一规则不渲染按钮）
- `CodeChangeBlock.tsx` 全文：本步退役删除；其 openInline 用法（:48-97）由新渲染器吸收

## 计划改动

- [ ] 新建 `components/agent-chat/tool-renderers/FileChangeRenderer.tsx`：接收 tool_use block（含 toolInput/toolOutput/isError）
  - 入参归一：`path = toolInput.path ?? toolInput.file_path`；`content = toolInput.content`（write）；`edits = toolInput.edits ?? 由 old_string/new_string 合成`
  - 标题行常显：`路径（PathChip 可点） · 写入 N 字节 / 替换 N 处` + 状态图标（成功/失败）
  - 打开：write 用 `markdown-preview-store.openInline(fileName, content)`（快照语义零 IO）；edit 用 `open(workspaceId, resolvedPath, fileName)` 读盘
  - 展开态：输出文本（toolOutput）过 PathText
- [ ] `ContentBlockItem.tsx`：write/edit（大小写不敏感判断）路由到 FileChangeRenderer；Bash（含旧大写）改走通用 ToolBlock；删除 CodeChangeBlock import
- [ ] 删除 `components/agent-chat/CodeChangeBlock.tsx`（先全局搜引用确认无残留 import）
- [ ] `ToolBlock.tsx`：getToolSummary 摘要取 `file_path || path`；分发表注册 FileChangeRenderer（或 ContentBlockItem 层路由，与现有 Read/Glob/Grep 的分发层级保持一致——看代码现状选一致的位置）
- [ ] `ToolDetailShell.tsx`：KeyValueList 的 value 与 OutputBox 的文本过 PathText（覆盖 dogear__* 工具输出路径，如 `dogear__SaveMemory` 返回的记忆文件路径）
- [ ] `ReadRenderer.tsx`：文件区路径换 PathChip
- [ ] `GlobRenderer.tsx`：结果行换 PathChip（相对路径 resolve 后传）
- [ ] `GrepRenderer.tsx`：命中行解析 `路径:行号: 内容` 三段，路径部分 PathChip，其余原样（保持关键词高亮共存）

## 验证

1. 新会话让 AI 执行 write/edit：标题行显示路径与字节数/替换数，路径可点开浮窗（write 快照内容、edit 最新内容）
2. Read/Glob/Grep 工具块：路径全部可点打开
3. 旧 SDK 历史会话：大写 Write/Edit 消息渲染正常（FileChangeRenderer 双兼容）
4. Bash 工具块走通用 ToolBlock，输出路径被 PathText 增强
5. dogear__SaveMemory 等自定义工具输出中的路径可点
6. `bun run lint` 通过；无 CodeChangeBlock 残留引用

## 实施回填（做完后填）

### 实际改动
- 与计划差异：① FileChangeRenderer 注册在 ToolBlock specializedRenderer 层（step 允许的一致性选择，normalizeToolName 一处归一双覆盖 pi 小写与旧大写，ContentBlockItem 只做删除）；② 标题行 PathChip 未做——CollapsibleBlock 标题是 button，嵌 PathChip 属非法 HTML 嵌套，标题改为常显纯文本摘要「Write · foo.md · 写入 1.2 KB」+ 状态图标，chip 在展开态文件区；③ write 快照预览按钮限 md/markdown（沿用 CodeChangeBlock isMarkdown 先例）；④ Step 2 接力棒有误：useWorkspaceId 实际在 workspace-id-context.tsx 导出，path-link 只 import 未 re-export；⑤ formatByteSize/getEditCount 从 FileChangeRenderer 导出供 ToolBlock 摘要复用
- 改动文件清单：新建 `tool-renderers/FileChangeRenderer.tsx`（140 行）；`components/ToolBlock.tsx`（:17 导入、:88-100 摘要、:183-186 分发注册）；`ContentBlockItem.tsx`（删特判）；删 `CodeChangeBlock.tsx`；`tool-renderers/ToolDetailShell.tsx`（KeyValueList/OutputBox 过 PathText）；`ReadRenderer.tsx`/`GlobRenderer.tsx`/`GrepRenderer.tsx`（换 PathChip，Grep 三段解析 `HIT_LINE_RE` 失败降级整行）

### 给下一步的接力棒
- 关键签名 / 数据结构：渲染链路 ContentBlockItem（无特判）→ ToolBlock（normalizeToolName 归一，:183 分发）→ FileChangeRenderer（kind='write'|'edit'）；chip 判定三条件：`PREVIEW_EXT_RE.test(p) && (resolved = resolvePathInWorkspace(p, workspacePath)) && workspaceId`；自由文本统一过 PathText 或 OutputBox（内部已过）
- 下个 step 该从哪里继续：step4-image-multimodal.md（pi-session 丢图断点 + adapter images 透传 + GLM 实测，改主进程需 build:electron）
- 待办或已知限制：① GUI 手工回归待运行时实测（标题摘要/快照按钮/chip 视觉）；② PREVIEW_EXT_RE 在 4 个 renderer 各自重复定义，后续可从 path-link 统一导出；③ write 快照只覆盖 md（txt/json 无打开动作）；④ Bash 黑底命令框退役改通用渲染，GUI 回归留意观感
