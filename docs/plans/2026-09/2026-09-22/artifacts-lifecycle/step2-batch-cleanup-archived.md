---
step: 2
title: 归档话题批量清理入口
status: pending
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

- [ ] `topic-lifecycle-service.ts` 新增 `batchDeleteArchivedTopics(workspaceId, olderThanDays = 30)`：filter `archivedAt < now - N*86400_000` → 逐个 `deleteTopic` → 返回 `{ deleted: string[], failed: Array<{ groupId, error }> }`；单组失败不中断
- [ ] `tipc/group.ts` 新增对应 RPC（zod 校验 olderThanDays 可选，默认 30）
- [ ] 前端归档视图头部加「清理」按钮 → `showConfirm` 列出将删话题数与最老归档时间 → 调 RPC → toast 汇总（成功 N 个 / 失败 M 个，失败时列出话题名）
- [ ] 清理完成后刷新归档列表（沿用现有 group-store 的刷新通道）

## 实施回填（做完后填）

### 实际改动
- 与计划差异：
- 改动文件清单：

### 给下一步的接力棒
- 关键签名 / 数据结构：
- 下个 step 该从哪里继续：
- 待办或已知限制：（如归档量大时同步 RPC 耗时观察，超预期再改异步进度）
