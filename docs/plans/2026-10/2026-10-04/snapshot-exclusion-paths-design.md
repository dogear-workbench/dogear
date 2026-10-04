# 快照排除目录：全路径级 + 文件树右键 设计

**背景**：设置页排除目录手动输入体验差；且原 `excludeDirs` 是名字级（任意层级同名命中），与右键排除具体目录的直觉语义不符（右键排除眼前子树，不应误伤其他同名目录）。既有否决项「文件树逐文件已保护标记」不冲突——本次标记的是**排除的**（少数派，信息量高），不是受保护的（全覆盖，纯噪音）。

**目标**：排除操作入口统一收进文件树右键（只管目录）；配置模型从名字级改为**全路径级（按工作区）**；文件树上排除目录有标记；设置页纯展示可删，无输入框。

**架构**：

- `SnapshotSettings` 删 `excludeDirs`，新增 `excludedPaths: Record<workspaceId, string[]>`（相对路径，如 `['node_modules', 'packages/a/node_modules', 'update-server']`）
- 默认 9 个名字（node_modules, out, dist, release, tmp, .dogear, .git, update-server, release2）降级为**对照名单常量**（不再是配置项）：`DEFAULT_SNAPSHOT_DIR_NAMES`
- **启动迁移**：主进程启动时检测未迁移标记 → 对每个注册工作区递归扫描对照名单命中的实际目录 → 生成各工作区 `excludedPaths` 落盘；嵌套同名目录找全，但已被外层路径前缀覆盖的不重复列；扫完打标记幂等
- **新工作区注册钩子**：注册时自动跑一遍对照扫描，开局即有默认排除（堵住新工作区 node_modules 裸奔进快照的死角）
- **「恢复默认」= 重新对照**：阈值/窗口回推荐值 + 开关全开 + 重跑对照扫描刷新全部 `excludedPaths`；确认弹窗文案说明
- **pathspec 锚定**：shadow.ts 打快照时 exclude pathspec 统一 `./` 前缀（顶层 `node_modules` 不带前缀会被 git 当作任意层级名字匹配，语义漂移）
- **判定**：段前缀匹配——relPath 段数组以排除路径段数组为前缀即命中；优先级 disabled > excluded > size 不变；历史面板空态文案不变
- **右键交互（目录）**：未排除 → 「从快照排除」（写路径级 + toast）；精确命中 → 「恢复快照保护」；被父路径覆盖 → 禁用态「已被 …/xxx 排除」；不弹确认（可再右键恢复）。文件无排除菜单项
- **标记**：目录名旁 `EyeOff` 小图标 + tooltip 说明原因；不递归标子项；不做淡化样式

**模块边界**：

- `electron/main/services/settings-types.ts`：结构变更 + `normalizeSnapshotSettings` 兼容旧字段（读 `excludeDirs` 忽略）+ 对照名单常量
- `electron/main/services/git-service/shadow-protection.ts`：判定改段前缀匹配（单测同步更新）
- `electron/main/services/git-service/shadow.ts`：pathspec 拼装（`./` 前缀 + 当前工作区路径列表）
- 对照扫描：新模块（含迁移标记读写 + 单工作区扫描函数），挂到主进程启动序列与工作区注册钩子
- `electron/main/tipc/`：新增 `getSnapshotExclusions({workspaceId})`（轻量只读）与 `addSnapshotExcludedPath` / `removeSnapshotExcludedPath`（主进程读改写 settings，避免前端全量回写）
- `components/workspace-explorer/TreeItemRow.tsx` + `components/WorkspaceExplorer.tsx`：目录右键菜单项（三分支）+ EyeOff 标记 + 数据拉取与乐观更新
- `app/settings/SnapshotConfigSection.tsx`：删输入框与添加按钮；路径级按工作区分组展示（相对路径）+ 点 X 删除；阈值/保留窗口/恢复默认保留

**数据流**：右键 → 专用 IPC → 主进程读改写 `settings.json` → 返回新列表 → 文件树乐观更新；设置页 X 删除 → 既有 local/setLocal 防抖链路 → settings 变更事件广播 → 文件树刷新；打快照 → `loadSettings` → `excludedPaths[wsId]` → pathspec。

**错误处理 / 边界情况**：

- 目录重命名/移动 → 旧条目僵尸，不自动清理，设置页 X 手动删（YAGNI）
- 工作区注销 → 其条目残留，不自动联动，「恢复默认」清理
- 排除路径含空格等特殊字符 → pathspec 转义，实施时验证
- 已有工作区内新冒出的嵌套同名目录（monorepo 新包）→ 唯一不被自动覆盖的场景：右键排除或「恢复默认」重扫
- 已排除目录内部变化（装新依赖等）→ 子树语义全覆盖，不进快照

**未决问题**：

- settings 变更广播到文件树刷新的具体事件机制（实施时确认现有广播能力）
- 迁移扫描在 main.ts 启动序列中的挂载点（实施时确认）
