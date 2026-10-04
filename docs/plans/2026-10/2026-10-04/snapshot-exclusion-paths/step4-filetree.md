---
step: 4
title: 文件树右键与标记
status: pending
---

## 目标
文件树目录右键可排除/恢复快照保护，排除目录带 EyeOff 标记，右键后乐观更新。

## 依赖上下文（接力棒输入）
- 前置 step 产出：step3 的 `getSnapshotExclusions` / `addSnapshotExcludedPath` / `removeSnapshotExcludedPath` 可用
- 当前关键文件状态：`components/workspace-explorer/TreeItemRow.tsx` 有文件/文件夹两套 ContextMenu（文件夹菜单在 :202 起，含新建/重命名/历史/在资源管理器打开/删除）；「历史」项由 git 能力检测门控渲染；`components/WorkspaceExplorer.tsx` 持有树状态与 handlers（onRename 等 props 下传模式）
- 关键决策回顾：只管目录，文件无排除菜单；三分支菜单（排除/恢复/禁用说明「已被 …/x 排除」）；标记只标目录本身不递归子项；不弹确认、toast 反馈；右键语义即路径级，无全局副作用

## 计划改动
- [ ] `WorkspaceExplorer.tsx`：mount 与 workspace 切换时拉 `getSnapshotExclusions` 存 `Set<string>`（规范化相对路径）；右键 handler 调 add/remove IPC，成功后本地更新 Set；设置页保存的 settings 变更刷新机制（实施时确认现有广播，无则接受重进树刷新并在代码注明）
- [ ] `TreeItemRow.tsx`：文件夹菜单加排除项（git 可用时渲染，与「历史」同门控）：
  - 路径不在任何排除条目的子树内 → 「从快照排除」
  - 精确命中条目 → 「恢复快照保护」
  - 被某条目前缀覆盖 → 禁用项「已被 …/xxx 排除」
  - 前缀判定用段数组比较（与主进程判定语义一致，前端小函数）
- [ ] 目录行渲染：命中（精确）时名称旁 `EyeOff` 图标（lucide 已有依赖），tooltip「该目录已排除出自动快照」
- [ ] toast 文案：排除「已排除 {name}，不再进入自动快照」/ 恢复「已恢复 {name} 的快照保护」

## 实施回填（做完后填）

### 实际改动
- 与计划差异：
- 改动文件清单：

### 给下一步的接力棒
- 关键签名 / 数据结构：
- 下个 step 该从哪里继续：
- 待办或已知限制：
