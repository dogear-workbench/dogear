---
step: 5
title: 设置页展示改造
status: pending
---

## 目标
SnapshotConfigSection 去输入框，排除区改按工作区分组纯展示（可删），恢复默认走复合 IPC 并更新文案。

## 依赖上下文（接力棒输入）
- 前置 step 产出：step3 `removeSnapshotExcludedPath` / `restoreSnapshotDefaults` 可用；`excludedPaths` 在 `AppSettings.snapshot` 内（设置页 local 可见）
- 当前关键文件状态：`app/settings/SnapshotConfigSection.tsx`（step3 of 旧任务产物）：阈值 MB 输入、排除目录标签编辑（dirDraft/addDir/removeDir）、保留窗口双数字、恢复默认（setLocal 整体替换）
- 关键决策回顾：设置页与文件树 UI 层互斥（全屏 overlay），两条写路径无并发窗口；恢复默认必须主进程单点完成（local 保存与重扫两步会互相覆盖）

## 计划改动
- [ ] `SnapshotConfigSection.tsx`：
  - 删 dirDraft / addDir / removeDir 与添加输入框、「添加」按钮
  - 排除区改「按工作区分组」：遍历 `local.snapshot.excludedPaths`，组头=工作区名（需工作区列表，从 props 或 client.getAll 取，实施时看设置页已有数据源），组内相对路径 Badge 列表 + X 删除（走 `removeSnapshotExcludedPath` IPC 后重拉 settings，不走 local 链路——保持与文件树同源写路径）
  - 未注册工作区的残留条目：整组不展示（数据不清理）
  - 恢复默认按钮：确认文案改为「大小阈值、保留窗口还原为推荐值，所有工作区快照开关重新打开，排除目录按当前磁盘状态重新对照生成」；点击走 `restoreSnapshotDefaults()` IPC → 成功后重拉 settings 更新 local
- [ ] 阈值 / 保留窗口输入保持 local/setLocal 防抖链路不变

## 实施回填（做完后填）

### 实际改动
- 与计划差异：
- 改动文件清单：

### 给下一步的接力棒
- 关键签名 / 数据结构：
- 下个 step 该从哪里继续：
- 待办或已知限制：
