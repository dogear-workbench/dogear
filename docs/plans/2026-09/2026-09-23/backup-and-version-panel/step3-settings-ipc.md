---
step: 3
title: settings 备份配置节 + tipc 路由
status: done
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
  1. settings backup 节字段名用 `keep`（非计划稿的 `keepCount`），与 backup-service 的 `BackupCategoryConfig` 同形，settings 节的 `backup.categories` 可直接透传服务层 `BackupConfig`，零字段映射；类型镜像定义在 settings-types（不 import backup-service，保持该文件零 electron 依赖）
  2. `runBackup(category?, scope?)` 四种组合语义：成对=单项；只给 category=该分类全部适用 scope（不检查 enabled，用户显式点名优先于调度开关）；只给 scope=该 scope 适用分类（同样不检查 enabled）；都缺=全量（走 runBackupAll，尊重 enabled）
  3. `getWorkspaceGitSummary` 落在 tipc/git.ts（git 域内聚），git 缺失/非仓库/查询失败统一降级不报错；影子仓库体积统计新增 `git-service/shadow.ts` 导出的 `getShadowRepoSizeBytes(workspaceId)`（目录递归求和）
  4. 渲染层 lib/client.ts / types/electron-api.ts 无需改动：tipc 类型从 Router 自动推导，前端 import type 即得；FileHistoryEntry 式手动镜像仅在前端需要独立类型时才需要（step4 按需）
  5. restoreBackup 预备份仍用分类默认 keep=10（未改 step2 服务层签名），用户配置的 keep 只影响新备份与轮换
- 改动文件清单：
  - `electron/main/services/settings-types.ts`：BackupSettings/BackupCategorySetting 类型 + BACKUP_SETTING_KEYS/FREQUENCIES 常量 + DEFAULT_SETTINGS.backup 四分类默认 + normalizeBackupSettings 纯函数（非法输入归一全默认，单字段非法回落该分类默认）
  - `electron/main/services/settings-service.ts`：normalizeSettings 接入 backup 归一化（非法即标 dirty 落盘）
  - `electron/main/main-app.ts`：whenReady 挂 startBackupScheduler（provider = `loadSettings().then(s => s.backup?.categories ?? null)`，配置实时读、改动即生效）；before-quit 调 stopBackupScheduler
  - `electron/main/services/git-service/shadow.ts`：新增导出 getShadowRepoSizeBytes
  - `electron/main/tipc/git.ts`：新增 getWorkspaceGitSummary 路由 + WorkspaceGitSummary 接口
  - `electron/main/tipc/backup.ts`（新增）：getBackupStatus / runBackup / listBackups / restoreBackup / openBackupDir 五路由；electron 用默认导入解构 shell（沿用 file.ts 模式，bun 下可加载）
  - `electron/main/tipc/index.ts`：挂载 backupRouter
  - `tmp/verify-backup-ipc.ts` + `tmp/electron-stub.ts`（新增，不 commit）：28 项断言全链路验证；electron-stub 是 bun --preload 的 electron 模块 stub（绕开 @egoist/tipc/main 顶层具名导入 ipcMain），跑法 `bun --preload ./tmp/electron-stub.ts ./tmp/verify-backup-ipc.ts`

### 给下一步的接力棒
- 关键签名 / 数据结构：
  - settings：`settings.backup.categories.<key> = { enabled, frequency: 'daily'|'weekly'|'monthly'|'manual', keep }`；normalizeSettings 保证读取时四分类齐全且字段合法；UI 改配置走既有 getSettings/updateSettings 整体写回，调度器下一 tick 自动生效
  - 路由（前端 `client.<name>(input)` 自动推导类型）：
    - `getBackupStatus()` → `{ status: BackupScopeStatus[] }`（key/scope/scopeType/enabled/frequency/keep/count/lastBackupAt/due）
    - `runBackup({ category?, scope? })` → `{ results: BackupRunResult[] }`（key/scope/fileName|null/size/pruned/error?；fileName=null=空源无备份）；单分类失败不中断，失败项带 error 字段；响应也可能 `{ error }`
    - `listBackups({ category, scope })` → `{ backups: { fileName, time, size }[] }`（最新在前；不适用组合返回空数组）
    - `restoreBackup({ category, scope, fileName })` → `{ preBackupFileName, restored }`（失败 `{ error }`；恢复前自动预备份）
    - `openBackupDir({ scope? })` → `{ success } | { error }`（scope 缺省打开 backups 根目录）
    - `getWorkspaceGitSummary({ workspaceId })` → `{ userRepo: { isRepo, branch, changedCount }, shadow: { snapshotCount, lastTime, sizeBytes } }`；工作区不存在 `{ error }`；git 缺失/非仓库/查询失败全部降级（isRepo=false / shadow 空统计）不报错
- 下个 step 该从哪里继续：step4 数据中心「版本与备份」区块直接消费上述路由；恢复操作走 showConfirm；备份配置编辑走 updateSettings 整体写回
- 待办或已知限制：
  - restoreBackup 预备份 keep 固定 10，不读用户配置（服务层签名未变，如需透传要给 restoreBackup 加 opts）
  - sessions（~239M）备份同步阻塞主进程数秒，UI 需 loading 态
  - openBackupDir 依赖 shell，验证脚本无法覆盖（electron-stub 环境），step4 人工验证
  - 既有问题（非本步引入）：`components/FileHistoryPanel.tsx:83` 前端 tsc 报 `setError(res.error)` string|undefined 错（master 已存在）
