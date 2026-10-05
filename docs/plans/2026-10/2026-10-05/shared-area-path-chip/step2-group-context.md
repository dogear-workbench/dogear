---
step: 2
title: groupId 上下文与校验链贯通
status: pending
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

- [ ] `electron/main/tipc/explorer.ts` checkPathsExist 入参加可选 `groupId?: string`，命中时 `const roots = getEnabledRoots(workspace); if (input.groupId) roots.push(await groupSharedService.getSharedDir(input.workspaceId, input.groupId))`（getSharedDir 自带 mkdir -p，无副作用问题）；import group-shared-service
- [ ] `path-link.tsx` 新增 `useSharedRoot(groupId: string | null): string | null`：模块级 `sharedRootsCache: Map<groupId, string>` + external store（照抄 `useWorkspaceRoots` 的 workspacePathsCache 模式），经 `client.listGroupFiles`（已有 IPC，返回 `sharedDir`）或加轻量 procedure 拉取——优先复用 listGroupFiles，避免新 IPC
- [ ] `path-link.tsx` 校验链加 groupId 维度：`useExistenceResolved(workspaceId, candidates, groupId?)`、existenceCache key 加 groupId 段、`requestExistence`/`flushExistenceChecks` 分组键改为 `${workspaceId}\n${groupId ?? ''}` 且 IPC 调用带 groupId；`GatedPathChip` 加 `groupId?: string` prop 透传；`PathChip` 加 `groupId?: string` prop（本步仅接收，onClick 消费在 step3）
- [ ] `MarkdownRenderer.tsx`：`renderPathSegments` / `a` 渲染器里的 GatedPathChip/PathChip 传 groupId——经新可选 prop `sharedGroupId?: string` 透传（与 extraRoots 配对）
- [ ] `workspace-id-context.tsx` 扩展：Provider 值加 `groupId?: string | null`，新增 `useGroupId()`；AgentChat 挂 Provider 处从会话对象取 `groupId`（定位：AgentChat 内 selectConversation / conversation prop，实施时确认）
- [ ] `MessageItem.tsx` / `ContentBlockItem.tsx` / `shunt-suggestions.tsx`：取 `useGroupId()` → `useSharedRoot(groupId)` → 以 `extraRoots={[sharedRoot]}` + `sharedGroupId={groupId}` 传给 MarkdownRenderer/ShuntAwareMarkdown（sharedRoot 为 null 时不传）

## 实施回填（做完后填）

### 实际改动
- 与计划差异：
- 改动文件清单：

### 给下一步的接力棒
- 关键签名 / 数据结构：
- 下个 step 该从哪里继续：
- 待办或已知限制：

## 验收

- 会话（有组）正文出现共享区真实文件名（`20261005-xxx.md`）→ 渲染成胶囊，hover title 显示 `.dogear/.../shared/` 绝对路径
- 跨组不串：另一组正文里同名文件不存在时纯文本
- 无组上下文场景（笔记卡）行为与 step1 一致
- `bun run lint` 0 errors、前端 tsc 全绿、`bun run build:electron` 通过（动了主进程）
