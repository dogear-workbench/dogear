---
step: 1
title: 数据层地基
status: done
---

## 目标

类型定义 + group-service 完整 CRUD + conversation 加 groupId 字段 + 启动时自动迁移旧数据为单会话组。**完成后未启用任何 UI，但 .dogear 里能看到 groups.json，所有现有 conversation 都带上 groupId**。

## 依赖上下文（执行时填）

- 前置 step 产出：无（首步）
- 当前关键文件状态：（执行前读 `types/electron-api.ts` 的 Conversation 类型 / `electron/main/services/conversation-service.ts` 的 CRUD 函数 / `electron/main/types.ts` 的镜像类型）
- 关键决策回顾：见 plan.md「全局决策」一节

## 计划改动

### 类型定义
- 新增 `types/group.ts`：
  - SharedReference 用 **discriminated union**（schema 一开始就支持扩展，P1 只实现 file）：
    ```ts
    interface SharedReferenceBase { id: string; addedAt: number; label?: string }
    type SharedReference =
      | (SharedReferenceBase & { type: 'file'; path: string })             // P1 实现
      | (SharedReferenceBase & { type: 'conversation'; conversationId: string })  // P2+ 扩展
      | (SharedReferenceBase & { type: 'article'; articleId: string })            // P2+ 扩展
    ```
  - `interface Group { id: string; title?: string; createdAt: number; updatedAt: number; sharedReferences: SharedReference[] }`
- 修改 `types/electron-api.ts` 的 `Conversation` 接口加字段：
  - `groupId: string`（强制）
  - `parentConversationId?: string`（仅 sub 才有）
  - `role: 'main' | 'sub'`（**主/子判定规则**：用户手动创建 = main，agent 调 DelegateTo 创建 = sub。P1 阶段实际产生 main，sub 是 P2 的事）
- 在 `electron/main/types.ts` 镜像 `Group` 和上述新字段

### 服务层
- 新增 `electron/main/services/group-service.ts`：
  - `listGroups(workspaceId: string): Promise<Group[]>`
  - `getGroup(workspaceId: string, groupId: string): Promise<Group | null>`
  - `createGroup(workspaceId: string, init?: Partial<Group>): Promise<Group>`
  - `updateGroup(workspaceId: string, groupId: string, patch: Partial<Group>): Promise<Group>`
  - `deleteGroup(workspaceId: string, groupId: string): Promise<void>`
  - `addReference(workspaceId, groupId, ref: Omit<SharedReference,'id'|'addedAt'>): Promise<SharedReference>`
  - `removeReference(workspaceId, groupId, refId): Promise<void>`
  - 内部用 safe-json，路径 `<configDir>/workspaces/<wsId>/groups.json`

### Conversation Service 扩展
- 修改 `electron/main/services/conversation-service.ts`：
  - `create` / `createFork` 函数签名加 `groupId` 必填参数
  - 读取时如果旧数据没有 `groupId`，**不要在 read 时补**——交给迁移逻辑统一处理
  - 新增导出 `migrateOrphanConversations(workspaceId): Promise<number>`：扫一遍当前 workspace 下所有无 groupId 的 conversation，每个 createGroup（title 用 conversation.title）+ 写回 groupId，返回迁移条数

### 迁移触发
- 修改 `electron/main/index.ts`（或现有的应用启动 init 流程）：
  - 应用启动时对每个 workspace 调一次 `migrateOrphanConversations`
  - 日志输出迁移条数（便于排错）
  - 迁移幂等：第二次启动应该返回 0

## 验证

- `bun run build:electron` 无报错
- `bun run lint` 通过
- `bun run dev` 启动后：
  - `.dogear/workspaces/<wsId>/groups.json` 自动生成，每个旧 conversation 对应一个 group
  - 旧 conversation 在 `conversations.json` 里都带上了 groupId
  - 列表 UI 没改，所有现有功能照常（打开旧会话、发消息）
  - 第二次启动迁移日志显示"0 conversations migrated"

## 实施回填（做完后填）

### 实际改动

与计划基本一致，差异点：
- `ConversationIndex` 的 `groupId` 和 `role` 字段定义为可选（`groupId?: string; role?: 'main' | 'sub'`），老数据迁移前可能缺失，toCompat 输出时用 `?? ''` / `?? 'main'` 兜底，前端 `Conversation`（ConversationList.tsx 本地类型）也设为可选
- `types/electron-api.ts` 的 `Conversation` 接口已加 `groupId: string` 和 `role: 'main' | 'sub'`（强制非空，按 spec）
- `components/ConversationList.tsx` 本地 `Conversation` 接口同步加了 `groupId?` 和 `role?`（可选），避免破坏现有创建对象的代码

改动文件清单：
1. `types/group.ts` — 新增（SharedReferenceBase / SharedReference / Group）
2. `electron/main/types.ts` — 末尾追加会话组镜像类型
3. `types/electron-api.ts` — Conversation 接口加 groupId / role
4. `components/ConversationList.tsx` — 本地 Conversation 接口加 groupId? / role?
5. `electron/main/services/conversation-service.ts` — ConversationIndex 加字段、ConversationCompat 加字段、create/createFork 签名加 groupId 参数、toCompat 输出加字段、新增 migrateOrphanConversations
6. `electron/main/services/group-service.ts` — 新增完整 CRUD
7. `electron/main/tipc/conversations.ts` — create/createFork handler 更新，import groupService
8. `electron/main/services/wechat/wechat-bot-controller.ts` — cmdNewConversation 加 createGroup 前置
9. `electron/main/index.ts` — whenReady 追加会话组迁移块

### 给下一步的接力棒

- group-service 关键签名：
  - `createGroup(workspaceId, init?: { title?: string }): Promise<Group>`
  - `listGroups(workspaceId): Promise<Group[]>`
  - `getGroup(workspaceId, groupId): Promise<Group | null>`
  - `updateGroup(workspaceId, groupId, patch): Promise<Group>`
  - `deleteGroup(workspaceId, groupId): Promise<void>`
  - `addReference(workspaceId, groupId, ref): Promise<SharedReference>`
  - `removeReference(workspaceId, groupId, refId): Promise<void>`
- conversation-service 新签名：
  - `create(workspaceId, groupId, title?, modelSelection?): Promise<string>`
  - `createFork(workspaceId, groupId, title, parentConversationId, forkMessageSdkUuid, modelSelection?, cachePolicy?): Promise<string>`
  - `migrateOrphanConversations(workspaceId): Promise<number>`
- 迁移函数入口：`electron/main/index.ts` whenReady 中在 migrateFromLegacy 之后调用
- 待办或已知限制：group-service 的 CRUD 尚未暴露为 tipc IPC，Step 2 需要新增 `electron/main/tipc/groups.ts` 并在 `tipc/index.ts` 注册
