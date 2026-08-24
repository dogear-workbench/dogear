---
step: 1
title: trigger 层补漏编排
status: in_progress
---

## 目标
新增 `triggerCategorizeSweep(workspaceId)`：幂等差集扫描 + 逐组入队现有 incremental job。

## 依赖上下文（接力棒输入）
- 设计：见 [../categorize-sweep-design.md](../categorize-sweep-design.md)，核心是「差集 = 有 tags 的活跃组卡 − 分类挂载并集」
- 当前关键文件状态：
  - `category-trigger.ts:210` 已有 `triggerCategorize(workspaceId, groupId, groupDigestPath)`（内部 `whenMigrationReady` + enqueue incremental job）
  - `category-trigger.ts` 顶部已 import `mainLogger`；getGroup/group 目录等均用分支内 `await import`（对齐惯例）
  - enabled 检查参考实现：`group-digest-trigger.ts:256-270` chainCategorize（loadSettings → `smartCategory?.enabled === false` 即 return）
  - 组卡读取参考：`group-digest-store.ts` 的 `parseGroupDigest(raw)` / `getGroupsRootDir(wsId)` / `getGroupDigestPath(wsId, groupId)`；full-rebuild 已有同类目录扫描可对照 `agent-worker.ts`（handleCategorizeSessionTask 的 full-rebuild 分支，readdir + 跳过 `_` 前缀）
  - 索引读取：`smart-category-store.ts` 的 `readIndex(workspaceId)` → `idx.categories[].groupIds`
  - 组活跃判定：`group-service.ts` 的 `getGroup(wsId, groupId)` → `archivedAt === undefined`

## 计划改动
- [ ] `smart-category-engine.ts` 文件末尾加纯函数 `collectSweepTargets(entries, mountedGroupIds)`：
  - 入参 `entries: Array<{ groupId: string; hasTags: boolean; archived: boolean; digestPath: string }>`，`mountedGroupIds: Set<string>`
  - 返回 `{ sweep: Array<{ groupId: string; digestPath: string }>; noTags: number; archived: number }`（归档/已挂载剔除，未挂载且无 tags 计 noTags）
- [ ] `category-trigger.ts` 加 `export async function triggerCategorizeSweep(workspaceId: string): Promise<{ disabled: boolean; pending: number; noTags: number }>`：
  1. `await whenMigrationReady()`
  2. loadSettings，`smartCategory?.enabled === false` → return `{ disabled: true, pending: 0, noTags: 0 }`
  3. readdir `getGroupsRootDir`（跳过 `_` 前缀目录），逐组 `getGroup` 查活跃 + 读 `getGroupDigestPath` 的 digest.md（读失败 mainLogger.warn 跳过，不计 noTags）+ `parseGroupDigest` 取 tags 有无
  4. `readIndex` 算挂载并集 → `collectSweepTargets` → 对每个目标 `void triggerCategorize(wsId, g.groupId, g.digestPath)`
  5. return `{ disabled: false, pending: sweep.length, noTags }`
- [ ] `bun run build:electron` 通过

## 实施回填（做完后填）

### 实际改动
- 与计划差异：
- 改动文件清单：

### 给下一步的接力棒
- 关键签名：`triggerCategorizeSweep(...)` 的返回结构（若与计划有出入以实际为准）
- 下个 step 该从哪里继续：`task-executor.ts:83-89` categorize 分支
- 待办或已知限制：
