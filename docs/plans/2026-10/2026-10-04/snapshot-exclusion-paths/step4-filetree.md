---
step: 4
title: 文件树右键与标记
status: done
---

## 目标
文件树目录右键可排除/恢复快照保护，排除目录带 EyeOff 标记，右键后乐观更新。

## 依赖上下文（接力棒输入）
- 前置 step 产出：step3 的 `getSnapshotExclusions` / `addSnapshotExcludedPath` / `removeSnapshotExcludedPath` 可用
- 当前关键文件状态：`components/workspace-explorer/TreeItemRow.tsx` 有文件/文件夹两套 ContextMenu（文件夹菜单在 :202 起，含新建/重命名/历史/在资源管理器打开/删除）；「历史」项由 git 能力检测门控渲染；`components/WorkspaceExplorer.tsx` 持有树状态与 handlers（onRename 等 props 下传模式）
- 关键决策回顾：只管目录，文件无排除菜单；三分支菜单（排除/恢复/禁用说明「已被 …/x 排除」）；标记只标目录本身不递归子项；不弹确认、toast 反馈；右键语义即路径级，无全局副作用

## 计划改动
- [x] `WorkspaceExplorer.tsx`：mount 与 workspace 切换时拉 `getSnapshotExclusions` 存 `Set<string>`（规范化相对路径）；右键 handler 调 add/remove IPC，成功后本地更新 Set；设置页保存的 settings 变更刷新机制（实施时确认现有广播，无则接受重进树刷新并在代码注明）——广播存在，监听 settingsChanged 重拉
- [x] `TreeItemRow.tsx`：文件夹菜单加排除项（git 可用时渲染，与「历史」同门控，判定函数落 tree-model.ts findExclusionEntry）：
  - 路径不在任何排除条目的子树内 → 「从快照排除」
  - 精确命中条目 → 「恢复快照保护」
  - 被某条目前缀覆盖 → 禁用项「已被 …/xxx 排除」
  - 前缀判定用段数组比较（与主进程判定语义一致，前端小函数）
- [x] 目录行渲染：命中（精确）时名称旁 `EyeOff` 图标（lucide 已有依赖），tooltip「该目录已排除出自动快照」
- [x] toast 文案：排除「已排除 {name}，不再进入自动快照」/ 恢复「已恢复 {name} 的快照保护」

## 实施回填（做完后填）

### 实际改动
- 与计划差异：
  - 「设置页保存的 settings 变更刷新机制」实施确认：现有广播存在（`updateSettings` 链路无条件广播 `settingsChanged`，renderer-handlers.ts:210），未采用「接受重进树刷新」降级方案——文件树监听 `rendererEvents.settingsChanged` 重拉清单，设置页直改清单（step5 走 local/setLocal → updateSettings）可实时跟上
  - 已知覆盖缺口：设置页「恢复默认」走 `restoreSnapshotDefaults` 复合 IPC 仅落盘不广播，文件树感知不到（直到切工作区/mount）；影响仅限恢复默认后子树菜单着色可能过期，且右键操作本身幂等精确无破坏性。若 step5 要求立即感知，可在该路由补一行 `broadcastSettingsChanged()`（主进程一行，待 step5 验收时定，未擅改 step3 产出）
  - 判定函数落在 `tree-model.ts`（`findExclusionEntry`）而非 TreeItemRow 内联：与 `isArticlePath` 等树模型判定同处，且需区分「精确命中/前缀覆盖」两态，返回命中条目本身（null 未命中）供菜单复用，不止布尔
  - EyeOff 标记用原生 `title` 包 span（跟随既有 Lock 图标模式），非 radix tooltip；仅标精确命中条目本身，被前缀覆盖的子目录不标（计划「只标目录本身」）
- 改动文件清单：tree-model.ts（新增 findExclusionEntry 导出）/ WorkspaceExplorer.tsx（excludedPaths state + refreshExclusions + 两个 effect + handleExcludeFolder/handleRestoreFolder + props 下传）/ TreeItemRow.tsx（新增三 props + exclusionEntry 判定 + 三分支菜单项 + EyeOff 标记）
- 验证：eslint 三文件零输出；tsc 全量 8 个错误均为存量（app/settings/SnapshotConfigSection.tsx 的旧字段 excludeDirs，step5 范围），改动文件零新增；未动主进程无需 build:electron

### 给下一步的接力棒
- 关键签名 / 数据结构：
  - `findExclusionEntry(relPath: string, excludedPaths: ReadonlySet<string>): string | null`（tree-model.ts）：语义对齐主进程 `isExcludedRelPath`（段数组前缀覆盖），精确命中短路返回，覆盖命中返回首个覆盖条目
  - WorkspaceExplorer 新增 props 下传：`excludedPaths: ReadonlySet<string>` / `onExcludeFolder(path, name)` / `onRestoreFolder(path, name)`；handlers 用 IPC 返回的 paths 整体替换本地 Set，不重拉；错误 toast 直接展示路由返回文案
  - 刷新时机：mount + workspace.id 变化 + settingsChanged 广播；三处均调 refreshExclusions（内含无工作区清空分支）
- 下个 step 该从哪里继续：step5 设置页——「恢复默认」直接用 `restoreSnapshotDefaults()` 返回的 snapshot 更新 local；若需文件树立即感知恢复默认，建议给该路由补广播（见上）；设置页展示 excludedPaths 遍历分组时注意删空键已移除（step3 已处理）
- 待办或已知限制：
  - 恢复默认（复合 IPC）不广播，文件树在「设置页恢复默认后、未切工作区」窗口内着色可能过期（幂等操作无实害）
  - 目录重命名/删除不联动清理 excludedPaths 旧条目（孤儿条目判定永不命中、无实害，「恢复默认」重扫会清）；step3 既有行为，未改
  - 文章区目录（isArticleFolder 分支）不提供排除菜单项：文章区有自己的管理逻辑，排除入口仅普通文件区目录
