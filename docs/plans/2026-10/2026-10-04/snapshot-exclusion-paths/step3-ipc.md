---
step: 3
title: 排除操作 IPC
status: pending
---

## 目标
为文件树右键与设置页恢复默认提供主进程读改写路由，避免前端全量回写 settings。

## 依赖上下文（接力棒输入）
- 前置 step 产出：step2 的 `rescanAllWorkspaceExclusions` 可复用；`excludedPaths` 结构为 `Record<workspaceId, string[]>`
- 当前关键文件状态：`electron/main/tipc/git.ts` 已有 `getSnapshotProtection` / `restoreSnapshot` 等快照域路由（降级风格 `{ error }` 返回）
- 关键决策回顾：主进程内读改写保证短窗口原子；恢复默认是复合动作走专用 IPC（前端 local 防抖保存与主进程重扫两步写会互相覆盖，必须单点完成）

## 计划改动
- [ ] `tipc/git.ts` 新增五条路由（输入 zod 校验、错误 `{ error }` 不抛异常）：
  - `getSnapshotExclusions({ workspaceId })` → `{ paths: string[] }`
  - `addSnapshotExcludedPath({ workspaceId, relPath })`——规范化路径（反斜杠/首尾斜杠），已存在则幂等返回；只接受相对路径且不含 `..` 段
  - `removeSnapshotExcludedPath({ workspaceId, relPath })`——删精确匹配条目
  - `restoreSnapshotDefaults()`——阈值/窗口回 `SNAPSHOT_SETTING_DEFAULTS` 推荐值、`disabledWorkspaces` 清空、调 `rescanAllWorkspaceExclusions()` 重新对照，主进程内一次完成落盘
  - `rebuildSnapshotExclusions()`——仅重跑对照（语义留给后续需要时，本期设置页恢复默认走上一条即可，此条若实施中发现无消费方则砍掉，YAGNI）
- [ ] 服务层落点：增删查可直接写在 tipc 内联或抽 `snapshot-exclusion-scan.ts` 旁的 mutation 小节（与现有代码风格对齐，实施时看 git.ts 既有模式）

## 实施回填（做完后填）

### 实际改动
- 与计划差异：
- 改动文件清单：

### 给下一步的接力棒
- 关键签名 / 数据结构：
- 下个 step 该从哪里继续：
- 待办或已知限制：
