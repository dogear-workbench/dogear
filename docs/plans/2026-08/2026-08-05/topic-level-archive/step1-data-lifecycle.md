---
step: 1
title: 话题数据模型、级联清理与旧归档迁移
status: done
---

## 目标

让 Group 成为唯一归档实体，并提供可复用、可重试的话题物理删除能力，在启动迁移中清理历史单会话归档和空话题。

## 依赖上下文（接力棒输入）

- 设计依据：`../topic-level-archive-design.md` 已确定归档只属于话题，旧归档一次性永久清理。
- 当前归档字段位于 `electron/main/services/conversation-service.ts:50` 的 `ConversationIndex.archivedAt/archiveReason`；`Group` 只有 id/title/时间字段，见 `types/group.ts:1` 与 `electron/main/types.ts:201`。
- 当前单会话硬删除在 `electron/main/tipc/conversations.ts:125`，会关闭 Harness runtime、删除会话文件和用量；空组清理散落在 `:36` 的 `deleteGroupIfEmpty`。
- 当前组目录统一位于 `getGroupDir(workspaceId, groupId)`，见 `electron/main/services/memory/group-digest-store.ts:256`。

## 计划改动

- [ ] `types/group.ts` 与 `electron/main/types.ts` 为 `Group` 增加 `archivedAt?: number`，同步所有跨进程类型。
- [ ] `electron/main/services/group-service.ts` 升级 `groups.json` schema，提供活跃/归档话题查询、归档与恢复写入；读取旧文件时兼容无版本或旧版本数据。
- [ ] 新建 `electron/main/services/topic-lifecycle-service.ts`，集中实现：
  - 单会话硬删除的运行时关闭、Harness 会话文件、用量与索引清理；
  - 最后会话删除后的话题收尾；
  - 整个话题的逐会话删除、树引用清理、智能分类移除和 `groups/<groupId>/` 目录删除；
  - 可重试的错误返回，不能在会话文件删除失败后提前移除索引。
- [ ] 将 `electron/main/tipc/conversations.ts:36` 的空组清理替换为调用统一协调层，避免两条删除路径有不同副作用。
- [ ] 新建或扩展启动迁移：扫描所有 `Conversation.archivedAt` 记录，按硬删除规则清理 Harness/旧 SDK 历史、用量和索引；再清理无会话话题及其树、分类和组目录引用。仅在扫描完整完成后记录迁移版本，重复启动安全。
- [ ] 保留历史 `archivedAt/archiveReason` 的读取兼容直到迁移完成；后续步骤再删除产品级 API 和 UI。

## 实施回填（做完后填）

### 实际改动
- 与计划差异：为保证会话索引只在所有工件清理成功后才删除，补充了 `conversationRuntimeService.closeConversation()`、`deleteUsageStrict()` 和 Pi Harness repository 的缺失文件幂等处理；其余按计划实施。
- 改动文件清单：`types/group.ts`、`electron/main/types.ts`、`electron/main/services/group-service.ts`、`electron/main/services/topic-lifecycle-service.ts`、`electron/main/services/conversation-runtime-service.ts`、`electron/main/agents/pi-session/pi-session-repository.ts`、`electron/main/services/usage/usage-service.ts`、`electron/main/tipc/conversations.ts`、`electron/main/index.ts`、`electron/main/services/conversation-service.ts`。

### 给下一步的接力棒
- 关键签名 / 数据结构：`Group.archivedAt?: number` 是唯一归档状态；`groupService.listActiveGroups/listArchivedGroups/archiveGroup/restoreGroup()` 提供话题归档读写；`topicLifecycleService.deleteConversation/deleteTopic/cleanupEmptyTopics/runTopicLifecycleMigration()` 集中管理删除与迁移，并以 `{ ok, error? }` 返回可重试结果。
- 下个 step 该从哪里继续：在 `electron/main/tipc/group.ts` 和 `electron/main/tipc/conversations.ts` 接入话题归档、恢复、删除路由；前端 store 基于活跃/归档话题切换数据，并移除产品级单会话归档入口。
- 待办或已知限制：历史 `Conversation.archivedAt/archiveReason` 与旧归档 RPC 暂仅为迁移前数据读取兼容，Step 2 必须移除其产品入口。`bun test` 仍有 6 个既有断言失败和 2 个测试环境模块错误；本步骤的 `bun run lint`、`bun run build:electron`、`git diff --check` 均通过。
