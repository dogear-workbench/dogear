---
step: 1
title: 快照规则收窄（settings 类型 + shadow 接入）
status: done
---

## 目标
agent/UI 触发快照时：按工作区开关可跳过；排除目录可配置；单文件超大小阈值不进快照。

## 依赖上下文（接力棒输入）
- 前置产出：设计文档 [../shadow-snapshot-slimming-design.md](../shadow-snapshot-slimming-design.md)；现状代码 `electron/main/services/git-service/shadow.ts`（takeSnapshot:122、excludePathspecs:88、SHADOW_EXCLUDE_DIRS:31、队列 shadow.ts:41-51）
- 关键现状：excludePathspecs 目前硬编码 7 个目录；无大小过滤；无开关
- settings 模式参考：`settings-types.ts` 的 `BackupSettings` / `BACKUP_CATEGORY_DEFAULTS`（:106-130）

## 计划改动
- [ ] `electron/main/services/settings-types.ts`：新增 `SnapshotSettings` 接口（`maxFileSizeBytes`、`excludeDirs: string[]`、`retentionDays`/窗口参数、`disabledWorkspaces?: string[]`）+ `SNAPSHOT_SETTING_DEFAULTS` 常量；`AppSettings` 挂 `snapshot?: SnapshotSettings` 字段
- [ ] `electron/main/services/settings-diff.ts`：补 snapshot 域映射（perCall 读取即可，快照每次现读配置）
- [ ] `electron/main/services/git-service/shadow.ts`：`SHADOW_EXCLUDE_DIRS` 改为「默认值 + settings 覆盖」合并逻辑；`takeSnapshot()` 开头查 disabledWorkspaces 命中则直接返回；add 后按 `git diff --cached` 枚举新增 blob 超阈值的 pathspec 做 unstage
- [ ] 大小过滤辅助函数：输入暂存区文件列表 + 阈值，返回需剔除的路径（用 `git ls-files -s --cached` + blob size，避免读文件内容）

## 实施回填（做完后填）

### 实际改动
- 与计划差异：
  - 大小过滤枚举由计划的 `git ls-files -s --cached` 改为 `git diff --cached --raw -z --no-renames --diff-filter=AM`（一条命令同拿路径+新 blob hash，天然只覆盖新增/变更）
  - blob 大小由逐个 `cat-file -s` 改为一次进程 `cat-file --batch-check` 批量（首次快照几千文件时逐个是几十秒级）；为此 exec.ts 新增 `execGitInput(cwd, args, input)` stdin 变体（计划未列的必要支撑）
  - 保留窗口字段定为 `retention: { recentDays, totalDays }`（可表达标准档 7/30 及任意变体），优于计划中含糊的 retentionDays
- 改动文件清单：
  - `electron/main/services/settings-types.ts`：SnapshotRetention/SnapshotSettings 类型 + SNAPSHOT_SETTING_DEFAULTS + normalizeSnapshotSettings（幂等，接入 loadSettings 落盘链）
  - `electron/main/services/settings-service.ts`：normalizeSettings 接入 snapshot 归一化（照 backup 模式）
  - `electron/main/services/settings-diff.ts`：域映射表补 snapshot → perCall 一行
  - `electron/main/services/git-service/exec.ts`：新增 execGitInput（spawn 流式收 stdout，无 maxBuffer 上限）
  - `electron/main/services/git-service/shadow.ts`：开关短路（在 ensureShadowRepo 之前，关闭的工作区不建目录）+ excludePathspecs 参数化（整列表覆盖非并集）+ unstageOversized

### 给下一步的接力棒
- 关键签名 / 数据结构：
  - `SnapshotSettings = { maxFileSizeBytes: number; excludeDirs: string[]; retention: { recentDays; totalDays }; disabledWorkspaces?: string[] }`，默认 8MB / 9 目录 / 7-30 / []
  - 配置读取：`(await loadSettings()).snapshot ?? structuredClone(SNAPSHOT_SETTING_DEFAULTS)`（运行时恒存在）
  - `execGitInput(cwd, args, input)` 可用于批处理 git 接口
  - 互斥：裁剪/瘦身走 shadow.ts 现有 `enqueue(workspaceId, task)` 即与快照串行
- 下个 step 该从哪里继续：step2 保留窗口裁剪直接消费 `snapshot.retention`（normalize 保证 totalDays≥recentDays≥1 整数，无需防御）
- 待办或已知限制：无阻塞；已验证 unborn HEAD 首次快照、中文路径、:(literal) 通配字符安全
