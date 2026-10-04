---
step: 3
title: 排除操作 IPC
status: done
---

## 目标
为文件树右键与设置页恢复默认提供主进程读改写路由，避免前端全量回写 settings。

## 依赖上下文（接力棒输入）
- 前置 step 产出：step2 的 `rescanAllWorkspaceExclusions` 可复用；`excludedPaths` 结构为 `Record<workspaceId, string[]>`
- 当前关键文件状态：`electron/main/tipc/git.ts` 已有 `getSnapshotProtection` / `restoreSnapshot` 等快照域路由（降级风格 `{ error }` 返回）
- 关键决策回顾：主进程内读改写保证短窗口原子；恢复默认是复合动作走专用 IPC（前端 local 防抖保存与主进程重扫两步写会互相覆盖，必须单点完成）

## 计划改动
- [x] `tipc/git.ts` 新增五条路由（错误 `{ error }` 不抛异常；实际四条，rebuild 按 YAGNI 砍掉）：
  - `getSnapshotExclusions({ workspaceId })` → `{ paths: string[] }`
  - `addSnapshotExcludedPath({ workspaceId, relPath })`——规范化路径（反斜杠/首尾斜杠），已存在则幂等返回；只接受相对路径且不含 `..` 段
  - `removeSnapshotExcludedPath({ workspaceId, relPath })`——删精确匹配条目
  - `restoreSnapshotDefaults()`——阈值/窗口回 `SNAPSHOT_SETTING_DEFAULTS` 推荐值、`disabledWorkspaces` 清空、调 `rescanAllWorkspaceExclusions()` 重新对照，主进程内一次完成落盘
  - `rebuildSnapshotExclusions()`——仅重跑对照（语义留给后续需要时，本期设置页恢复默认走上一条即可，此条若实施中发现无消费方则砍掉，YAGNI）
- [x] 服务层落点：增删查可直接写在 tipc 内联或抽 `snapshot-exclusion-scan.ts` 旁的 mutation 小节（实际落 scan 模块，复用串行队列）

## 实施回填（做完后填）

### 实际改动
- 与计划差异：
  - 五条路由实际落四条：`rebuildSnapshotExclusions()` 全库无消费方（step4 只用增删查，step5 只用 remove + restoreDefaults，设置页「重新对照」已并入恢复默认复合 IPC），触发 YAGNI 条款砍掉
  - 输入校验未用 zod：项目 tipc 层统一 `.input<{...}>()` 泛型模式（全库无 zod 先例），运行时校验在服务层 `normalizeRelPathInput` 完成（normalizeSnapshotSettings 同款清洗 + 拒绝绝对路径与 `..` 段 + 折叠连续斜杠），错误走 `{ error }` 返回，对齐 git.ts 既有降级风格
  - `restoreSnapshotDefaults` 未在 tipc 层「先写重置再调 `rescanAllWorkspaceExclusions()`」（那样两次落盘、中间窗口快照按旧清单跑），而是在 scan 模块内新增同名服务层函数：单次 `enqueueSettingsWrite` 任务内完成重置+重扫+一次落盘，真正原子；`rescanAllWorkspaceExclusions()` 本体保持不变
  - 服务层落点选「scan 模块内 mutation 小节」而非 tipc 内联：增删改必须复用模块私有 `enqueueSettingsWrite` 串行队列（否则与迁移/钩子写互相覆盖）；`enqueueSettingsWrite` 泛型化（`<T>`）以透传 mutation 返回值，既有 void 调用兼容
  - `removeExcludedPath` 清单删空时移除该工作区键（step5 设计按 excludedPaths 遍历分组，空数组键会渲染空组头）
  - 带workspaceId 的三条路由先 `workspaceJsonService.getById` 校验工作区存在（对齐 git.ts 既有路由风格）
- 改动文件清单：snapshot-exclusion-scan.ts（新增 normalizeRelPathInput + get/add/remove/restore 四导出 + enqueueSettingsWrite 泛型化 + 头注释更新）/ tipc/git.ts（新增四条路由 + 两个 import）
- 验证：`bun run build:electron` 通过；bun test 全量 540 pass / 0 fail（与 step2 基线持平）

### 给下一步的接力棒
- 关键签名 / 数据结构：
  - tipc/git.ts 四条路由（前端经 client 调用，类型自动推导）：
    - `getSnapshotExclusions({ workspaceId })` → `{ paths: string[] } | { error: string }`
    - `addSnapshotExcludedPath({ workspaceId, relPath })` → `{ paths: string[] } | { error: string }`（paths 为更新后清单，已存在幂等；relPath 任意形式，主进程清洗）
    - `removeSnapshotExcludedPath({ workspaceId, relPath })` → `{ paths: string[] } | { error: string }`（删空返回 `[]` 且该工作区键已移除）
    - `restoreSnapshotDefaults()` → `{ snapshot: SnapshotSettings } | { error: string }`（无 input；返回重置+重扫后的完整 snapshot 节，前端可直接用它刷新，无需再拉 settings）
  - 服务层（snapshot-exclusion-scan.ts）：`getWorkspaceExcludedPaths(workspaceId): Promise<string[]>` / `addExcludedPath(workspaceId, relPath): Promise<string[] | null>` / `removeExcludedPath(workspaceId, relPath): Promise<string[] | null>` / `restoreSnapshotDefaults(): Promise<SnapshotSettings>`；null = 输入非法（非字符串/绝对路径/含 `..` 段/清洗后为空）
  - 清洗规则（normalizeRelPathInput）：拒绝绝对（前导 / 或 \ 或盘符）、反斜杠转斜杠、剥重复前导 `./`、折叠连续斜杠、去首尾斜杠、拒 `..` 段与空串
- 下个 step 该从哪里继续：step4 文件树——mount/切工作区时调 getSnapshotExclusions 存 Set；右键调 add/remove IPC 用返回的 paths 直接更新本地 Set（不用重拉）；toast 文案可复用路由返回的 error 文案
- 待办或已知限制：
  - 排除/恢复仅改 settings.json 落盘，不主动广播 settings 变更事件（沿用既有 settings 写路径行为）；step4 文件树需处理「设置页改了清单」的刷新（step4 文档已预留该待办）
  - step2 遗留不变：备份恢复直接覆盖 workspaces.json 引入的新工作区不经 add() 钩子不补扫描
  - 设置页恢复默认按钮（step5）建议直接使用返回的 snapshot 更新 local，避免冗余全量重拉（非必须）
