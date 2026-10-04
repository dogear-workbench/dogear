---
step: 3
title: tipc 路由与 store 合并数据源
status: pending
---

## 目标
tipc 暴露 scanPeers/unpair；前端 store 的 peers 改为合并快照数据源并接通两个 action。

## 依赖上下文（接力棒输入）
- 前置 step 产出：[step2-discovery-scan.md] `scanNow(): Promise<DeviceSnapshot>` / `getDeviceSnapshot()`；PeerInfo 含 `online`；`unpairDevice(deviceId)`
- `electron/main/tipc/sync.ts` 现有路由风格：context 里挂 service 方法（读该文件头部现状对齐命名）
- `stores/sync-store.ts` 现有 peers 状态来自 tipc 轮询或事件（读现状确认刷新机制，改动最小化）
- 关键决策：peersChanged 事件payload也换成合并快照（离线已配对进列表），避免 store 双数据源拼装

## 计划改动
- [ ] `electron/main/tipc/sync.ts` 新增 `sync.scanPeers`（调 discovery.scanNow，返回快照）与 `sync.unpair`（deviceId 入参，调 unpairDevice，成功后触发快照广播刷新）
- [ ] `lan-sync-service.ts` 的 peersChanged 广播改为携带合并快照（discovery 层输出的含离线条目）；确认 tipc 事件订阅端类型同步
- [ ] `stores/sync-store.ts`：peers 类型对齐扩展（online 字段）；新增 `scan()`（loading 态 + 调 scanPeers）与 `unpair(deviceId)`（调 tipc 后刷新 peers/syncOptions/syncState）
- [ ] 类型检查 `tsc -p tsconfig.json` 与 `tsc -p tsconfig.electron.json` 双通过

## 实施回填（做完后填）

### 实际改动
- 与计划差异：
- 改动文件清单：

### 给下一步的接力棒
- 关键签名：
- 下个 step 该从哪里继续：
- 待办或已知限制：
