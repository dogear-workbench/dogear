---
step: 3
title: 备份可观测 + worker 打包
status: pending
---

## 目标
自动备份失败可见（I-7）+ 打包移出主进程（I-6），UI 展示 lastError。

## 依赖上下文（接力棒输入）
- （执行时回填 step2 接力棒）
- 现状关键文件：`backup-service/schedule.ts:33-40`（tick catch 吞错）、`index.ts` runDueBackups/runBackupAll（结果无消费者）、`zip-pack.ts:44-64`（statSync/addLocalFolder/writeZip 全同步）、`tipc/backup.ts` getBackupStatus、`app/data-center/version-backup/CategoryCard.tsx` 状态行

## 计划改动
- [ ] 失败记录：runDueBackups 每分类结果写 `backups/last-run.json`（`{time, category, scope, ok, error}`，按分类覆盖）；getBackupStatus 聚合返回 lastError
- [ ] `schedule.ts` tick 不再吞错：记入 last-run.json + console.error
- [ ] `zip-pack.ts` 移 worker_threads：打包任务 postMessage 传输源列表/目标路径，worker 内 adm-zip 打包回传结果；worker 创建失败或超时回退主进程异步执行（保底可用）
- [ ] UI：CategoryCard 状态行显示 lastError 与失败徽标；VersionBackupPanel 顶部「最近自动备份」失败红字
- [ ] 主进程改动需 `bun run build:electron` 后真机验证大目录（sessions/）备份不冻结窗口

## 实施回填（做完后填）

### 实际改动
- 与计划差异：
- 改动文件清单：

### 给下一步的接力棒
- 关键签名 / 数据结构：
- 下个 step 该从哪里继续：
- 待办或已知限制：
