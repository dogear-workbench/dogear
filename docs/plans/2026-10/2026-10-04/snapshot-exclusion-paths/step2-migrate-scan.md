---
step: 2
title: 对照扫描与迁移挂载
status: pending
---

## 目标
实现「默认名单 × 实际目录」对照扫描，挂到主进程启动迁移与新工作区注册钩子，存量配置自动转为路径级。

## 依赖上下文（接力棒输入）
- 前置 step 产出：step1 后 `SnapshotSettings.excludedPaths` 为唯一排除真源，`DEFAULT_SNAPSHOT_DIR_NAMES` 已导出
- 当前关键文件状态：主进程启动序列在 `electron/main/index.ts`（实施时确认 settings 初始化后的挂载点）；工作区注册入口在 workspace 相关 service（实施时定位 create/register 函数）
- 关键决策回顾：迁移幂等（`exclusionScanDone` 标记）；嵌套同名找全但已被外层路径覆盖的不重复列；扫描不受文件树 HIDDEN_NAMES 限制（.dogear/.git 本身就是要扫的名单项）

## 计划改动
- [ ] 新建 `electron/main/services/snapshot-exclusion-scan.ts`：
  - `scanWorkspaceExcludedPaths(workspacePath: string): Promise<string[]>`——递归扫描，目录名命中 `DEFAULT_SNAPSHOT_DIR_NAMES` 即记相对路径并剪枝（不再深入其子树，天然去重被覆盖嵌套）；返回排序后的路径列表
  - `migrateSnapshotExclusionsIfNeeded(): Promise<void>`——读 settings，`snapshot.exclusionScanDone` 为真直接返回；否则对全部注册工作区跑扫描写入 `excludedPaths`，置标记，落盘
  - `rescanAllWorkspaceExclusions(): Promise<void>`——清空 `excludedPaths` 重新生成（保留标记），供恢复默认复合 IPC 用（step3 接）
- [ ] `electron/main/index.ts` 启动序列：settings 就绪后 fire-and-forget 调 `migrateSnapshotExclusionsIfNeeded()`（失败仅 log，不阻塞启动）
- [ ] 工作区注册钩子：注册成功后对新工作区跑 `scanWorkspaceExcludedPaths` 写入其 `excludedPaths` 条目（不影响迁移标记）

## 实施回填（做完后填）

### 实际改动
- 与计划差异：
- 改动文件清单：

### 给下一步的接力棒
- 关键签名 / 数据结构：
- 下个 step 该从哪里继续：
- 待办或已知限制：
