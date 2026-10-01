# 备份与同步统一重构（data-registry）实施计划

**目标**：以单一数据清单 registry 为事实源，重修备份（含快照还原、失败可观测）与同步（堵数据丢失洞、墓碑删除传播）。

**架构思路**：新建 `data-registry.ts` 承载全部数据项定义（路径/敏感性/合并策略/备份分类/同步项），备份与同步全部从它派生；备份先行落地（简单且立刻有保护），同步随后堵洞，墓碑最后。设计全文见 [../backup-sync-registry-design.md](../backup-sync-registry-design.md)，审计依据见共享区 20261001-backup-audit.md / 20261001-sync-audit.md。

**涉及模块**：`electron/main/services/data-registry.ts`（新）、`backup-service/*`、`sync/*`、`tipc/backup.ts`、`tipc/sync.ts`、`settings-types.ts`、`app/data-center/version-backup/*`、`app/data-center/sync-result.tsx`

## 步骤索引

- [x] [Step 1: data-registry 模块](./step1-registry.md) — 数据项定义表 + 备份/同步派生函数 + 单测
- [x] [Step 2: 备份接 registry](./step2-backup-registry.md) — 分类源派生化、修 I-1/I-2、新增 app-config 分类、外部锚点打包
- [x] [Step 3: 备份可观测 + worker 打包](./step3-backup-observability.md) — lastError 暴露、zip 移 worker 线程、UI 状态
- [x] [Step 4: 恢复升级快照还原](./step4-restore-snapshot.md) — 删多余文件、预备份 keep、会话防护、缓存失效
- [x] [Step 5: 同步堵洞（轻量组）](./step5-sync-fixes.md) — D1 push 校验、D3 副本时间戳、F1 flag 接入、U6
- [x] [Step 6: settings 字段级三方合并](./step6-settings-merge.md) — D2 修复 + sync-state 加锁（F5）
- [x] [Step 7: 墓碑删除传播](./step7-tombstones.md) — 协议 v3、删除指令、删改冲突、UI
- [x] [Step 8: 收尾](./step8-wrapup.md) — doc-sync、轻项清理、完成总结

## 完成总结

**全部 8 步完成**（2026-10-01～03，8 个 commit：b6bed174 / 4a22564b+950efbf7 / 1092a81f / 16a7bb8a / c19670d8 / da12cedc / 08384214 / 本步）。测试 400 → 477 例（+77，0 fail），每步 build:electron + 前端 tsc 均过。

### 实际改动汇总
- **data-registry**（step1）：23 条数据项唯一事实源 + backupSourcesFor/registrySyncItems/sensitiveRelPaths 派生 + 外部锚点虚拟前缀往返工具，17 例单测锁定审计对照表
- **备份接 registry**（step2）：分类源全部派生化（I-1 tasks 外部锚点、I-2 notes-groups 补源去 dashboard.md）；新增 app-config 分类；默认配置收敛 BACKUP_CATEGORY_DEFAULTS 唯一源；zip 打包/恢复支持外部锚点
- **可观测 + worker**（step3）：last-run.json 记录每分类×scope 与调度级成败，getBackupStatus 暴露 lastError/scheduler；zip 压缩移 worker_threads（60s 超时回退主进程分片）；UI 失败红字与徽标
- **快照还原**（step4）：恢复=时点快照（zip 外文件删除限 registry 边界、空包拒绝）；预备份尊重用户 keep；sessions 恢复前运行中会话防护 + metadataCache 失效
- **同步堵洞**（step5）：push 接收端五层校验（D1，403+reason）；冲突副本时间戳+随机段（D3）；stocks/feishu 并入 excludes 统一体系（F1，消除每轮全量重拉）；required 禁关（U6）；新增 HTTP 端点级集成测试首例
- **settings 三方合并**（step6）：顶层字段级三方合并（D2，单侧变取变侧/双变保本端+warning）；基线统一磁盘原文形态防抖动；sync-state 读改写加锁（F5，三写入点全覆盖）
- **墓碑 v3**（step7）：协议升 v3，墓碑双向交换（全局、90 天/2000 条）；对端删跟随/本端删传播（DELETE /file sha256 二次校验）；删改冲突保守保留独立展示；v2 对端禁用删除传播
- **收尾**（step8）：doc-sync 补齐备份/同步两节；openBackupDir 开根目录；scope 死分支清理；dashboard.md 残留确认

### 与原计划主要偏差
1. app-config 备份源 6 文件（计划 4）：追加 workspaces.json（审计漏备点+恢复反解依据）与全局 agent.md（有真实读取链）
2. 默认配置收敛点在 settings-types.ts（计划 categories.ts）：前端无法 import 带 electron 依赖的 categories，沿用 settings-types 既有模式
3. worker 分工：主进程反解+stat、worker 纯打包（零服务依赖，无需环境注入）
4. 墓碑挂全局而非 per-peer（删除事实与 peer 无关，防第三端复活）；删改冲突独立字段 deleteConflicts 不进待裁决 conflicts（防用户误点取对端）
5. 删除执行拆两方向：对端删+本端未改本地 unlink（不经 HTTP），本端删+对端未改才走 DELETE /file
6. runSync 全链路未做自动化测试（env flake 既有坑），以单元+真 HTTP 双端串联覆盖同等路径

### 遗留给用户的验证项
- 真机：大目录备份不冻结窗口（worker 生效）；恢复快照（快照外文件删除、运行中会话防护、删除计数）；同步双端（暂停工作区推 403、离线各改 settings 字段并存/同字段保本端+warning、A 删传播 B、删改冲突保留、暂停开关不误删）
- 面板人工过一遍：五卡片+app-config、打开目录开 backups/ 根、同步结果卡删改冲突区
- 已知非缺陷语义：两端都不开冲突副本同步时 push/both 档「取本端」裁决内容推不过去（保守不丢数据）；push 接收端双改 warning 仅 console（无反向通道）；旧 zip（源范围变更前）恢复会按快照语义删除当时未备份的文件（预备份可回退）

## 全局决策

- **路径知识唯一源**：所有数据路径/清单定义只写在 `data-registry.ts`；`backup-service/categories.ts` 与 `sync/manifest.ts`、`settings-types.ts` 的 SYNC_ITEM_IDS 只消费派生结果，出现第二份硬编码路径即为 bug
- **同步协议**：Step 7 起升 v3（墓碑交换），版本不匹配复用既有 confirmVersionMismatch 流程
- **外部锚点**：configDir 外文件（tasks.json）zip 内用虚拟前缀 `__ws-external__/<wsid>/`，恢复按 workspaces.json 反解真实路径
- **恢复安全边界**：快照还原删除文件仅限 registry 声明的该分类源路径内，绝不越界
- **新增备份分类 key**：`app-config`（settings.json/plans.json/notifications.json/login-accounts.json，daily/keep10 默认）；现有分类 key 不动，notes-groups 显示名改「笔记与工作区」
- **每步完成标准**：`bun test` 通过 + `bun run build:electron` 编译通过 + stepN 回填接力棒 + 本索引打勾
