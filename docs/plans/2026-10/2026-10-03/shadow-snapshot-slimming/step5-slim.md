---
step: 5
title: 存量瘦身
status: pending
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
- 改动文件清单：

### 给下一步的接力棒
- 关键签名 / 数据结构：
- 下个 step 该从哪里继续：
- 待办或已知限制：
