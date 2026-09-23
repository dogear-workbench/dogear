---
step: 3
title: settings 备份配置节 + tipc 路由
status: pending
---

## 目标

备份配置持久化到 settings.json，tipc 暴露 backup 全套路由与 git 状态汇总路由，供 step4 UI 消费。

## 依赖上下文（接力棒输入）

- 前置 step 产出：[step2-backup-service.md] backup-service 五个 API + 分类定义表（接力棒记录关键签名）
- 当前关键文件状态：
  - settings 结构：`electron/main/services/settings-service.ts` + settings-types（改前先读现状，配置节合并策略沿用既有模式）
  - tipc 路由：`electron/main/tipc/` 目录既有分文件路由（git 路由在 step4-上次计划新增，参考其形态）
  - git-service：`user-repo.ts`（用户仓库状态查询）、`shadow.ts`（listShadowHistory / 影子仓库体积可由磁盘统计）
- 关键决策回顾：配置默认值 notes-groups/memory/tasks = daily·keep10·开，sessions = monthly·keep10·开；settings/logs 无配置项

## 计划改动

- [ ] settings-types 新增 `backup?: { categories: Record<CategoryKey, { enabled: boolean; frequency: 'daily'|'weekly'|'monthly'|'manual'; keepCount: number }> }`，带默认值合并（缺省补默认，不覆盖用户已配）
- [ ] 主进程启动处挂 `startBackupScheduler(() => readSettings().backup)`，退出清理 `stopBackupScheduler()`
- [ ] tipc 新增 `backup.ts` 路由：`getBackupStatus`（各分类×各 scope：最近备份时间/份数/下次到期）、`runBackup(category? , scope?)`（缺省全量，返回逐项成功/失败）、`listBackups(category, scope)`、`restoreBackup(category, scope, fileName)`、`openBackupDir(scope?)`（shell.openPath）
- [ ] tipc 新增 `getWorkspaceGitSummary(workspaceId)`：`{ userRepo: { isRepo, branch, changedCount } | null, shadow: { snapshotCount, lastTime, sizeBytes } }`；复用 git-service，git-missing 时 `userRepo: { isRepo: false, ... }` 降级不报错
- [ ] 渲染层 `lib/client.ts` / `types/electron-api.ts` 补类型
- [ ] 验证脚本 `tmp/verify-backup-ipc.ts`：路由直调（改设置→runBackup→listBackups→restore 全链路 + gitSummary 两态）
- [ ] `bun run lint` + `bun run build:electron` 通过

## 实施回填（做完后填）

### 实际改动
- 与计划差异：
- 改动文件清单：

### 给下一步的接力棒
- 关键签名 / 数据结构：
- 下个 step 该从哪里继续：
- 待办或已知限制：
