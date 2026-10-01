---
step: 2
title: 前端跳过状态展示
status: pending
---

## 目标
备份面板 scope 行展示「内容无变化，已跳过（时间）」浅色提示，用户可一眼识别静止工作区。

## 依赖上下文（接力棒输入）
- 前置 step 产出：[step1-skip-pipeline.md] BackupScopeStatus 加 `lastSkippedAt: string | null`（getBackupStatus 返回，tipc 类型自动推导）
- 当前关键文件状态：`app/data-center/version-backup/CategoryCard.tsx` scope 行已有 count/lastBackupAt/lastError 三行信息（`row.count 份 · 最近 formatTime(row.lastBackupAt)`），due 徽标、失败徽标并列
- 关键决策回顾：不做跳过计数，只展示最近一次跳过时间；样式为浅色（text-muted-foreground）单行，与 lastError 红字行同级但非警示色

## 计划改动
- [ ] `backup-meta.ts`：BackupScopeStatus 为 tipc 推导类型自动跟随，确认无需手改；如有本地 mock/注释同步
- [ ] `CategoryCard.tsx`：row.lastSkippedAt 非空时在「N 份 · 最近 X」行下加 `内容无变化，已跳过（formatListTime）` 浅色行
- [ ] 构建验证：`bun run build`（或既有 build script）通过；主进程改动需 `build:electron`
- [ ] doc-sync：docs/codebase-map/data-center.md 的 version-backup 描述补「无变化跳过」

## 实施回填（做完后填）

### 实际改动
- 与计划差异：
- 改动文件清单：

### 给下一步的接力棒
- 关键签名 / 数据结构：
- 下个 step 该从哪里继续：
- 待办或已知限制：
