# 快照排除目录全路径化 实施计划

**目标**：排除目录从名字级改为按工作区的全路径级，操作入口收进文件树右键（标记 EyeOff、toast 反馈），设置页纯展示可删，旧配置启动时自动对照迁移。

**架构思路**：`SnapshotSettings.excludeDirs`（名字级）删除，换成 `excludedPaths: Record<workspaceId, string[]>`；默认 9 名字降级为对照名单常量，用于启动迁移、新工作区注册、「恢复默认」重扫三处生成初始路径清单；打快照 pathspec 统一 `./` 前缀锚定；判定改段前缀匹配。排除了「保留名字级 + 右键写路径级」的混合模型（用户拍板全路径级）与「配置化任务类型装载」（另一话题，纯展示）。

**涉及模块**：`electron/main/services/settings-types.ts`、`git-service/shadow-protection.ts`、`git-service/shadow.ts`、新扫描模块（`services/`）、`electron/main/tipc/git.ts`、`components/WorkspaceExplorer.tsx`、`components/workspace-explorer/TreeItemRow.tsx`、`app/settings/SnapshotConfigSection.tsx`

## 步骤索引

- [x] [Step 1: 模型与判定原子改造](./step1-model-judge.md) — 删 excludeDirs 换 excludedPaths，判定改段前缀，pathspec `./` 锚定，编译级原子变更
- [x] [Step 2: 对照扫描与迁移挂载](./step2-migrate-scan.md) — 扫描模块 + 启动迁移 + 新工作区注册钩子
- [x] [Step 3: 排除操作 IPC](./step3-ipc.md) — 读/增/删/重扫/恢复默认 五条路由
- [x] [Step 4: 文件树右键与标记](./step4-filetree.md) — 目录右键三分支 + EyeOff + 乐观更新
- [ ] [Step 5: 设置页展示改造](./step5-settings.md) — 去输入框、按工作区分组展示、恢复默认走复合 IPC

## 全局决策

- pathspec 统一 `./` 前缀锚定：顶层 `node_modules` 不加前缀会被 git 当任意层级名字匹配，语义漂移
- 判定语义：relPath 按 `/` 切段，以排除路径段数组为前缀即命中（子树全覆盖）；优先级 disabled > excluded > size 不变
- 默认名单 `DEFAULT_SNAPSHOT_DIR_NAMES` 只存在于主进程 settings-types（前端零硬编码），仅用于对照扫描三处（迁移/新工作区/恢复默认），不再直接参与运行时判定
- 两条写路径并存：文件树右键走专用 IPC（主进程读改写），设置页走既有 local/setLocal 防抖链路；设置页为全屏 overlay，两者 UI 层互斥，并发覆盖窗口不存在（设置页开着时文件树不可右键）
- 迁移幂等：`SnapshotSettings` 加迁移标记字段，扫描完成落盘一次即不再跑；「恢复默认」与「重新对照」为同一复合 IPC（主进程原子完成重置+重扫）
- 右键不弹确认（可再右键恢复），toast 反馈；文件无排除菜单项；不做子项递归标记
- 主进程改动每步 `build:electron` 验证；`shadow-protection.test.ts` 随 step1 同步更新
