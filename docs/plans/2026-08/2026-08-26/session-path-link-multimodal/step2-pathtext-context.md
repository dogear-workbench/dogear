---
step: 2
title: 路径按钮基础设施 + 正文挂载
status: pending
---

## 目标

新建 PathText 路径识别组件与 WorkspaceIdContext，在 MarkdownRenderer 正文/行内代码中渲染可点击路径胶囊，点击弹 md 预览浮窗。

## 依赖上下文（接力棒输入）

- 前置 step 产出：无强依赖（Step 1 独立），但共享 Step 1 之后的 utils/types/MessageItem 现状
- `components/MarkdownRenderer.tsx`：ReactMarkdown + remarkGfm + rehypeHighlight（:121-126）；`wrapChildren`（:27-37）对 p/li 的 string 子节点做搜索高亮——本步在该入口叠加路径识别（注意与高亮逻辑共存，别互吃）；`a` 标签点击拦截先例（:96-108）
- `stores/markdown-preview-store.ts` :15-30：`open(workspaceId, filePath, fileName)` 读盘模式（绝对路径可直接传，主进程 resolveAndValidate 只要求落在 workspace.path 内）；消费组件 `components/MarkdownFileDialog.tsx` 已挂 `app/page.tsx:368` 全局唯一
- workspace 数据：`stores/workspace-store.ts` 的 `workspaces` 列表（`{id, name, path}`）
- Context 先例：`components/agent-chat/conversation-id-context.tsx`（3 行小文件，照抄结构）
- 真实路径形态（实测会话 JSONL）：agent 用相对路径（`docs/plans/2026-08/xx/plan.md`），工具输出 `Successfully wrote N bytes to docs/...` 同为相对
- 关键决策回顾：识别规则与渲染条件见 plan.md「全局决策」第 1 条；不放开工作区边界（additionalPaths/configDir 工作区外路径纯文本）

## 计划改动

- [ ] 新建 `components/agent-chat/workspace-id-context.tsx`：`WorkspaceIdProvider` + `useWorkspaceId()`
- [ ] 新建 `components/agent-chat/path-link.tsx`：导出 `PathText`（props：`{ text: string }`，内部 useWorkspaceId + workspace-store 查根路径；纯函数 `splitPathSegments(text, workspacePath)` 做识别切分，同文件导出供 Step 3 复用）与 `PathChip`（单路径胶囊，点击 `useMarkdownPreviewStore.getState().open(...)`，样式参考引用芯片：等宽小字 + FileText 图标 + hover 高亮）
- [ ] `AgentChat.tsx`：顶层包 `WorkspaceIdProvider`（props.workspaceId）
- [ ] `MarkdownRenderer.tsx`：p/li 的 string 子节点处理叠加 PathText（wrapChildren 内先切路径再对剩余文本做高亮）；行内 code（反引号）内容若是路径形态（含分隔符 + 白名单扩展名或绝对路径）也渲染为胶囊

## 验证

1. 让 AI 回复一段含工作区内相对路径（`docs/.../*.md`）、行内代码路径、工作区外路径（`C:\Windows\xx.md`）、非白名单扩展名（`src/xx.ts`）的文本：前三类中「工作区内 + 白名单」渲染胶囊，其余纯文本
2. 点胶囊 → MarkdownFileDialog 浮窗打开正确内容；关掉再点另一路径正常
3. 多工作区 tab：在 A 工作区会话里点 B 工作区不存在的同相对路径 → 不渲染按钮（会话工作区为判定基准）
4. 搜索高亮功能回归：Ctrl+F 高亮仍正常（不被 PathText 吃掉）

## 实施回填（做完后填）

### 实际改动
- 与计划差异：
- 改动文件清单：

### 给下一步的接力棒
- 关键签名 / 数据结构：
- 下个 step 该从哪里继续：
- 待办或已知限制：
