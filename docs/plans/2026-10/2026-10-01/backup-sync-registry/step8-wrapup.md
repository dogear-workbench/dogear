---
step: 8
title: 收尾
status: done
---

## 目标
文档同步、轻项清理、完成总结。

## 依赖上下文（接力棒输入）
- （执行时回填 step7 接力棒）

## 计划改动
- [x] doc-sync：更新 `docs/codebase-map/data-center.md`（registry、备份新分类、墓碑）与 `infra.md`（data-registry 条目）
- [x] 轻项清理：`tipc/backup.ts` openBackupDir 改开 `backups/` 根目录；删除 runBackup 无调用方的「只给 scope」分支；确认 dashboard.md 引用已从备份源移除后无残留
- [x] 全量验证：`bun test` + `bun run build:electron`；数据中心面板人工过一遍（备份四卡片 + app-config、恢复确认文案、同步结果卡删改冲突）
- [ ] plan.md 末尾写「完成总结」（实际改动汇总、与原计划偏差）——由主会话统一写

## 实施回填（做完后填）

### 实际改动
- 与计划差异：
  1. openBackupDir 连带删 input 的 scope 入参 + 前端改无参调用（根目录语义下 scope 无意义，改动半径最小）
  2. zip-pack.ts 新增 backupsRootDir() 导出，backupDirPath 基于它拼接（路径单一来源）
  3. doc-sync 范围大于计划字面：data-center.md 原本完全无备份主进程与 sync 模块条目，补齐两节并修正面板数（六→七，sync tab 此前未入图）；infra.md 补 IPC 路由行、data-registry 与 zip-pack-worker 条目、backups/ 存储段
  4. dashboard.md 残留：代码/UI 零残留（唯一出现处是 data-registry.test.ts 的保护性断言）；旧备份 zip 内条目是历史数据非代码残留
- 改动文件清单：改 tipc/backup.ts（openBackupDir 根目录 + 删 scope 分支与死 import）、zip-pack.ts（+backupsRootDir）、VersionBackupPanel.tsx（无参调用）、docs/codebase-map/data-center.md、infra.md、index.md
- 验证：bun test 477 例 0 fail；build:electron + 前端 tsc 通过；数据中心面板人工验收留用户

### 给下一步的接力棒
- 关键签名 / 数据结构：backupsRootDir(): string（zip-pack.ts）；openBackupDir 无参 tipc 路由
- 下个 step 该从哪里继续：全部 8 步完成，无后续 step；本计划收尾
- 待办或已知限制：
  - 数据中心面板人工验收留用户（五卡片+app-config、打开目录开 backups/ 根、恢复文案与删除计数、同步删改冲突展示）
  - 旧备份 zip 恢复会把 dashboard.md 写回磁盘——无读写方、不在 registry 源边界、无功能影响
  - step3/4/5/6/7 各自的真机验证项继续有效（见各 step 实施回填）
