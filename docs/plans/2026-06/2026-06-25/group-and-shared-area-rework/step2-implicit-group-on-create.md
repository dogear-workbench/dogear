---
step: 2
title: 新建对话即隐式建组
status: done
---

## 目标

把「新建对话 = 先建组 + 在组内建第一条对话」做成单一动作。删掉 Toolbar 上独立的「新建会话组」按钮（FolderPlus）。

## 依赖上下文（接力棒输入）

- 前置 step：Step 1（bug 修复独立完成，无数据依赖）
- 关键现状：
  - `stores/conversation-store.ts:393` `newConversation` 现在直接 `client.create({ workspaceId })` 不传 groupId → 创建无组对话
  - `stores/group-store.ts:57` `createGroup` 已存在，签名 `createGroup(title?: string) => Promise<Group | null>`
  - `electron/main/tipc/conversations.ts` 的 `create` 已支持 `groupId` 参数（Toolbar.handleNew 走的就是这条）
  - `components/conversation-list/Toolbar.tsx:14` `handleNew` 当前按 `currentGroupId` 分流（有组就 IPC create+groupId，无组就调 store.newConversation）
- 关键决策回顾：组保留但视觉上始终套层卡片（Step 3 处理视觉），所以每个新对话必属于一个组。

## 计划改动

- [ ] `stores/conversation-store.ts:393` `newConversation`：内部改成
  1. 先调 `useGroupStore.getState().createGroup()`（不传 title）拿到 group
  2. 失败 → toast 报错 return
  3. `client.create({ workspaceId, groupId: group.id })`
  4. 其余流程不变（getById → selectConversation → loadConversations）
  - 注意：避免循环依赖，沿用 `import('./group-store')` 延迟导入模式（line 334 那种）
- [ ] `components/conversation-list/Toolbar.tsx`：
  - 删 `handleNewGroup` 和 FolderPlus 按钮
  - `handleNew` 简化：永远调 `newConversation()`（不再分流 currentGroupId，因为新建对话就是新建组）
  - 删 `currentGroupId` 订阅
- [ ] `components/group-list/GroupCard.tsx:60` `handleNewConversation`：保持现有逻辑（在已有组内 IPC create+groupId），下个 step 会把它绑到组卡片右侧 `+` 按钮

## 验证

- 点 Toolbar 顶部「新建对话」按钮 → 列表自动出现一张新组卡片，里面挂着新对话；该对话被选中并打开 Tab
- 顶部不再有 FolderPlus 按钮
- 重复点 N 次 → 出现 N 张组卡片，每张一个对话
- `bun run build && bun run lint` 通过

## 实施回填（做完后填）

### 实际改动

- `stores/conversation-store.ts` `newConversation`：动态 import `./group-store`，先 `createGroup()` 拿到 group，失败直接 return（createGroup 内部已 toast），再调 `client.create({ workspaceId, groupId: group.id })`，其余流程不变
- `components/conversation-list/Toolbar.tsx`：完全重写为单一「新建对话」按钮，删 `handleNewGroup` / `FolderPlus` / `currentGroupId` 订阅 / 分流逻辑

### 给下一步的接力棒

- `newConversation` 现在保证每个对话都有 groupId
- Toolbar 已纯化（只剩一个 Plus 按钮 + outline 样式），Step 3 把建组入口移到 GroupCard 头部 `+` 按钮即可
- `GroupCard.handleNewConversation` 现有逻辑（line 60）一字不动可直接复用
