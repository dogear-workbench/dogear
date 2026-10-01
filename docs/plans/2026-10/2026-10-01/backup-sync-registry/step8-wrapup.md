---
step: 8
title: 收尾
status: pending
---

## 目标
文档同步、轻项清理、完成总结。

## 依赖上下文（接力棒输入）
- （执行时回填 step7 接力棒）

## 计划改动
- [ ] doc-sync：更新 `docs/codebase-map/data-center.md`（registry、备份新分类、墓碑）与 `infra.md`（data-registry 条目）
- [ ] 轻项清理：`tipc/backup.ts` openBackupDir 改开 `backups/` 根目录；删除 runBackup 无调用方的「只给 scope」分支；确认 dashboard.md 引用已从备份源移除后无残留
- [ ] 全量验证：`bun test` + `bun run build:electron`；数据中心面板人工过一遍（备份四卡片 + app-config、恢复确认文案、同步结果卡删改冲突）
- [ ] plan.md 末尾写「完成总结」（实际改动汇总、与原计划偏差）

## 实施回填（做完后填）

### 实际改动
- 与计划差异：
- 改动文件清单：

### 给下一步的接力棒
- 关键签名 / 数据结构：
- 下个 step 该从哪里继续：
- 待办或已知限制：
