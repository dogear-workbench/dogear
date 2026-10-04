---
step: 4
title: 虚拟路径落盘与守卫 + tasks 条目合并
status: pending
---

## 目标
apply / push-guard / orchestrator 三侧打通虚拟路径的落盘与流转，tasks.json 进条目级合并——端到端完成「工作区数据跨设备」。

## 依赖上下文（接力棒输入）
- 设计依据：[../sync-data-semantics-design.md](../sync-data-semantics-design.md) §2.3（四处对称放行、合并策略、错误边界 §5）
- 前置 step 产出：[step3-manifest-virtual-paths.md] 清单/映射/版本 gating 已就位；虚拟条目经映射后 relPath 已是本端 wsid 视角
- 现状：`apply.ts` `resolveWithinDataDir` 限定 configDir 内（虚拟路径需新的反解落盘通道，保持路径安全校验）；`push-guard.ts` 明确拒绝 `__ws-external__` 前缀（`push-guard.test.ts:34`）；MERGE_PATTERNS 已有 plans.json 的 `mergeArrayFile('tasks', 'id')` 同构先例

## 计划改动
- [ ] `electron/main/services/sync/apply.ts`：新增虚拟路径反解（`__ws-external__/{wsid}/rest` → workspaces.json 注册表查 wsid → `{workspace.path}/rest`；反解后 resolve 校验必须仍在该工作区根下，防穿越；未注册 wsid → skipped + 警告）；`applyIncoming` / `writeIncomingFile` / `pushOutgoing` 对虚拟条目走真实路径读写；冲突副本（conflict copy）对虚拟条目落在工作区同目录
- [ ] `apply.ts` MERGE_PATTERNS：加 `__ws-external__/{wsid}/.dogear/tasks.json` → `mergeArrayFile(local, remote, 'tasks', 'id')`（同 id updatedAt 新者胜，同构 plans.json 条目）
- [ ] `electron/main/services/sync/push-guard.ts`：放行 registry 声明的虚拟路径（tasks/articles）与 userSyncPaths 内的子树；其余 `__ws-external__` 路径仍拒绝
- [ ] `electron/main/services/sync/orchestrator.ts`：虚拟条目拉取流（remoteRelPath 用对端视角 wsid 折算，复用 remoteRelPath 机制）与推送流（读本端真实路径）；diff/基线对虚拟条目同样走 mtime+hash 语义
- [ ] 测试：apply 反解落盘与安全校验、未注册 wsid 跳过警告、guard 白名单放行/未知虚拟路径拒绝、tasks 条目合并（两端各增任务收敛）

## 实施回填（做完后填）

### 实际改动
- 与计划差异：
- 改动文件清单：

### 给下一步的接力棒
- 关键签名 / 数据结构：
- 下个 step 该从哪里继续：
- 待办或已知限制：
