---
step: 3
title: 自动归档
status: done
---

## 目标

不在手动文件夹里的活跃组 > 30天自动归档；归档时从智能分类移除。

## 依赖上下文（接力棒输入）

- 前置 step 产出：
  - [step1] touchGroup 已实现，group.updatedAt 随会话活动刷新
  - [step2] 智能分类已改单引用，removeGroupEverywhere 可复用
- 当前代码状态：
  - `group-service.ts` 有 `archiveGroup(wsId, groupId)` 设 archivedAt；`listActiveGroups(wsId)` 返回未归档组
  - `conversation-tree-service.ts` 有手动文件夹树（root 只装 folderId，folder.children 装 groupId）。需要遍历树收集所有在文件夹里的 groupId
  - `smart-category-store.ts` 有 `removeGroupEverywhere(idx, groupId)` 纯函数 + `readIndex/writeIndex`
  - `tipc/group.ts` 有 archiveTopic / restoreTopic 等 IPC 端点；无自动归档端点
  - `stores/group-store.ts` 的 `load(workspaceId)` 调 `client.listGroups` 拿活跃组列表
  - 前端常量：`conversation-list/utils.ts` 的 `TIME_BUCKET_THRESHOLD_MS = 30 * 86400_000`

## 计划改动

- [x] `electron/main/services/group-service.ts`（或新文件 `auto-archive-service.ts`）：新增 `autoArchiveStaleGroups(wsId)` 函数：
  - 读手动文件夹树，遍历所有 folder 节点的 childrenIds，收集 `folderGroupIds: Set<string>`
  - 读活跃组列表 `listActiveGroups(wsId)`
  - 筛选：`group.updatedAt` 距今 > 30天 且 `!folderGroupIds.has(group.id)`
  - 对每个调 `archiveGroup(wsId, group.id)`
  - 归档后从智能分类移除：`let idx = readIndex(wsId); idx = removeGroupEverywhere(idx, group.id); writeIndex(wsId, idx)`
  - 返回归档数量（供日志/调试）
  - 异常不 throw，log warn 继续
- [x] `electron/main/tipc/group.ts`：新增 IPC 端点 `autoArchiveStale: t.procedure.input<{ workspaceId: string }>().action(...)`，调 autoArchiveStaleGroups，返回 `{ archivedCount }`
- [x] 前端类型声明：tipc 自动推断，无需手动声明
- [x] `stores/group-store.ts` 的 `load(workspaceId)`：listGroups 成功后，异步调 `client.autoArchiveStale({ workspaceId })`，如果 `archivedCount > 0` 则重新 `client.listGroups` 刷新（不阻塞加载流程，catch 忽略）

## 实施回填

### 实际改动
- 新建 `electron/main/services/auto-archive-service.ts`：`autoArchiveStaleGroups(wsId)` 函数
- `electron/main/tipc/group.ts`：新增 `autoArchiveStale` 端点 + import
- `stores/group-store.ts`：`load` 中异步触发自动归档

### 给下一步的接力棒
- `autoArchiveStaleGroups(wsId)` 已就绪，返回归档数量
- 自动归档在 `group-store.load` 时异步触发，不阻塞加载流程
