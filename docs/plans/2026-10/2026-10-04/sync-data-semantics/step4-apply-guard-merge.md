---
step: 4
title: 虚拟路径落盘与守卫 + tasks 条目合并
status: done
---

## 目标
apply / push-guard / orchestrator 三侧打通虚拟路径的落盘与流转，tasks.json 进条目级合并——端到端完成「工作区数据跨设备」。

## 依赖上下文（接力棒输入）
- 设计依据：[../sync-data-semantics-design.md](../sync-data-semantics-design.md) §2.3（四处对称放行、合并策略、错误边界 §5）
- 前置 step 产出：[step3-manifest-virtual-paths.md] 清单/映射/版本 gating 已就位；虚拟条目经映射后 relPath 已是本端 wsid 视角
- 现状：`apply.ts` `resolveWithinDataDir` 限定 configDir 内（虚拟路径需新的反解落盘通道，保持路径安全校验）；`push-guard.ts` 明确拒绝 `__ws-external__` 前缀（`push-guard.test.ts:34`）；MERGE_PATTERNS 已有 plans.json 的 `mergeArrayFile('tasks', 'id')` 同构先例

## 计划改动
- [x] `electron/main/services/sync/apply.ts`：新增虚拟路径反解（`__ws-external__/{wsid}/rest` → workspaces.json 注册表查 wsid → `{workspace.path}/rest`；反解后 resolve 校验必须仍在该工作区根下，防穿越；未注册 wsid → skipped + 警告）；`applyIncoming` / `writeIncomingFile` / `pushOutgoing` 对虚拟条目走真实路径读写；冲突副本（conflict copy）对虚拟条目落在工作区同目录
- [x] `apply.ts` MERGE_PATTERNS：加 `__ws-external__/{wsid}/.dogear/tasks.json` → `mergeArrayFile(local, remote, 'tasks', 'id')`（同 id updatedAt 新者胜，同构 plans.json 条目）
- [x] `electron/main/services/sync/push-guard.ts`：放行 registry 声明的虚拟路径（tasks/articles）与 userSyncPaths 内的子树；其余 `__ws-external__` 路径仍拒绝
- [x] `electron/main/services/sync/orchestrator.ts`：虚拟条目拉取流（remoteRelPath 用对端视角 wsid 折算，复用 remoteRelPath 机制）与推送流（读本端真实路径）；diff/基线对虚拟条目同样走 mtime+hash 语义
- [x] 测试：apply 反解落盘与安全校验、未注册 wsid 跳过警告、guard 白名单放行/未知虚拟路径拒绝、tasks 条目合并（两端各增任务收敛）

## 实施回填（做完后填）

### 实际改动
- 与计划差异：
  - 反解原语落在 `data-registry.ts`（`externalWorkspaceIndex` + `resolveExternalRelPath`，段安全 + resolve 后工作区根前缀校验）而非 apply.ts——apply/manifest/server 多处消费，data-registry 是无 sync 依赖的公共层且已有 `resolveArchiveRelPath` 同构先例；apply.ts 导出 `resolveIncomingRelPath(root, relPath)` 作统一入口（虚拟前缀 → 反解，否则原 `resolveWithinDataDir`）
  - `server.ts` 三个端点随本步接线（计划段未明列但属「四处对称」的服务端面）：GET /file 读盘、DELETE /file 删盘换 `resolveIncomingRelPath`；POST/DELETE guard 输入补 `registeredWorkspaceIds` + `userSyncPaths`；另修 `close()` 补 `closeAllConnections`（Bun 下 closeIdleConnections 不生效，客户端连接池持连接时 close 永不完成，测试与生产关闭均受益）
  - `tombstone.ts` `applyPeerTombstones` 同换 `resolveIncomingRelPath`：对端墓碑跟随删除对虚拟条目反解删工作区真实文件
  - guard 白名单额外放行 `.dogear/tasks.json.conflict-*` 副本形态（用户显式裁决推副本用），副本最终仍受 `syncConflictCopies` 开关约束（默认拒收，与普通路径副本同语义）
- 改动文件清单：`data-registry.ts`（反解原语）、`sync/apply.ts`（统一解析 + 删 skip 守卫 + MERGE_PATTERNS 虚拟 tasks.json 条目，mergeArrayFile 复用，version 取较大者）、`sync/push-guard.ts`（白名单 `isRegisteredVirtualPath`，PushGuardInput 新增 registeredWorkspaceIds/userSyncPaths）、`sync/manifest.ts`（hashEntries 虚拟反解，注册表预读一次）、`sync/server.ts`、`sync/tombstone.ts`、`sync/orchestrator.ts`（mergedFiles 基线重算换统一解析；拉/推流转复用 remoteRelPath 机制无改动）、`sync/push-guard.test.ts`（白名单用例）、`sync/virtual-apply.test.ts`（新增 15 用例）

### 给下一步的接力棒
- 关键签名 / 数据结构：
  - `resolveExternalRelPath(configDir, relPath, index?)` / `externalWorkspaceIndex(configDir)`（data-registry.ts）——`__ws-external__/{wsid}/rest` → 工作区真实绝对路径；未注册/段不安全/穿越 → null
  - `resolveIncomingRelPath(root, relPath)`（apply.ts）——同步条目落盘/读盘统一解析入口，新代码不要再直接用 resolveWithinDataDir
  - `isRegisteredVirtualPath(relPath, registeredIds, userSyncPaths)`（push-guard.ts 导出，可单测）
  - `PushGuardInput` 新增 `registeredWorkspaceIds?: ReadonlySet<string>`、`userSyncPaths?: Record<string, string[]>`；server.ts 调用点已传（读注册表 + getManifestOptions）
- 下个 step 该从哪里继续：Step 5 settings 白名单传播核对定稿（apply.ts mergeFieldsThreeWay 仍为全字段三方合并，SETTINGS_SYNC_FIELDS 已在 settings-types.ts 就绪未接线）；Step 6 UI 分组勾选（userSyncPaths 读写已有 normalize 支持）
- 待办或已知限制：
  - `tipc/sync.ts` `revealSyncFile` 仍用 resolveWithinDataDir：虚拟条目冲突副本的「在文件管理器定位」不可用（数据无损，仅 UX 降级），待收口 step 决定换 resolveIncomingRelPath 或隐藏虚拟条目 reveal 入口
  - 同步引擎直写工作区 tasks.json 不经 task-store 的 withFileLock（与 plans.json 既有竞态模式一致，未扩大处理）
  - orchestrator 双端端到端虚拟条目集成测试未建（各环节单测 + server 端到端已覆盖；两端真 HTTP 全链路留收口 step）
