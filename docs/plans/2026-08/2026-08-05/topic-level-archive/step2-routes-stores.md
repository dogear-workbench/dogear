---
step: 2
title: TIPC 路由与前端状态切换
status: pending
---

## 目标

以话题级 RPC 驱动归档、恢复和删除，使活跃会话列表不会再混入归档话题或按会话归档。

## 依赖上下文（接力棒输入）

- 前置 step 产出：统一话题生命周期协调层负责物理删除和迁移；不得在路由层复制清理逻辑。
- 当前单会话归档 RPC 为 `electron/main/tipc/conversations.ts:171`、`:183`、`:196`；前端删除分流位于 `stores/conversation-store.ts:413`。
- 当前 `groupRouter.deleteGroup` 会拒绝有会话的组，见 `electron/main/tipc/group.ts:60`；这与目标的“删除话题级联删除会话”冲突。
- 活跃对话加载由 `conversationsRouter.getByWorkspaceId` 与 `conversation-store.loadConversations` 提供；智能分类当前只以“组是否存在”过滤，见 `electron/main/tipc/category.ts:25`。

## 计划改动

- [ ] `electron/main/tipc/group.ts` 新增/替换为归档话题、恢复话题、列归档话题、永久删除话题路由；删除路由调用 Step 1 协调层并返回明确错误。
- [ ] 归档话题路由先处理运行中的会话：前端确认后关闭相关 runtime，再写入 `Group.archivedAt`；恢复只清除归档状态，不重建树或分类。
- [ ] `electron/main/tipc/conversations.ts` 删除 `archiveConversation/unarchiveConversation/listArchivedConversations` 产品入口；`deleteConversation` 一律走硬删除并在最后会话后调用协调层。
- [ ] `conversation-service.ts`、`conversation-runtime-service.ts` 与创建入口增加“所属话题必须活跃”的校验；归档话题不可 attach、发送或创建会话。
- [ ] 调整活跃查询：普通会话和 Group store 只返回未归档话题；为归档区提供按话题打包的专用读模型，避免归档会话进入活跃 store。
- [ ] `stores/group-store.ts` 增加归档/恢复/删除话题 action；`stores/conversation-store.ts` 改为固定硬删除确认，不再按 `sdk_session_id` 分流，并在话题状态变化后刷新相关 store、关闭对应 tabs 和选中态。
- [ ] `electron/main/tipc/category.ts` 与分类/树读取点明确过滤归档话题，但不得删除其持久化引用。

## 实施回填（做完后填）

### 实际改动
- 与计划差异：
- 改动文件清单：

### 给下一步的接力棒
- 关键签名 / 数据结构：
- 下个 step 该从哪里继续：
- 待办或已知限制：
