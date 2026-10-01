---
step: 1
title: 主进程 skip 链路
status: pending
---

## 目标
调度路径下源内容无变化时跳过打 zip 并记录 last-run skipped；到期判断感知 last-run 时间消除空转。

## 依赖上下文（接力棒输入）
- 设计文档：docs/plans/2026-10/2026-10-01/backup-skip-unchanged/design.md
- 现状关键签名（electron/main/services/backup-service/）：
  - `index.ts` `runBackupAll(config, { onlyDue })`：onlyDue 时 `isDue(key, scope, freq)` 通过后直接 `runBackup`
  - `runBackup` 成功后 `recordCategoryRun(category, scope, true, null)`；`runBackupInner` 被 runBackup 与 restoreBackup 预备份两处调用
  - `schedule.ts` `isDue`：`listBackupFiles(scope, category)` 最新 stamp vs `FREQ_INTERVAL_MS[frequency]`，零状态
  - `last-run.ts` `LastRunEntry = { time, category, scope, ok, error }`；key=`${scope}:${category}`；写操作经 enqueueWrite 串行
  - `zip-pack.ts` `backupSourcesFor(category, scope)`（data-registry.ts）返回源描述，packSources（zip-pack-core.ts）负责收集文件——签名遍历语义必须与其一致
- 关键决策回顾：skip 判断放 runBackupAll 层而非 runBackupInner，保证手动/预备份路径天然不受影响。

## 计划改动
- [ ] 新建 `source-signature.ts`：`computeSourceSignature(sources): Promise<string | null>`；遍历复用/提取 zip-pack-core 的文件收集逻辑（含外部锚点源按绝对路径扫），收集 `relpath|mtimeMs|size` 排序拼接 sha1
- [ ] `last-run.ts`：LastRunEntry 加 `signature?: string | null`、`skipped?: boolean`；recordCategoryRun 加可选 extra `{ signature?, skipped? }`
- [ ] `schedule.ts`：isDue 锚点改 `max(最新 zip stamp, readCategoryRun(key)?.time)`；旧 last-run 无该 entry 时退化为纯 zip 时间戳
- [ ] `index.ts` runBackupAll：onlyDue 且 isDue 通过后 → computeSourceSignature → 与 last-run.signature 相同 → recordCategoryRun(ok, { skipped: true }) + continue；签名计算抛错按有变化继续；不同/无签名 → 正常 runBackup，成功后经 runBackup 的 recordCategoryRun 写入新 signature
- [ ] `BackupScopeStatus` 加 `lastSkippedAt: string | null`（getBackupStatus 从 lastRun.skipped 取 time）
- [ ] 测试：签名对 mtime/size/新增/删除文件敏感；无变化跳过（不产 zip、last-run 记 skipped、signature 不变）；有变化正常备份并更新签名；跳过后 isDue 为 false；手动 runBackup 不跳过；旧 last-run（无 signature）首次必备份

## 实施回填（做完后填）

### 实际改动
- 与计划差异：
- 改动文件清单：

### 给下一步的接力棒
- 关键签名 / 数据结构：
- 下个 step 该从哪里继续：
- 待办或已知限制：
