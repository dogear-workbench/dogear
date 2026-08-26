---
step: 2
title: 路径按钮基础设施 + 正文挂载
status: done
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
- 与计划差异：① plan 全局决策写的 `useWorkspaceStore.getState().workspaces` 不存在（store 只有焦点单数 workspace），实现为 `useWorkspacePath` hook：焦点 id 匹配同步响应式取，否则模块级缓存 + `client.getAll()` IPC 拉全表（useSyncExternalStore 共享，WorkspaceSwitcherPopover/session-window 同款）；② 绝对路径同样要求白名单扩展名（设计文档渲染条件如此，`C:\ws\src\xx.ts` 纯文本）；③ 额外导出 `resolvePathInWorkspace`/`useWorkspacePath` 供 Step 3 复用；④ WorkspaceIdProvider value 为 `string | null`；⑤ 行内 code 识别收窄为「string children + 无 className + 不在 pre 内」
- 改动文件清单：新建 `components/agent-chat/workspace-id-context.tsx`（Provider + useWorkspaceId）、`components/agent-chat/path-link.tsx`（:9 PathSegment、:16-18 三个正则、:20 resolvePathInWorkspace、:51 splitPathSegments、:79 useWorkspacePath、:115 PathChip、:141 PathText）；`AgentChat.tsx`（:27 导入、:360/:572 Provider 包顶层）；`MarkdownRenderer.tsx`（:27-38 wrapChildren 全量走 PathText、:40-66 CodeBlockContext+CodeWithPath+MarkdownCode、:121 pre 内 Provider 标记、code 注册）

### 给下一步的接力棒
- 关键签名 / 数据结构：`splitPathSegments(text, workspacePath): PathSegment[]`，`PathSegment = { type: 'text'|'path'; text; resolved?; fileName? }`（path 段 resolved 是 posix 风格绝对路径，可直接传 open()）；`resolvePathInWorkspace(candidate, workspacePath): string | null`；`PathChip({ text, resolved, fileName?, workspaceId })` 点击内置 open；`PathText({ text, searchQuery?, matchIdPrefix?, activeMatchId? })`；`useWorkspaceId()` + `useWorkspacePath(workspaceId)`——AgentChat 已包 Provider，ContentBlockItem/ToolBlock/tool-renderers 子树直接消费，无 Provider 时自动降级纯文本
- 下个 step 该从哪里继续：step3-tool-renderers.md 计划改动段；分发入口 `ContentBlockItem.tsx:199`（大小写不敏感路由）与 `ToolBlock.tsx:134-148`；getToolSummary 摘要取 `file_path || path`
- 待办或已知限制：① 搜索高亮 matchId 偏移在含路径段落进一步近似错位（跳转有 if(el) 守卫不崩溃，plan 拍板取舍）；② workspacePathsCache 无失效（新建工作区后非焦点旧 tab 查不到，低频接受）；③ 不支持含空格路径（设计文档排除项）；④ td/th 不做路径识别（与原高亮范围一致）；⑤ GUI 手工回归留待 step3/4 完成后统一实测
