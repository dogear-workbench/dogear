---
step: 6
title: settings 字段级三方合并
status: done
---

## 目标
修 D2：settings.json 合并从「以对端为底」改为字段级三方合并；顺带修 F5（sync-state 读改写加锁）。

## 依赖上下文（接力棒输入）
- （执行时回填 step5 接力棒）
- 现状关键文件：`sync/apply.ts:136-172`（computeMergedSettings `{...incoming}` 为底；mergeIncomingSettings 供 push 侧、applyMergedIncoming 供 pull 侧两入口）、`sync/sync-state.ts`（无 settings 基线内容、无锁）、写入点：`orchestrator.ts:387-397`、`server.ts:213-219`、`tipc/sync.ts` 映射操作

## 计划改动
- [x] `sync-state.ts`：新增 `settingsBaseline` 字段（上次同步收敛后的 settings.json 内容 JSON）与 `withSyncStateLock(fn)` 互斥（模块级 promise 队列）；三处写入点全部接锁（F5）
- [x] `apply.ts` computeMergedSettings 改字段级三方：逐顶层字段与 settingsBaseline 比——单侧变取变侧、双侧都变取本端并记 warning、两侧同基线保留；syncOptions 节维持现有 rev-LWW 特判；两入口共用此实现
- [x] 基线维护：同步成功且 settings.json 传输/合并后，把落盘结果写回 settingsBaseline；无基线（首次）退化为现有行为并在本轮建立基线
- [x] 单测：两侧离线各改不同顶层字段 → 同步后两字段并存；双侧改同一字段 → 本端保留 + warning

## 实施回填（做完后填）

### 实际改动
- 与计划差异：
  1. 落盘结果/基线/合并 local 统一用磁盘原文形态（新增 readSettingsRaw，不用 loadSettings 的默认值填充形态）——否则磁盘缺省字段会被误判「本端改过」造成基线抖动
  2. 计划外必要修复：settings merge pattern 原实现忽略传入 local、内部 loadSettings（潜在错源），改为注入 root 磁盘原文
  3. computeMergedSettings 第二参数改 options 对象（localSettings/localSyncOptions/baseline/onWarning，单测对 env 零依赖）；MergeFn 加第三参 {settingsBaseline?, onWarning?}
  4. 双侧改成同值不产生 warning（deepEqual(l,i) 判定，收敛非冲突）；warning 超 5 字段折叠
  5. 锁面 = 同进程 per-dataDir（三写入点同在主进程，协作式队列足够，跨进程不在范围）
- 改动文件清单：改 apply.ts（deepEqual/mergeFieldsThreeWay/readSettingsRaw/computeMergedSettings options 化/applyIncoming 第 5 参/mergeIncomingSettings 锁内全流程）、sync-state.ts（SyncStatePeer +settingsBaseline、withSyncStateLock per-dataDir 队列）、orchestrator.ts（基线传递+收尾锁内写回+warnings 进 report）、server.ts（push settings 分支传 ctx）、tipc/sync.ts（五个映射操作接锁，锁内只做 state 修改）、sync-options-merge.test.ts（适配）；新增 settings-merge.test.ts（15 例：三方核心/穿参/锁并发 100/HTTP 端到端）
- 验证：bun test 456 例 0 fail；build:electron + 前端 tsc 通过

### 给下一步的接力棒
- 关键签名 / 数据结构：
  - `SyncStatePeer.settingsBaseline?: Record<string, unknown>`（per-peer）；写回点两处：orchestrator 收尾锁内（transferred.has('settings.json')）+ mergeIncomingSettings 锁内（=merged）
  - `withSyncStateLock<T>(dataDir, fn)`：step7 墓碑写 sync-state 必须复用它，别另造锁；锁外用的中间值经返回值带出（参考 server.ts handleManifest）
  - `mergeFieldsThreeWay(local, incoming, baseline, onWarning?)`：顶层字段级；warning 文案 `settings 字段 a、b 两端都修改过，已保留本端版本（对端版本被丢弃）`
  - `readSettingsRaw(dataDir)`：磁盘原文，损坏/缺失 → null；基线/合并/比较统一此形态，别混 loadSettings
  - orchestrator transferred Map（relPath → hash|undefined）是「本轮传输过」唯一判定源，收尾锁内消费；step7 删除检测可挂同一收尾段
- 下个 step 该从哪里继续：step7 墓碑（协议 v3、删除指令、删改冲突、UI）；settings 是 merge 文件永不走墓碑；orchestrator pushOutgoing 若需解析对端 merge 警告需扩协议响应体（遗留 1）
- 待办或已知限制：
  - push 接收端双改 warning 只 console.warn（协议无反向通道），要可见需扩协议响应体，后续处理
  - 发送端基线不知对端 merge 结果（三方合并逐端收敛固有语义，下轮 diff 自然传播，非缺陷）
  - 真机双端验证留用户（离线各改不同字段 → 并存；改同字段 → 本端保留 + warnings 可见）
