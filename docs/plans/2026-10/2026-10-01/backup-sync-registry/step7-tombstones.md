---
step: 7
title: 墓碑删除传播
status: pending
---

## 目标
修 F6：删除作为修改参与同步（墓碑机制），对端未改则传播删除、对端改过则删改冲突保守保留。

## 依赖上下文（接力棒输入）
- （执行时回填 step6 接力棒：sync-state 锁与结构现状）
- 现状关键文件：`sync/manifest.ts:242-244,278`（remote-only 无条件 pull / local-only 无条件 push → 复活）、`sync/protocol.ts`（SYNC_PROTOCOL_VERSION v2）、`sync/server.ts`（无删除端点）、`sync/orchestrator.ts`（conflicts 上报结构）、`app/data-center/sync-result.tsx`

## 计划改动
- [ ] `sync-state.ts`：`tombstones: Record<relPath, {deletedAt, deviceId}>`，90 天过期清理 + 上限（如 2000 条，超限丢最旧）；生成时机：buildNextBaseline 对比上轮基线——基线有、现无且非排除路径 → 记墓碑
- [ ] 协议 v3：`/manifest` 请求体携本端墓碑，响应携对端墓碑；版本升 v3，旧版本走既有 confirmVersionMismatch
- [ ] 删除执行：主动端收到对端墓碑，对端路径本端存在且 == 本端基线 → 调新增 `DELETE /file`（带对端墓碑校验，接收端同样过 isExcluded/映射校验）；本端改过 → 删改冲突：保守保留文件，进 report.conflicts（带 kind: 'delete-vs-modify'）
- [ ] merge registry 记录文件（settings/plans/notifications/conversations.json 等）条目级删除不传播（并集语义维持），仅整文件删除走墓碑
- [ ] UI：sync-result.tsx 冲突区展示删改冲突（「对端已删除、本端修改过，已保留本端」）
- [ ] 单测：A 删 → 同步 → B 侧文件消失且基线更新；A 删 + B 改 → 冲突保留；墓碑过期不复活

## 实施回填（做完后填）

### 实际改动
- 与计划差异：
- 改动文件清单：

### 给下一步的接力棒
- 关键签名 / 数据结构：
- 下个 step 该从哪里继续：
- 待办或已知限制：
