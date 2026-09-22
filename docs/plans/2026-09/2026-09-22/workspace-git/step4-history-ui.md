---
step: 4
title: 文件树历史 UI
status: done
---

## 目标
文件树右键「历史」入口：该文件双源时间线（时间 + 来源标识）+ 简单 diff 查看 + 恢复按钮。

## 依赖上下文（接力棒输入）
- 前置 step 产出：step1 `getFileHistory(workspaceId, workspacePath, relPath)` 双源合并时间线与 `SnapshotEntry` 结构、`restoreFromSnapshot` 签名
- 关键现状：`components/WorkspaceExplorer.tsx` 已有右键菜单体系（ContextMenu + 重命名/删除/引用项）；tipc 路由范式见 `electron/main/tipc/explorer.ts`；渲染层禁直连 fs，一律走 IPC；恢复确认用 confirm-store 的 showConfirm()（禁 window.confirm）
- hasGit() 为 false 时入口不渲染（IPC 透出能力检测）

## 计划改动
- [x] tipc 新增（explorer.ts 或新 `git.ts` 路由）：`getFileHistory` / `restoreSnapshot` / git 能力检测透出
- [x] `components/WorkspaceExplorer.tsx`：文件/文件夹右键菜单加「历史」项（hasGit 才显示）
- [x] 新组件 `components/FileHistoryPanel.tsx`（或 Dialog）：时间线列表（hash 短显、时间、来源徽标：agent/你/外部/恢复前）、点选看简单文本 diff（旧 vs 新，纯文本行级对比，语法高亮后置）、影子快照条目带「恢复」按钮（用户仓库 commit 只读展示，恢复走 agent 或外部——UI 不提供对用户仓库的写操作）
- [x] 恢复交互：showConfirm 确认（提示会先打恢复前快照）→ IPC restoreSnapshot → toast + 刷新文件树
- [x] 验证：右键任意文件看双源历史；恢复到某快照 → 文件内容回退 + 出现 `[snapshot] pre-restore` 记录；无 git 环境降级不显示入口

## 实施回填（做完后填）

### 实际改动
- 与计划差异：
  - 新增 tipc 路由文件 `git.ts`（不入 explorer.ts，独立能力域）；除计划的 3 个路由外加 `getHistoryFileContent`（diff 需拿历史版本内容，影子/用户仓库双源分发）
  - diff 语义取「选中版本 vs 时间线上相邻更旧条目」（全走历史 API，不依赖当前文件状态），最旧条目视为空基准（全量新增）；文件夹条目不做内容对比（提示后整体恢复）
  - 「历史」入口只加在文件区普通文件/文件夹分支；文章节点与文章文件夹未加（其写路径走 article-service 元数据体系，快照恢复存在元数据一致性风险，保守排除，后续需要再单独评估）
  - FileHistoryPanel 同时挂主窗口 app/page.tsx 与独立会话窗口 app/session-window/page.tsx（CompanionPanel 内文件树是 WorkspaceExplorer 的第二宿主）
  - 顺手修复 step1 产出 getFileHistory 的排序比较器 bug：time 相等时返回 -1 而非 0，同秒快照/提交乱序
- 改动文件清单：
  - 新增 `electron/main/tipc/git.ts`（getGitCapability/getFileHistory/restoreSnapshot/getHistoryFileContent，GitServiceError 统一转 `{ error }`）
  - 新增 `components/FileHistoryPanel.tsx`（Dialog：左侧时间线 + 右侧 diff + 恢复按钮）、`components/file-history/HistoryDiffView.tsx`、`lib/line-diff.ts`（LCS 行级 diff + 公共前后缀裁剪，>20000 行返回 null 降级）、`stores/git-history-store.ts`（open/target/gitAvailable）
  - 修改 `electron/main/services/git-service/shadow.ts`（+getShadowFileContent）、`user-repo.ts`（+getUserRepoFileContent）、`history.ts`（排序修复）、`electron/main/tipc/index.ts`（注册 gitRouter）、`components/WorkspaceExplorer.tsx`（右键菜单「历史」项 + 挂载时能力检测）、`types/electron-api.ts`（FileHistoryEntry 镜像类型）、`app/page.tsx` + `app/session-window/page.tsx`（挂载面板）
  - 验证脚本：`tmp/verify-step4.test.ts` + `tmp/verify-step4-nogit-probe.ts`（bun test，git ignored）

### 给下一步的接力棒
- 关键签名 / 数据结构：
  - tipc：`getGitCapability() → { available }`；`getFileHistory({ workspaceId, relPath }) → { history: FileHistoryEntry[] } | { error }`；`restoreSnapshot({ workspaceId, ref, relPath? }) → { success } | { error }`；`getHistoryFileContent({ workspaceId, source: 'shadow'|'repo', ref, relPath }) → { content: string | null } | { error }`（null=对象不存在）
  - service：`getShadowFileContent(workspaceId, ws, ref, relPath)`、`getUserRepoFileContent(ws, ref, relPath)`（均 cat-file -e 预检 + git show <ref>:<path>）
  - UI 状态：`useGitHistoryStore`（open/target/gitAvailable）；WorkspaceExplorer 挂载时 checkGitAvailable() 一次
- 下个 step 该从哪里继续：计划五个 step 已全部完成；后续可选项见「待办」
- 待办或已知限制：
  - diff 仅行级纯文本（语法高亮后置，按计划）；diff 视图 >5000 行截断渲染、>20000 行不对比
  - 恢复仅针对影子快照条目（repo 条目只读展示，按钮不渲染）；恢复到 repo hash 会被影子仓库对象缺失拒绝（test 已验证 error 路径）
  - 文章节点/文章文件夹无历史入口（见与计划差异）
  - 快照密集合并为一提交，UI 按实际条目展示（无"一操作一提交"假设）
  - UI 交互未经真人点击验证（无人值守），已用 tipc 层直调脚本覆盖数据链路（26 断言全过）
