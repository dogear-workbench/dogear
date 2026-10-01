---
step: 1
title: 主进程 skip 链路
status: done
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
- [x] 新建 `source-signature.ts`：`computeSourceSignature(sources): Promise<string | null>`；遍历复用/提取 zip-pack-core 的文件收集逻辑（含外部锚点源按绝对路径扫），收集 `relpath|mtimeMs|size` 排序拼接 sha1
- [x] `last-run.ts`：LastRunEntry 加 `signature?: string | null`、`skipped?: boolean`；recordCategoryRun 加可选 extra `{ signature?, skipped? }`
- [x] `schedule.ts`：isDue 锚点改 `max(最新 zip stamp, readCategoryRun(key)?.time)`；旧 last-run 无该 entry 时退化为纯 zip 时间戳
- [x] `index.ts` runBackupAll：onlyDue 且 isDue 通过后 → computeSourceSignature → 与 last-run.signature 相同 → recordCategoryRun(ok, { skipped: true }) + continue；签名计算抛错按有变化继续；不同/无签名 → 正常 runBackup，成功后经 runBackup 的 recordCategoryRun 写入新 signature
- [x] `BackupScopeStatus` 加 `lastSkippedAt: string | null`（getBackupStatus 从 lastRun.skipped 取 time）
- [x] 测试：签名对 mtime/size/新增/删除文件敏感；无变化跳过（不产 zip、last-run 记 skipped、signature 不变）；有变化正常备份并更新签名；跳过后 isDue 为 false；手动 runBackup 不跳过；旧 last-run（无 signature）首次必备份

## 实施回填（做完后填）

### 实际改动
- 与计划差异：无实质差异；额外两点——① runBackup 成功路径也写入新签名（plan 要求的「成功后经 runBackup 的 recordCategoryRun 写入」），签名计算失败写 null（与「无内容」同语义，下次必有份自愈）；② trySkipUnchanged 要求 `lastRun.ok === true` 才比对（上次执行失败不跳过，保持失败重试语义，设计文档未明说，属保守补强）
- 改动文件清单：
  - `zip-pack-core.ts`：+`collectPackFiles(entries): Promise<PackFileInfo[]>`（文件级遍历，`{ entryPath, mtimeMs, size }`；stat 跟随符号链接、失败跳过；目录递归 readdir+stat），与 addLocalFolder 展开文件集合一致
  - `zip-pack.ts`：`resolveSourceEntries` 由私有改导出（签名与打包共用同一入口）
  - `source-signature.ts`：新建，`computeSourceSignature(sources): Promise<string | null>` = sha1(排序的 `entryPath|mtimeMs|size` 拼串)，hex；无文件 → null
  - `last-run.ts`：LastRunEntry +`signature?: string | null` +`skipped?: boolean`；+`CategoryRunExtra`；recordCategoryRun 加第 5 参 extra（`signature` undefined = 保留旧值；skipped=true 时 signature 保留旧值）
  - `schedule.ts`：isDue 锚点 = max(最新 zip stamp, readCategoryRun(key)?.time)，两者皆无 → true
  - `index.ts`：runBackup 成功后 `recordCategoryRun(ok, { signature })`（失败不传 extra）；+`trySkipUnchanged`（签名失败→false；!lastRun.ok→false；signature undefined 或不等→false；相等→recordCategoryRun(true,null,{skipped:true})）；runBackupAll onlyDue 分支 isDue 后插入；BackupScopeStatus +`lastSkippedAt`（getBackupStatus 从 lastRun.skipped 取 time）
  - 测试：`source-signature.test.ts`（6 用例：稳定/null/与 packSources 文件集合一致/mtime/size/增删）+ `skip-unchanged.test.ts`（5 用例：无变化跳过、有变化更新、手动不跳过、旧 last-run 必备份、失败后不跳过）

### 给下一步的接力棒
- 关键签名 / 数据结构：
  - `computeSourceSignature(sources: string[]): Promise<string | null>`（source-signature.ts）
  - `LastRunEntry.signature?: string | null; skipped?: boolean`；`recordCategoryRun(cat, scope, ok, error, extra?: { signature?: string | null; skipped?: boolean })`
  - `BackupScopeStatus.lastSkippedAt: string | null`（仅最近一次执行为跳过时非空；tipc 类型自动推导跟随）
  - 跳过记录特征：ok=true、error=null、skipped=true、signature 保留上次值、time=跳过时刻（同时是 isDue 新锚点）
- 下个 step 该从哪里继续：step2 前端——CategoryCard.tsx scope 行用 `lastSkippedAt` 渲染「内容无变化，已跳过（时间）」浅色单行提示；backup-meta.ts 的 BackupScopeStatus 类型同步（字段经 tipc 推导，检查前端类型导入源）
- 待办或已知限制：签名计算与进行中备份无互斥，竞态最坏多打/少打一份，下周期自愈（设计已接受）；runBackup 打完 zip 到算签名之间文件再变则签名≠zip 内容，下次多打一份自愈
