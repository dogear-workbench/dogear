---
step: 1
title: openTab 改用运行时工作区 id
status: done
---

## 目标

会话打开链路不再信任记录内 `workspaceId` 字段，一律使用运行时工作区上下文的 id，同步过来的会话立即可打开。

## 依赖上下文（接力棒输入）

- 根因事实：同步合并使 `workspaces/572b768f…/conversations.json` 内 1171/1173 条记录的 `workspaceId` 字段是 Mira 的 `db291a2d…`；`openTab(conv.id, title, conv.workspaceId)` 把 tab 绑到错误工作区，attach 时 `getById('db291a2d', …)` 读镜像文件返回 null → `Conversation not found`。
- `useSessionStore.openTab(conversationId, title, workspaceId)` 三参签名见 `stores/session-store.ts:97`；`AgentChat` 的 `workspaceId` prop 来自 `tab.workspaceId`（`app/page.tsx:417`）。
- 主进程 `conversationService.getById(workspaceId, id)` 按第一参读 `workspaces/<wsid>/conversations.json`，文件直读无缓存（`electron/main/services/conversation-service.ts:216`）。

## 计划改动

- [ ] `components/conversation-list/utils.ts:64-73` `openOrFocusConversation`：`openTab` 第三个参数改为 `useWorkspaceStore.getState().workspace?.id ?? ''`（import 已有的 store）。
- [ ] `components/conversation-list/utils.ts:79-86` `openPersonalConversation`：同样不取 `conv.workspaceId`，改用 personal 常量（与 `PERSONAL_WORKSPACE_ID` 对齐，前端已有等价常量则复用，没有就字面量 `'personal'` 加注释）。
- [ ] 全量审计读点：`grep -rn "\.workspaceId" components/ stores/ app/ hooks/ --include="*.ts" --include="*.tsx"`，逐个判断——事件载荷（`sessionWindowClosed`、`focusConversation`，来自主进程、有工作区存在性校验）保留；凡从**会话记录对象**上取该字段用于路由/开 tab 的，全部改为运行时上下文。已知可疑点：`components/agent-chat/AgentCommCard.tsx`、`components/NotificationCenter.tsx`（都经 `openOrFocusConversation`，改完自动覆盖，确认无独立调用即可）。
- [ ] `stores/conversation-store.ts:305/484` 的 `attachConversationRuntime` 调用确认传的是 workspace-store 的 id（若已是则不动）。

## 验证

- `bun run build`（或 tsc typecheck）通过。
- 重启 app，点击此前报 `Conversation not found: afef0bb0…` 的同步会话（如「Step 4: UI——寻找按钮 + 离线常驻卡片」）→ 正常打开、历史可见。归档话题下会话仍走归档页（设计内，不算失败）。

## 实施回填（做完后填）

### 实际改动
- 与计划差异：
  - 审计中发现计划未列出的第三个路由读点：`stores/conversation-store.ts` `forkConversation` 里 `client.createFork({ workspaceId: parentConv.workspaceId })` 从父会话记录取 wsid 路由 fork 写入位置，改为 `workspace.id`（同函数上游 getById 已用 workspace.id 查询，语义对齐）。
  - 其余读点逐一确认：NotificationCenter（entry.workspaceId 为主进程通知载荷，有 findWorkspace/findConversationById 存在性校验，最终经 openOrFocusConversation 开 tab，自动覆盖）；TopicPanel/workspace-store/notes-store/page.tsx:162 均主进程事件载荷保留；ToolBlock/path-link 用 useWorkspaceId() 运行时 hook；MessageItem:434「跨工作区」标签与 ConversationRow:239 引用快照为展示/信息性用途，且 Step 3 落地归一后会话记录字段已归本机，自动正确；conversation-store.ts:305/484 两处 attachConversationRuntime 已分别传 PERSONAL_WORKSPACE_ID 常量与 workspace.id，无需改动。
- 改动文件清单：
  - `components/conversation-list/utils.ts`（openOrFocusConversation 改 workspace-store 运行 id；openPersonalConversation 改 PERSONAL_WORKSPACE_ID 常量）
  - `stores/conversation-store.ts`（forkConversation 的 createFork 改 workspace.id）

### 给下一步的接力棒
- 关键签名 / 数据结构：openTab(conversationId, title, workspaceId) 三参不变；PERSONAL_WORKSPACE_ID 在 `types/workspace.ts:11`。
- 下个 step 该从哪里继续：Step 2 模型回退，`pi-session.ts` start() 的 resolvePiModel 段。
- 待办或已知限制：重启 app 后点击同步会话验证（人工）；归档话题下会话走归档页属设计内。
