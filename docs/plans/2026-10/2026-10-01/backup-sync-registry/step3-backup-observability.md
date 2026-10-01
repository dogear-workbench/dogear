---
step: 3
title: 备份可观测 + worker 打包
status: done
---

## 目标
自动备份失败可见（I-7）+ 打包移出主进程（I-6），UI 展示 lastError。

## 依赖上下文（接力棒输入）
- （执行时回填 step2 接力棒）
- 现状关键文件：`backup-service/schedule.ts:33-40`（tick catch 吞错）、`index.ts` runDueBackups/runBackupAll（结果无消费者）、`zip-pack.ts:44-64`（statSync/addLocalFolder/writeZip 全同步）、`tipc/backup.ts` getBackupStatus、`app/data-center/version-backup/CategoryCard.tsx` 状态行

## 计划改动
- [x] 失败记录：runDueBackups 每分类结果写 `backups/last-run.json`（`{time, category, scope, ok, error}`，按分类覆盖）；getBackupStatus 聚合返回 lastError
- [x] `schedule.ts` tick 不再吞错：记入 last-run.json + console.error
- [x] `zip-pack.ts` 移 worker_threads：打包任务 postMessage 传输源列表/目标路径，worker 内 adm-zip 打包回传结果；worker 创建失败或超时回退主进程异步执行（保底可用）
- [x] UI：CategoryCard 状态行显示 lastError 与失败徽标；VersionBackupPanel 顶部「最近自动备份」失败红字
- [x] 主进程改动需 `bun run build:electron` 后真机验证大目录（sessions/）备份不冻结窗口（编译已验证，真机验证留用户，见遗留）

## 实施回填（做完后填）

### 实际改动
- 与计划差异：
  1. last-run 记录点下移到 runBackup enqueue 体内（非只 runDueBackups）：调度/手动/全量备份失败都进 last-run，手动失败状态行也可见；restore 预备份走 runBackupInner 不重复记录
  2. getBackupStatus 返回多一个 `scheduler` 键（调度级成败信号，喂顶部红字）：`{status, scheduler}`，tipc 类型链同步
  3. worker 采用「主进程 resolve + worker 纯打包」分工：resolveSourceEntries（反解外部锚点+stat）留主进程，worker 只收 {entries, outZipPath} 纯数据打包——零服务依赖，无需 DOGEAR_CONFIG_DIR 注入
  4. 新增 last-run.ts / zip-pack-core.ts / zip-pack-worker.ts 三文件（core 为 worker/回退共用零依赖层）；worker 超时 60s
  5. 修测试中发现的潜伏 bug：last-run 降级 catch 返回模块级共享单例被读改写永久污染 → 改工厂新对象（已存全局记忆 shared-empty-object-pollution）
- 改动文件清单：新增 last-run.ts、last-run.test.ts（6 例）、zip-pack-core.ts、zip-pack-worker.ts、zip-pack.test.ts（4 例）；改 zip-pack.ts（worker 化+回退，签名不变）、schedule.ts（tick 不吞错）、index.ts（runBackup 统一记录 + getBackupStatus +scheduler/lastError）、tipc/backup.ts（透传）、backup-meta.ts（BackupSchedulerStatus 提取）、VersionBackupPanel.tsx（顶部红字）、CategoryCard.tsx（失败徽标+lastError 行）
- 验证：bun test 411 例 0 fail；build:electron 通过且 zip-pack-worker.js 已入 dist 编译产物；前端 tsc --noEmit 通过

### 给下一步的接力棒
- 关键签名 / 数据结构：
  - last-run.json：`{ runs: { "<scope>:<category>": LastRunEntry }, scheduler: LastRunEntry|null }`，writeChain 串行化；recordCategoryRun/recordSchedulerRun/readCategoryRun/readSchedulerRun
  - `getBackupStatus(config?): Promise<{ status: BackupScopeStatus[]; scheduler: {lastRunAt, ok, error} }>`，BackupScopeStatus 新增 lastError
  - packSources 签名不变（内部 resolveSourceEntries → packInWorker 60s 超时 → 回退 packEntriesSharded）；PackEntry {entryPath, readPath, isDir}
- 下个 step 该从哪里继续：extractZipTo（index.ts）未动维持 step2 状态，step4 在其上叠加快照还原语义（zip 外文件删除限 registry 边界 + 运行中会话检查 + showConfirm + 预备份 keep 用用户配置）；预备份若要可见可在 restoreBackup 内直接调 recordCategoryRun（enqueue 体内，与 runBackup 同约束）
- 待办或已知限制：
  - 真机验证留用户：大目录备份不冻结窗口、worker 成功路径（dist 产物真实启动）、制造失败验证红字/徽标
  - worker 超时/中途失败可能残留半写 zip（既有行为，轮换淘汰，未扩大 scope）
  - 手动备份失败也写 runs，UI 失败徽标不区分触发来源（语义=该分类最近一次执行结果）
