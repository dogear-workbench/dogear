---
step: 7
title: 墓碑删除传播
status: done
---

## 目标
修 F6：删除作为修改参与同步（墓碑机制），对端未改则传播删除、对端改过则删改冲突保守保留。

## 依赖上下文（接力棒输入）
- （执行时回填 step6 接力棒：sync-state 锁与结构现状）
- 现状关键文件：`sync/manifest.ts:242-244,278`（remote-only 无条件 pull / local-only 无条件 push → 复活）、`sync/protocol.ts`（SYNC_PROTOCOL_VERSION v2）、`sync/server.ts`（无删除端点）、`sync/orchestrator.ts`（conflicts 上报结构）、`app/data-center/sync-result.tsx`

## 计划改动
- [x] `sync-state.ts`：`tombstones: Record<relPath, {deletedAt, deviceId}>`，90 天过期清理 + 上限（如 2000 条，超限丢最旧）；生成时机：buildNextBaseline 对比上轮基线——基线有、现无且非排除路径 → 记墓碑
- [x] 协议 v3：`/manifest` 请求体携本端墓碑，响应携对端墓碑；版本升 v3，旧版本走既有 confirmVersionMismatch
- [x] 删除执行：主动端收到对端墓碑，对端路径本端存在且 == 本端基线 → 调新增 `DELETE /file`（带对端墓碑校验，接收端同样过 isExcluded/映射校验）；本端改过 → 删改冲突：保守保留文件，进 report.conflicts（带 kind: 'delete-vs-modify'）
- [x] merge registry 记录文件（settings/plans/notifications/conversations.json 等）条目级删除不传播（并集语义维持），仅整文件删除走墓碑
- [x] UI：sync-result.tsx 冲突区展示删改冲突（「对端已删除、本端修改过，已保留本端」）
- [x] 单测：A 删 → 同步 → B 侧文件消失且基线更新；A 删 + B 改 → 冲突保留；墓碑过期不复活

## 实施回填（做完后填）

### 实际改动
- 与计划差异：
  1. 删除执行拆两方向（均主动端驱动）：peerDeleted（对端删+本端未改）走**本地 unlink**而非 DELETE /file（对端已删再调只能 404，语义等价少一次往返）；deletePropagation（本端删+对端未改）才调 DELETE /file（带 expectedHash，接收端 sha256 二次校验 + push-guard 同链，409=对端改过）
  2. 删改冲突用独立字段 `SyncReport.deleteConflicts`（带 kind: 'local-deleted'|'remote-deleted'）而非进 conflicts[]——conflicts 是待裁决语义（UI 有取对端/保留本端按钮），删改冲突是已保守保留的既定结果，混入会误导用户点「取对端」（对端已删）；UI 独立展示区+「删除 N」计数
  3. 墓碑挂全局 SyncState.tombstones（非 per-peer）：删除事实与 peer 无关，per-peer 会让第三个 peer 收不到传播；TOMBSTONE_TTL_MS=90 天/TOMBSTONE_MAX=2000 落码
  4. 墓碑生成两处对称：主动端 orchestrator（开头 tombstoneCandidates 同轮即参与 + 收尾锁内 mergeTombstones）+ 被动端 server handleManifest（锁外算+短锁落盘+响应携带，被动端唯一落盘时机）；共用 tombstoneCandidates 纯函数，改判定两处同改
  5. tombstoneCandidates 额外排除暂停工作区路径（防开关状态被误判删除传播误删）与 settings.json
  6. v2 对端删除传播整体禁用（peerSupportsDelete = protocolVersion >= 3），防 DELETE 404 被误判「已删」；版本不匹配走既有 blocked → confirmVersionMismatch
  7. runSync 全链路无自动化测试（env flake 既有坑），以单元 + 真 HTTP 双端串联覆盖同等路径（orchestrator 接线段无自动化，真机验证盖）
- 改动文件清单：改 protocol.ts（v3 + TombstoneSchema + FileDeleteRequestSchema + DiffResult 扩字段）、sync-state.ts（tombstones + prune/merge + 常量）、manifest.ts（tombstoneCandidates + diffManifests 双墓碑分支）、client.ts（fetchManifest 携墓碑 + deletePeerFile）、server.ts（handleManifest 墓碑对称 + handleFileDelete 端点）、orchestrator.ts（SyncReport +deleted/deleteConflicts、双方向执行、方向性判定、收尾落盘）、sync-result.tsx（删除计数+删改冲突区）、stores/sync-store.ts（toast）；新增 tombstone.ts、tombstone.test.ts（21 例）
- 验证：bun test 477 例 0 fail；build:electron + 前端 tsc 通过

### 给下一步的接力棒
- 关键签名 / 数据结构：
  - `SyncState.tombstones?: Record<relPath, {deletedAt: number, deviceId: string}>`（全局）；`TOMBSTONE_TTL_MS=90d`、`TOMBSTONE_MAX=2000`
  - `DeleteConflict {relPath, kind: 'local-deleted'|'remote-deleted'}`（tombstone.ts 导出）；`SyncReport.deleted?/deleteConflicts?`
  - `tombstoneCandidates(prev, current, {excludes?, enabledWorkspaceIds?}): string[]`；`diffManifests` +localTombstones/remoteTombstones 入参、deletePropagation/peerDeleted 出参
  - `applyPeerTombstones(root, entries, baselineHashes)` / `propagateLocalDeletes(targets, baselineHashes, deleteFn)`；`deletePeerFile(peer, auth, relPath, expectedHash)`
  - DELETE /file 响应：200 删除成功 / 404 对端已无 / 409 对端改过拒删 / 403 push-guard / 401 未配对
  - `SYNC_PROTOCOL_VERSION = 3`（protocol.ts）；`peerSupportsDelete = remoteHello.protocolVersion >= 3`（orchestrator.ts）
- 下个 step 该从哪里继续：step8 收尾（doc-sync、轻项清理、完成总结）；改墓碑判定规则时主动端/被动端两处对称同改；墓碑写入全部复用 withSyncStateLock 未另造锁
- 待办或已知限制：
  - 假墓碑极窄窗口：buildManifest 竞态 stat 失败会当删除记墓碑传播，兜底仅对端 hash 校验；真机验证留意
  - 真机双端验证 4 项留用户：A 删传播 / 删改冲突 / 反向跟随 / 暂停开关不误删
  - U3（协议 blocked 被拒后无界面痕迹）仍在；v2↔v3 混跑触发 confirmVersionMismatch，确认后按 v2 行为（删除不传播）
  - orchestrator 接线段（targets 构造/方向判定）无自动化测试，由真机验证盖
