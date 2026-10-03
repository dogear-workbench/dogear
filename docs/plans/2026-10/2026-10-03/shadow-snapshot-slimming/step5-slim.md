---
step: 5
title: 存量瘦身
status: done
---

## 目标
当前源码工作区的影子仓库从 1.3GB 瘦到几十 MB：设置卡提供「立即瘦身」按钮（带确认），按新规则重写全部历史 + gc，释放被旧 exe 钉死的 ~1.2GB。

## 依赖上下文（接力棒输入）
- 前置 step 产出：[step2-retention.md] 已有 `pruneSnapshotHistory()` 重写机制（本步复用/扩展其重写能力）；[step3-settings-ui.md] 设置卡已就位，本步补按钮
- 当前关键文件状态：`.dogear/workspaces/db291a2d…/shadow-git/` loose 1.02GiB + pack 196MiB，528 commits，18 个安装包 blob ≈1.15GiB 被历史钉死（仅 gc 无效，blob 全部可达）
- 关键决策回顾：历史重写只允许用户手动触发 + 确认（设计文档明确），不做自动

## 计划改动
- [ ] `electron/main/services/git-service/shadow.ts`：新增 `slimShadowRepo()`——遍历全部历史 commit，按当前阈值/排除规则剔除大文件 path（重写每棵 tree），再 `git reflog expire --expire=now --all && git gc --prune=now`；入队串行
- [ ] IPC 路由（`electron/main/tipc/git.ts`）：`slimShadowRepo` 暴露 + 前置体积/预估收益返回（可选：扫描 blob 汇总可释放量给确认弹窗用）
- [ ] `app/settings/WorkspaceManagementTab.tsx`：状态卡加「立即瘦身」按钮 → showConfirm（说明将重写快照历史、耗时、可释放量预估）→ 执行 → 完成后刷新体积显示；用 confirm-store，不用 window.confirm
- [ ] 执行中互斥：复用串行队列；瘦身期间快照/恢复排队等待

## 验证
- 对当前工作区执行后：shadow-git 目录 ≤ ~50MB；GitSnapshotList 仍能列出近期快照且可恢复（抽一个旧文件恢复验证 blob 完整）
- 主进程改动 `build:electron` 后在应用内完成上述操作

## 实施回填（做完后填）

### 实际改动
- 与计划差异：
  - 关键坑（计划外）：影子仓库 `.git/index` 暂存着上次 `add -A` 的全量状态，钉住磁盘上仍存在的被剔 blob，gc 剪不掉——gc 前加 `read-tree --empty`（下次快照 add 会重建 index，无副作用）；prune 不受此坑影响（index 引用的当前文件 blob 在新链本就可达）
  - 耗时实测 4.2 分钟（非预估 1-2 分钟），确认文案用「约需数分钟」
  - prune 存量收益为零：528 条快照全部落在近 7 天窗口内（9/27~10/2），窗口裁剪不触发，收益全部来自阈值+排除目录重写
  - 「前置体积/预估收益扫描接口（可选）」未做：确认弹窗直接用现有 summary 汇总，瘦身后 toast 报实测释放量
  - commit raw 批量读用 cat-file --batch + Buffer 按字节数切分（多字节 UTF-8 下 JS 字符串长度 ≠ 字节数），exec.ts 未动，shadow-slim.ts 内部 spawn 变体
- 改动文件清单：
  - `electron/main/services/git-service/shadow-slim.ts`（新）：`slimShadowRepo(gitDir, workspacePath, settings)` 核心 + `dirSizeBytes`；预扫描批量收集（ls-tree 图 / batch-check blob 大小 / batch 读 commit raw）→ 内存自底向上重写 tree（prefix+hash 缓存、空 subtree 连锁剔除）→ 重建链 → CAS update-ref → reflog expire → read-tree --empty → gc → 顺带 pruneSnapshotHistory
  - `electron/main/services/git-service/shadow-slim.test.ts`（新）：5 集成用例（大 blob/排除目录剔除、字节级恢复、noop、非快照 commit 防御）
  - `electron/main/services/git-service/shadow.ts`：`slimShadowRepoInQueue(workspaceId, workspacePath)` 队列入口（loadSettings + enqueue）；getShadowRepoSizeBytes 复用 dirSizeBytes 消重
  - `electron/main/services/git-service/shadow-prune.ts`：listSnapshotChain 导出供 slim 复用
  - `electron/main/services/git-service/index.ts`：export shadow-slim
  - `electron/main/tipc/git.ts`：slimShadowRepo 路由
  - `app/settings/SnapshotConfigSection.tsx`：底部「存量瘦身」区（体积/条数汇总 + 立即瘦身按钮 showConfirm → 逐工作区执行 → toast 实测释放量）
  - `app/settings/WorkspaceManagementTab.tsx`：传 workspaces/summaries/onRefreshSummaries

### 真实仓库执行数据（计划「验证」段）
- C:\dogear 影子仓库：1,307,517,316 → 6,766,431 bytes（1.307GB → 6.77MB），252.4s，status=done，528 条全保留（均在窗口内）
- 验证：fsck --connectivity-only 过；链唯一根；最早/中期 commit 文件内容字节级可恢复；大 blob（安装包 exe）从对象库消失；对象库收为单 pack 6.37MiB
- 执行前备份：%LOCALAPPDATA%\Temp\shadow-git-backup-1003（1.217GB），应用重启抽查后可删

### 给下一步的接力棒
- 关键签名 / 数据结构：
  - `SlimShadowResult = { status: 'done'|'noop'|'skipped'; commitsBefore; commitsAfter; sizeBytesBefore; sizeBytesAfter }`
  - 入口链：UI → `client.slimShadowRepo({ workspaceId })` → gitRouter → `slimShadowRepoInQueue(id, path)` → enqueue → `slimShadowRepo(gitDir, path, settings)`；与 takeSnapshot/restore/prune 共队列互斥
- 下个 step 该从哪里继续：step6 sessions 备份拆分（backup-service/categories.ts + data-registry.ts，与影子快照模块无交集）
- 待办或已知限制：
  - 运行中的应用是旧版（无收窄逻辑），重启前触发快照会把大文件写回——需重启应用生效新逻辑
  - 应用内 GitSnapshotList 列快照+恢复的最终验证需重启应用后人工抽查（git 层内容完整性已充分验证）
  - 其他工作区快照库未逐一瘦身，用户可在设置页一键执行
