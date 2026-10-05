---
step: 2
title: groupId 上下文与校验链贯通
status: done
---

## 目标

会话组上下文贯通渲染链：聊天正文里共享区文件纯文件名 / 相对形式经 extraRoots 识别 + 带 groupId 的存在性校验通过，渲染成胶囊（本步结束时点击预览仍读不了盘，属已知中间态，step3 收口）。

## 依赖上下文（接力棒输入）

- 前置 step 产出：[step1-token-style.md] MarkdownRenderer 已有 `extraRoots?: string[]` prop 且行内 code 脱壳已就位；单段文件名已进识别管道
- 当前关键文件状态：
  - `components/agent-chat/workspace-id-context.tsx` — WorkspaceIdProvider / useWorkspaceId，AgentChat 挂载
  - `components/agent-chat/path-link.tsx` — `useExistenceResolved(workspaceId, candidates)`、existenceCache key `${workspaceId}\n${path}`、批量聚合 flush 按 workspaceId 分组调 `client.checkPathsExist({workspaceId, paths})`
  - `electron/main/tipc/explorer.ts:133` checkPathsExist procedure 入参 `{workspaceId, paths}`，roots 来自 `getEnabledRoots(workspace)`
  - `stores/conversation-store.ts:446` 附近 — 会话对象有 `conversation.groupId`
- 关键决策回顾：前端只传 groupId、sharedDir 主进程算；无组上下文场景行为与现状一致（全可选参数）

## 计划改动

- [x] `electron/main/tipc/explorer.ts` checkPathsExist 入参加可选 `groupId?: string`，命中时 `const roots = getEnabledRoots(workspace); if (input.groupId) roots.push(await groupSharedService.getSharedDir(input.workspaceId, input.groupId))`（getSharedDir 自带 mkdir -p，无副作用问题）；import group-shared-service
- [x] `path-link.tsx` 新增 `useSharedRoot(groupId: string | null): string | null`：模块级 `sharedRootsCache: Map<groupId, string>` + external store（照抄 `useWorkspaceRoots` 的 workspacePathsCache 模式），经 `client.listGroupFiles`（已有 IPC，返回 `sharedDir`）或加轻量 procedure 拉取——优先复用 listGroupFiles，避免新 IPC
- [x] `path-link.tsx` 校验链加 groupId 维度：`useExistenceResolved(workspaceId, candidates, groupId?)`、existenceCache key 加 groupId 段、`requestExistence`/`flushExistenceChecks` 分组键改为 `${workspaceId}\n${groupId ?? ''}` 且 IPC 调用带 groupId；`GatedPathChip` 加 `groupId?: string` prop 透传；`PathChip` 加 `groupId?: string` prop（本步仅接收，onClick 消费在 step3）
- [x] `MarkdownRenderer.tsx`：`renderPathSegments` / `a` 渲染器里的 GatedPathChip/PathChip 传 groupId——经新可选 prop `sharedGroupId?: string` 透传（与 extraRoots 配对）
- [x] `workspace-id-context.tsx` 扩展：Provider 值加 `groupId?: string | null`，新增 `useGroupId()`；AgentChat 挂 Provider 处从会话对象取 `groupId`（定位：AgentChat 内 selectConversation / conversation prop，实施时确认）
- [x] `MessageItem.tsx` / `ContentBlockItem.tsx` / `shunt-suggestions.tsx`：取 `useGroupId()` → `useSharedRoot(groupId)` → 以 `extraRoots={[sharedRoot]}` + `sharedGroupId={groupId}` 传给 MarkdownRenderer/ShuntAwareMarkdown（sharedRoot 为 null 时不传）（实际由 ShuntAwareMarkdown 一处贯通，前两文件零改动）

## 实施回填（做完后填）

### 实际改动
- 与计划差异：
  - 渲染链透传改为 context 方式：`ShuntAwareMarkdown` 一处取 `useGroupId()`/`useSharedRoot()` 传给 MarkdownRenderer，`MessageItem`/`ContentBlockItem` 无需改动（两者只经 ShuntAwareMarkdown 渲染 markdown，且都在 Provider 树内）
  - `PathChip` 的 `groupId` 仅类型接收、不解构（eslint no-unused-vars 拦截未消费解构），step3 解构后进 handleClick 消费
  - `PathText`（ToolDetailShell 工具详情场景）顺带贯通 sharedRoot + groupId，非计划内但零风险
  - 主会话验收发现遗漏已修：`MarkdownRenderer.tsx` `a` 渲染器内 `useExistenceResolved` 首版漏传 groupId（md 链接指向共享区文件永远校验不过），已补第三参 `sharedGroupId`
  - IPC 实际名是 `client.listSharedFiles`（计划写的 listGroupFiles 不存在），返回 `{ files, sharedDir }`；失败/无共享区缓存空串避免重复拉取
- 改动文件清单：
  - `electron/main/tipc/explorer.ts` — checkPathsExist 入参加 `groupId?: string`，命中时 roots 末尾 push `groupSharedService.getSharedDir(...)`（自带 mkdir -p）
  - `components/agent-chat/workspace-id-context.tsx` — Provider 加 `groupId?: string | null`，新增 `useGroupId()`
  - `components/agent-chat/AgentChat.tsx` — Provider 传 `groupId={currentConversation?.groupId ?? null}`
  - `components/agent-chat/path-link.tsx` — `useSharedRoot(groupId)`（模块级缓存 + external store，照 useWorkspaceRoots 模式）；existenceCache key `${workspaceId}\n${groupId ?? ''}\n${path}`；flush 分组键 `${workspaceId}\n${groupId ?? ''}` 且 IPC 带 groupId；`GatedPathChip` 加 groupId 透传；`PathChip` 加 groupId 类型；`PathText` 贯通
  - `components/MarkdownRenderer.tsx` — 新 prop `sharedGroupId?: string`，renderPathSegments/code/a 三处胶囊都传
  - `components/agent-chat/shunt-suggestions.tsx` — ShuntAwareMarkdown 取 context → `extraRoots`（useMemo 稳定引用，null 时 undefined）+ `sharedGroupId` 传 MarkdownRenderer
- 自验：`bun run lint` 0 errors；tsc 仅存量错误（app/data-center/sync-user-paths.tsx:20）；`bun run build:electron` 通过

### 给下一步的接力棒
- 关键签名 / 数据结构：
  - `useSharedRoot(groupId: string | null): string | null`（path-link.tsx）
  - `useExistenceResolved(workspaceId, candidates, groupId?)`
  - `GatedPathChip`/`PathChip`/`MarkdownRenderer` 均已带 `groupId`/`sharedGroupId` 可选 prop
  - `WorkspaceIdProvider` 已挂 `conversation.groupId`，组件树内 `useGroupId()` 直接取
- 下个 step 该从哪里继续：PathChip 解构 `groupId` → handleClick 兜底校验 IPC 带 groupId → `markdownPreviewStore.open(..., groupId)` → MarkdownFileDialog `readFile({ workspaceId, path, groupId })` → explorer.ts `readFile` procedure 加 groupId 拼 roots（与 checkPathsExist 同模式，已留好 import）
- 待办或已知限制：PathChip 点击共享区文件目前报「文件不存在」（handleClick 未带 groupId，step3 收口）；裸文本绝对路径含空格截断为既有局限未解

## 验收

- 会话（有组）正文出现共享区真实文件名（`20261005-xxx.md`）→ 渲染成胶囊，hover title 显示 `.dogear/.../shared/` 绝对路径
- 跨组不串：另一组正文里同名文件不存在时纯文本
- 无组上下文场景（笔记卡）行为与 step1 一致
- `bun run lint` 0 errors、前端 tsc 全绿、`bun run build:electron` 通过（动了主进程）
