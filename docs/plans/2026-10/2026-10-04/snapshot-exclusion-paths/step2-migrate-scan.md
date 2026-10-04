---
step: 2
title: 对照扫描与迁移挂载
status: done
---

## 目标
实现「默认名单 × 实际目录」对照扫描，挂到主进程启动迁移与新工作区注册钩子，存量配置自动转为路径级。

## 依赖上下文（接力棒输入）
- 前置 step 产出：step1 后 `SnapshotSettings.excludedPaths` 为唯一排除真源，`DEFAULT_SNAPSHOT_DIR_NAMES` 已导出
- 当前关键文件状态：主进程启动序列在 `electron/main/index.ts`（实施时确认 settings 初始化后的挂载点）；工作区注册入口在 workspace 相关 service（实施时定位 create/register 函数）
- 关键决策回顾：迁移幂等（`exclusionScanDone` 标记）；嵌套同名找全但已被外层路径覆盖的不重复列；扫描不受文件树 HIDDEN_NAMES 限制（.dogear/.git 本身就是要扫的名单项）

## 计划改动
- [x] 新建 `electron/main/services/snapshot-exclusion-scan.ts`：
  - `scanWorkspaceExcludedPaths(workspacePath: string): Promise<string[]>`——递归扫描，目录名命中 `DEFAULT_SNAPSHOT_DIR_NAMES` 即记相对路径并剪枝（不再深入其子树，天然去重被覆盖嵌套）；返回排序后的路径列表
  - `migrateSnapshotExclusionsIfNeeded(): Promise<void>`——读 settings，`snapshot.exclusionScanDone` 为真直接返回；否则对全部注册工作区跑扫描写入 `excludedPaths`，置标记，落盘
  - `rescanAllWorkspaceExclusions(): Promise<void>`——清空 `excludedPaths` 重新生成（保留标记），供恢复默认复合 IPC 用（step3 接）
- [x] `electron/main/index.ts` 启动序列：settings 就绪后 fire-and-forget 调 `migrateSnapshotExclusionsIfNeeded()`（失败仅 log，不阻塞启动）——实际挂载点为 main-app.ts（主进程启动序列所在）
- [x] 工作区注册钩子：注册成功后对新工作区跑 `scanWorkspaceExcludedPaths` 写入其 `excludedPaths` 条目（不影响迁移标记）——挂 workspace-json-service.ts add()

## 实施回填（做完后填）

### 实际改动
- 与计划差异：计划列三函数，实际导出四函数——新增 `scanAndStoreWorkspaceExclusions(workspaceId, workspacePath)` 供注册钩子一行调用（settings 读改写逻辑内聚在 scan 模块，workspace-json-service 不耦合 settings 结构）；
  - scan 模块内置模块级串行写队列（enqueueSettingsWrite）：迁移与注册钩子并发时后写者基于前写者落盘结果重读合并，防整落盘互相覆盖丢条目（migrate 队列内重读 settings 并二次检查标记）；
  - mergePaths 对已有 excludedPaths 条目做并集合并（防同步/手工预置条目被迁移冲掉）；rescan 则为全量重建语义
- 改动文件清单：snapshot-exclusion-scan.ts（新建）/ snapshot-exclusion-scan.test.ts（新建，3 例）/ main-app.ts（启动挂载）/ workspace-json-service.ts（add 钩子）
- 验证：`bun run build:electron` 通过；bun test 全量 540 pass / 0 fail（含新增 3 例：剪枝去重+排序正斜杠 / 深层名单目录 / 空目录与不存在路径）

### 给下一步的接力棒
- 关键签名 / 数据结构：
  - `scanWorkspaceExcludedPaths(workspacePath): Promise<string[]>`——目录名命中 DEFAULT_SNAPSHOT_DIR_NAMES 即记相对路径剪枝，输出已排序（localeCompare）且恒归一（正斜杠/无 ./ 前缀/无首尾斜杠/去重）；目录符号链接不深入防循环；目录不存在返回 []
  - `migrateSnapshotExclusionsIfNeeded(): Promise<void>`——exclusionScanDone 假时对全部注册工作区扫描并集写入并置标记；幂等
  - `rescanAllWorkspaceExclusions(): Promise<void>`——清空 excludedPaths 全量重建（仅注册工作区）并保留标记
  - `scanAndStoreWorkspaceExclusions(workspaceId, workspacePath): Promise<void>`——单工作区扫描并集写入，不动标记
- 下个 step 该从哪里继续：step3 复合 IPC（恢复默认+重新对照）在 tipc 层直接调 `rescanAllWorkspaceExclusions()`，无需自己处理标记与并发
- 待办或已知限制：
  - 备份恢复直接覆盖 workspaces.json 引入的新工作区不经 add() 钩子，且启动迁移已置标记不再扫——该路径需 step3/后续确认是否补扫描（现状：该工作区 excludedPaths 为空，快照会多收文件，无数据损失）
  - 扫描为启动后 fire-and-forget，大工作区首启迁移可能需数秒才落盘，期间快照按空排除清单跑（仅首启一次性窗口）
