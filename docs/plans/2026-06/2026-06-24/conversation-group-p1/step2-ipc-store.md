---
step: 2
title: IPC + Group Store
status: done
---

## 目标

把 Step 1 的 group-service 暴露到前端：IPC 路由 + Zustand store。**完成后前端能 list/create/update/delete 组，但 UI 还没改造**（仍走旧 ConversationList）。

## 依赖上下文（执行时填）

- 前置 step 产出：[step1] group-service 关键签名 / conversation-service 新签名 / migrate 入口
- 当前关键文件状态：执行前读 `electron/main/tipc/index.ts`（聚合路由）/ `electron/main/tipc/conversations.ts`（参考路由风格）/ `stores/conversation-store.ts`（参考 store 风格）
- 关键决策回顾：见 plan.md「全局决策」一节，store 命名 `xxx-store.ts`，IPC 返回 `{ ok, error? }` 包装

## 计划改动

### IPC 路由
- 新增 `electron/main/tipc/group.ts`：
  - `listGroups({ workspaceId })`
  - `getGroup({ workspaceId, groupId })`
  - `createGroup({ workspaceId, title? })`
  - `updateGroup({ workspaceId, groupId, patch })`
  - `deleteGroup({ workspaceId, groupId })`：注意要校验组内是否还有 conversation——P1 阶段简单实现：组内有 conversation 时拒绝删除（让用户先把会话清掉或后续 P2 加级联）
  - `addReference({ workspaceId, groupId, path, label? })`
  - `removeReference({ workspaceId, groupId, refId })`
- 修改 `electron/main/tipc/index.ts` 注册新路由
- 修改 `electron/main/tipc/conversations.ts`：
  - `createConversation` 必须带 `groupId`（前端不传时 IPC 报错）
  - 删除 conversation 时**不**联动删 group（避免误删）

### 前端 Store
- 新增 `stores/group-store.ts`：
  - state: `groups: Group[]` / `currentGroupId: string | null` / `expandedGroupIds: Set<string>` / `loading: boolean`
  - actions: `load(workspaceId)` / `setCurrentGroup(groupId)` / `toggleExpand(groupId)` / `createGroup(title?)` / `updateGroup(groupId, patch)` / `deleteGroup(groupId)` / `addReference(...)` / `removeReference(...)`
  - 跨 store 依赖：与 conversation-store 之间用 `await import()` 延迟导入（避免循环）

### Conversation Store 适配
- 修改 `stores/conversation-store.ts`：
  - `createConversation` 签名加 `groupId` 参数
  - 选中 conversation 时同步 `groupStore.setCurrentGroup(conv.groupId)`
  - 列表加载后按 `groupId` 给前端建索引（方便 group list 渲染时按 group 聚合）

### 类型同步
- `types/electron-api.ts` 的 `Conversation` 接口（Step 1 已加 groupId 等字段）确认前端类型可见

## 验证

- `bun run build:electron` / `bun run lint` 通过
- `bun run dev` 启动后：
  - 浏览器控制台手动调 `client.listGroups({ workspaceId })` 能返回数组
  - 手动 `client.createGroup({ workspaceId, title: 'test' })` 能创建，再 list 能看到
  - 选中一个旧 conversation 后 group-store 的 currentGroupId 跟着变（DevTools 看）
  - 列表 UI 没改，所有现有功能照常

## 实施回填（做完后填）

### 实际改动

与计划基本一致，差异点：
- `addReference` 在 group-service 的入参类型从 `Omit<SharedReference, 'id'|'addedAt'>`（非分配，会丢辨识）改为分配性 `SharedReferenceInput` 局部类型，保留 discriminated union 行为
- `deleteGroup` 的组内对话校验使用 `conversationService.getByWorkspaceId(wsId, { includeArchived: true })` 过滤 `groupId === input.groupId`，含归档对话一起算
- IPC 的 `addReference` 用 `refType: 'file'` 区分（P1 阶段强制 'file'），为 P2 扩展 conversation/article 留接口位

改动文件清单：
1. `electron/main/tipc/group.ts` — 新增 groupRouter（list/get/create/update/delete + addReference/removeReference）
2. `electron/main/tipc/index.ts` — 注册 groupRouter
3. `electron/main/services/group-service.ts` — addReference 入参改 `SharedReferenceInput`
4. `stores/group-store.ts` — 新增 useGroupStore
5. `stores/conversation-store.ts` — loadConversations 末尾 fire-and-forget 加载 groups；selectConversation 末尾同步 currentGroupId

### 给下一步的接力棒

- group-store API（`stores/group-store.ts`）：
  - `useGroupStore.getState().load(workspaceId): Promise<void>`
  - `setCurrentGroup(groupId: string | null): void`
  - `toggleExpand(groupId: string): void`
  - `createGroup(title?: string): Promise<Group | null>`
  - `updateGroup(groupId, patch): Promise<void>`
  - `deleteGroup(groupId): Promise<void>`
  - `addReference(groupId, path, label?): Promise<SharedReference | null>`
  - `removeReference(groupId, refId): Promise<void>`
- group IPC API（`electron/main/tipc/group.ts`）：
  - `client.listGroups({ workspaceId }) → { groups, error? }`
  - `client.getGroup({ workspaceId, groupId }) → { group, error? }`
  - `client.createGroup({ workspaceId, title? }) → { group, error? }`
  - `client.updateGroup({ workspaceId, groupId, patch }) → { group, error? }`
  - `client.deleteGroup({ workspaceId, groupId }) → { ok, error? }`（组内有对话时拒绝）
  - `client.addReference({ workspaceId, groupId, refType: 'file', path, label? }) → { reference, error? }`
  - `client.removeReference({ workspaceId, groupId, refId }) → { ok, error? }`
- conversation-store 联动：选中对话时自动同步 `useGroupStore.currentGroupId`；加载对话列表时 fire-and-forget 预热组列表
- 待办或已知限制：
  - addReference 的 IPC 入参用 `refType: 'file'`（P1 锁定 file），P2 扩展时需要改成 discriminated input
  - group-store 没订阅 `categoriesUpdated`/会话列表事件之类的广播；目前依赖 conversation-store.load 时手动拉
  - 没有内置事件广播 `groupsChanged`（多窗口同步要等 Step 4/5 之后再补）
