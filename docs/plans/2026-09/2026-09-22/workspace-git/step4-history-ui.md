---
step: 4
title: 文件树历史 UI
status: pending
---

## 目标
文件树右键「历史」入口：该文件双源时间线（时间 + 来源标识）+ 简单 diff 查看 + 恢复按钮。

## 依赖上下文（接力棒输入）
- 前置 step 产出：step1 `getFileHistory(workspaceId, workspacePath, relPath)` 双源合并时间线与 `SnapshotEntry` 结构、`restoreFromSnapshot` 签名
- 关键现状：`components/WorkspaceExplorer.tsx` 已有右键菜单体系（ContextMenu + 重命名/删除/引用项）；tipc 路由范式见 `electron/main/tipc/explorer.ts`；渲染层禁直连 fs，一律走 IPC；恢复确认用 confirm-store 的 showConfirm()（禁 window.confirm）
- hasGit() 为 false 时入口不渲染（IPC 透出能力检测）

## 计划改动
- [ ] tipc 新增（explorer.ts 或新 `git.ts` 路由）：`getFileHistory` / `restoreSnapshot` / git 能力检测透出
- [ ] `components/WorkspaceExplorer.tsx`：文件/文件夹右键菜单加「历史」项（hasGit 才显示）
- [ ] 新组件 `components/FileHistoryPanel.tsx`（或 Dialog）：时间线列表（hash 短显、时间、来源徽标：agent/你/外部/恢复前）、点选看简单文本 diff（旧 vs 新，纯文本行级对比，语法高亮后置）、影子快照条目带「恢复」按钮（用户仓库 commit 只读展示，恢复走 agent 或外部——UI 不提供对用户仓库的写操作）
- [ ] 恢复交互：showConfirm 确认（提示会先打恢复前快照）→ IPC restoreSnapshot → toast + 刷新文件树
- [ ] 验证：右键任意文件看双源历史；恢复到某快照 → 文件内容回退 + 出现 `[snapshot] pre-restore` 记录；无 git 环境降级不显示入口

## 实施回填（做完后填）

### 实际改动
- 与计划差异：
- 改动文件清单：

### 给下一步的接力棒
- 关键签名 / 数据结构：
- 下个 step 该从哪里继续：
- 待办或已知限制：
