---
step: 2
title: 归档话题批量清理入口
status: done
---

## 目标

归档视图新增「清理归档超过 30 天的话题」入口，语义与手动删除完全一致（deleteTopic 全删，含 digest 与 shared），失败跳过并汇总。

## 依赖上下文（接力棒输入）

- 当前关键文件状态：
  - `electron/main/services/topic-lifecycle-service.ts:166` `deleteTopic(workspaceId, groupId)` 已实现全删语义，直接复用
  - `electron/main/services/group-service.ts:79` `listArchivedGroups(workspaceId)` 返回按 archivedAt 倒序的归档组（含 `archivedAt: number` 时间戳）
  - `electron/main/tipc/group.ts:133` `deleteTopic` RPC 是单删入口，批量 RPC 加在同文件
  - 前端入口：`components/archive/ArchiveTopicList.tsx`（话题行结构，行内已有 showConfirm 的使用先例）
- 关键决策回顾：拍板选「全删」——归档视图内删除已是二次确认，不留摘要（不做年终总结场景）

## 计划改动

- [x] `topic-lifecycle-service.ts` 新增 `batchDeleteArchivedTopics(workspaceId, olderThanDays = 30)`：filter `archivedAt < now - N*86400_000` → 逐个 `deleteTopic` → 返回 `{ deleted: string[], failed: Array<{ groupId, error }> }`；单组失败不中断
- [x] `tipc/group.ts` 新增对应 RPC（zod 校验 olderThanDays 可选，默认 30）
- [x] 前端归档视图头部加「清理」按钮 → `showConfirm` 列出将删话题数与最老归档时间 → 调 RPC → toast 汇总（成功 N 个 / 失败 M 个，失败时列出话题名）
- [x] 清理完成后刷新归档列表（沿用现有 group-store 的刷新通道）

## 实施回填（做完后填）

### 实际改动
- 验收：lint 0 errors / build:electron exit 0 / 前端 tsc exit 0；详细交付见共享区 step2-delivery.md
- 与计划差异：
  - 清理按钮落在 `ArchivePage.tsx`（归档视图头部搜索框旁）而非 `ArchiveTopicList.tsx`——后者是纯列表组件无头部结构，头部容器在 ArchivePage
  - RPC 输入沿用同文件既有泛型风格 `.input<{...}>()`（tipc/group.ts 无 zod 先例），`olderThanDays` 可选，实现内 `?? 30` 兜底
  - 前端阈值复用 group-store 的 `OLDER_THRESHOLD_MS`（30 天），与「更早」分区/自动归档同源
- 改动文件清单：
  - `electron/main/services/topic-lifecycle-service.ts`：新增 `BatchDeleteArchivedResult` + `batchDeleteArchivedTopics(workspaceId, olderThanDays = 30)`，逐个复用 `deleteTopic` 全删语义，单组失败不中断
  - `electron/main/tipc/group.ts`：新增 `batchDeleteArchivedTopics` RPC（返回 `{ deleted, failed, error }`）
  - `stores/group-store.ts`：新增 `batchCleanupArchived()`，并行清当前工作区 + personal 归档（personal 失败容忍），完成后改 `groups` 引用触发归档页重拉（与 deleteTopic 同通道）
  - `components/archive/ArchivePage.tsx`：头部清理按钮 → 前端本地过滤过期话题 → `showConfirm` 列出数量与最早归档日期 → 调 store action → toast 汇总（成功 N / 失败 M 并列话题名）

### 给下一步的接力棒
- 关键签名 / 数据结构：
  - `batchDeleteArchivedTopics(workspaceId, olderThanDays = 30): Promise<{ deleted: string[]; failed: Array<{ groupId: string; error: string }> }>`
  - RPC 返回 `{ deleted, failed, error }`；store action 返回合并结果或 null（null = 整体异常，已 toast）
- 下个 step 该从哪里继续：归档视图刷新依赖 ArchivePage 的 `[workspaceId, groups]` effect，若后续做「归档页其他批量操作」可复用 `batchCleanupArchived` 的刷新写法
- 待办或已知限制：批量 RPC 为同步逐删，归档量大时耗时线性增长，超预期再改异步进度
