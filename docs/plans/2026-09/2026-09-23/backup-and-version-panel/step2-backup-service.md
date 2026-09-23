---
step: 2
title: backup-service 服务层
status: done
---

## 目标

独立可直调的备份服务：分类定义、zip 打包、轮换清理、恢复、内建轻量调度——配置项本步先用参数传入（settings 集成在 step3）。

## 依赖上下文（接力棒输入）

- 前置 step 产出：无依赖（与 step1 并行无冲突，但按索引顺序执行）
- 当前关键文件状态：
  - `electron/main/services/git-service/shadow.ts:33` 的 `enqueue` 队列模式（本步照此实现备份串行队列）
  - `getConfigDir()` 来自 `electron/main/services/settings-service.js`（AppData/.dogear 根）
  - 工作区清单：`workspaces/` 目录下每子目录名即 workspaceId（参考 shadow.ts 的用法）
  - `adm-zip` 已在依赖（含 @types）
- 关键决策回顾：内建调度不接 scheduler（其任务唯一形态是跑 agent 会话）；到期判断扫目录文件名时间戳，零状态存储；恢复前自动预备份、失败中止

## 计划改动

- [ ] 新增 `electron/main/services/backup-service/index.ts`：对导出 API——`runBackup(category, scope, opts)`、`runBackupAll(config)`、`listBackups(category, scope)`、`restoreBackup(category, scope, fileName, targetRoot?)`、`getBackupStatus(config)`、`startBackupScheduler(getConfig)` / `stopBackupScheduler()`
- [ ] 新增 `electron/main/services/backup-service/categories.ts`：分类定义表（key/名称/每 scope 的源路径规则/默认配置），导出 `resolveSources(category, scope): string[]`（绝对路径，可能不存在则跳过）
- [ ] 新增 `electron/main/services/backup-service/zip-pack.ts`：adm-zip 打包多个源路径到 `<key>-<YYYYMMDD-HHmmss>.zip`（目录递归、相对路径保留 workspace/global 前缀）；轮换清理 `pruneOld(scope, key, keepCount)`
- [ ] 新增 `electron/main/services/backup-service/schedule.ts`：`setInterval` 30 分钟 tick + 启动即查；`isDue(category, scope, frequency)`：扫目录最新 `<key>-*.zip` 文件名时间戳 vs 频率间隔；`manual` 档永不自动触发
- [ ] `restoreBackup`：先 `runBackup` 同分类预备份 → 解压覆盖回源位（zip 内相对路径反解）；预备份失败抛错中止
- [ ] 串行队列：`enqueue(`${scope}:${key}`, task)` 模式
- [ ] 验证脚本 `tmp/verify-backup.ts`：临时目录造假数据 → 打包 → 改源 → 恢复 → 断言内容一致；轮换删除断言；isDue 各频率断言；恢复中止断言（预备份失败场景）
- [ ] `bun run lint` + `bun run build:electron` 通过

## 实施回填（做完后填）

### 实际改动
- 与计划差异：
  - `resolveSources` 改为 async（返回 `Promise<string[]>`）：tasks 分类需遍历工作区目录取每工作区 `.dogear/tasks.json`，避免同步 readdir
  - tasks 分类源路径按实际存储落地：tasks.json 是每工作区一份（`<workspace>/.dogear/tasks.json`），global scope 一份 zip 聚合全部工作区（条目带 `workspaces/<id>/` 前缀），而非设计文档字面的全局 `.dogear/tasks.json`（该文件实际不存在）
  - 新增 `uniqueBackupFileName`：同 scope+key 同秒两次备份会撞文件名且后写覆盖前写（预备份覆盖原备份导致恢复读到坏内容），实测踩中后加秒数递增避让
  - restoreBackup 的源 zip 存在性检查移入队列任务内、预备份之后：恢复全流程在队列内串行，且「备份目录损坏」场景能正确走到「预备份失败中止」分支
  - schedule.ts 的 startScheduler 接受 `runDue` 回调注入（index.ts 包装成 `startBackupScheduler(getConfig)`），避免 schedule → index 循环依赖
- 改动文件清单：
  - 新增 `electron/main/services/backup-service/categories.ts`
  - 新增 `electron/main/services/backup-service/zip-pack.ts`
  - 新增 `electron/main/services/backup-service/schedule.ts`
  - 新增 `electron/main/services/backup-service/index.ts`
  - 新增 `tmp/verify-backup.ts`（验证脚本，不 commit）

### 给下一步的接力棒
- 关键签名 / 数据结构：见共享区 step2-delivery.md（含全部 API 签名与类型）
- 下个 step 该从哪里继续：step3 settings 集成——settings.json 加 `backup` 节（类型 `BackupConfig`），主进程启动入口调 `startBackupScheduler(() => loadSettings().backup)`；tipc backup 路由直接包装 index.ts 导出的 runBackup/listBackups/restoreBackup/getBackupStatus/runBackupAll
- 待办或已知限制：
  - adm-zip 全同步 API，sessions（~239M）打包会阻塞主进程数秒，step3 UI 应提示「备份进行中」
  - restoreBackup 预备份固定用分类默认 keep（10），不读用户配置（step2 配置参数未接 settings）
  - 磁盘剩余空间预检未做（设计文档错误处理项，后置）
  - plans.json（scheduler 定时任务）不在四个分类 key 内，未备份
