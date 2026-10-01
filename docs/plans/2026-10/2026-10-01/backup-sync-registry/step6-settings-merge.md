---
step: 6
title: settings 字段级三方合并
status: pending
---

## 目标
修 D2：settings.json 合并从「以对端为底」改为字段级三方合并；顺带修 F5（sync-state 读改写加锁）。

## 依赖上下文（接力棒输入）
- （执行时回填 step5 接力棒）
- 现状关键文件：`sync/apply.ts:136-172`（computeMergedSettings `{...incoming}` 为底；mergeIncomingSettings 供 push 侧、applyMergedIncoming 供 pull 侧两入口）、`sync/sync-state.ts`（无 settings 基线内容、无锁）、写入点：`orchestrator.ts:387-397`、`server.ts:213-219`、`tipc/sync.ts` 映射操作

## 计划改动
- [ ] `sync-state.ts`：新增 `settingsBaseline` 字段（上次同步收敛后的 settings.json 内容 JSON）与 `withSyncStateLock(fn)` 互斥（模块级 promise 队列）；三处写入点全部接锁（F5）
- [ ] `apply.ts` computeMergedSettings 改字段级三方：逐顶层字段与 settingsBaseline 比——单侧变取变侧、双侧都变取本端并记 warning、两侧同基线保留；syncOptions 节维持现有 rev-LWW 特判；两入口共用此实现
- [ ] 基线维护：同步成功且 settings.json 传输/合并后，把落盘结果写回 settingsBaseline；无基线（首次）退化为现有行为并在本轮建立基线
- [ ] 单测：两侧离线各改不同顶层字段 → 同步后两字段并存；双侧改同一字段 → 本端保留 + warning

## 实施回填（做完后填）

### 实际改动
- 与计划差异：
- 改动文件清单：

### 给下一步的接力棒
- 关键签名 / 数据结构：
- 下个 step 该从哪里继续：
- 待办或已知限制：
