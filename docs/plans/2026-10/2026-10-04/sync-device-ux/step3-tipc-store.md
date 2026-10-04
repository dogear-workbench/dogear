---
step: 3
title: tipc 路由与 store 合并数据源
status: done
---

## 目标
tipc 暴露 scanPeers/unpair；前端 store 的 peers 改为合并快照数据源并接通两个 action。

## 依赖上下文（接力棒输入）
- 前置 step 产出：[step2-discovery-scan.md] `scanNow(): Promise<DeviceSnapshot>` / `getDeviceSnapshot()`；PeerInfo 含 `online`；`unpairDevice(deviceId)`
- `electron/main/tipc/sync.ts` 现有路由风格：context 里挂 service 方法（读该文件头部现状对齐命名）
- `stores/sync-store.ts` 现有 peers 状态来自 tipc 轮询或事件（读现状确认刷新机制，改动最小化）
- 关键决策：peersChanged 事件payload也换成合并快照（离线已配对进列表），避免 store 双数据源拼装

## 计划改动
- [x] `electron/main/tipc/sync.ts` 新增 `sync.scanPeers`（调 discovery.scanNow，返回快照）与 `sync.unpair`（deviceId 入参，调 unpairDevice，成功后触发快照广播刷新）
- [x] `lan-sync-service.ts` 的 peersChanged 广播改为携带合并快照（discovery 层输出的含离线条目）；确认 tipc 事件订阅端类型同步
- [x] `stores/sync-store.ts`：peers 类型对齐扩展（online 字段）；新增 `scan()`（loading 态 + 调 scanPeers）与 `unpair(deviceId)`（调 tipc 后刷新 peers/syncOptions/syncState）
- [x] 类型检查 `tsc -p tsconfig.json` 与 `tsc -p tsconfig.electron.json` 双通过

## 实施回填（做完后填）

### 实际改动
- 与计划差异：
  1. peersChanged 快照化落在 discovery.notifyChanged 内（计划写的 lan-sync-service.ts 只是事件透传层，真正拼接 payload 的源头在 discovery）——notifyChanged 改异步广播合并快照，in-flight 合帧（脏标记）防后发先至
  2. 拉取路径同步换源：tipc `getPeers` 路由改名 `getPeersSnapshot` 并改返回 `getDeviceSnapshot()`（唯一消费点是 store.refresh，tipc 类型安全保证编译期暴露）；否则 refresh 会用纯 mDNS 列表覆盖事件推来的快照，重回双数据源
  3. discovery 新增导出 `broadcastPeersSnapshot()`（unpair 落库后主动广播快照）；stopDiscovery 时 probeOnline 清空提前到 notifyChanged 之前
  4. renderer-handlers.ts `SyncEventPayload.peers` 类型不变（仍 PeerInfo[]，PeerInfo 已含 online），加了一行语义注释标明是合并快照
- 改动文件清单：
  - electron/main/services/sync/discovery.ts（notifyChanged 异步广播合并快照 + 合帧；导出 broadcastPeersSnapshot）
  - electron/main/tipc/sync.ts（getPeersSnapshot / scanPeers / unpair 三路由；registerSyncBroadcaster payload 解快照）
  - stores/sync-store.ts（scanning 状态 + scan() / unpair()；refresh 换 getPeersSnapshot）
  - electron/main/tipc/renderer-handlers.ts（peers 事件语义注释）
  - 测试：discovery-broadcast.impl.ts（3 用例）+ zz-discovery-broadcast.test.ts（子进程隔离壳）；tsconfig.electron.json exclude 加 impl 文件

### 给下一步的接力棒
- 关键签名：
  - tipc：`scanPeers({}) → DeviceSnapshot`（2~3s，配 store.scanning）；`unpair({ deviceId }) → { ok: true }`（同步中抛「同步进行中，稍后再解除」，tipc 传回后 store toast）；`getPeersSnapshot({}) → DeviceSnapshot`
  - store：`useSyncStore` 新增 `scanning: boolean` / `scan()` / `unpair(deviceId)`；`peers: PeerInfo[]` 现恒为合并快照（含离线已配对，online 字段判定绿/灰）
  - 离线兜底口径：name ← `paired.deviceName ?? shortDeviceId`（快照层已落地）；host 空时显示 deviceId 短码（`shortDeviceIdText`，sync-utils 已有）
- 下个 step（Step 4 UI）从哪里继续：
  - sync-panel.tsx：标题旁「寻找设备」按钮（`scanning` → loading/disabled，onClick `scan()`）；空态文案提示点按钮
  - sync-peer-card.tsx：`peer.online` 绿/灰 Badge（灰文案「离线」）；下拉菜单加「解除配对」红字项（confirm 弹窗 → `unpair(peer.deviceId)`；runningSync 非空时禁用——服务层也有保护）
- 待办或已知限制：
  - runSync 路由仍按 listPeers()（纯 mDNS）判定可达，「探测在线但 mDNS 未命中」的设备发起同步会报「对端不在线」——设计既定（离线可点、失败有报告），未扩 scope
  - peersChanged 事件在 lan-sync 服务未启动（discovery 未 init）时不会有广播；面板挂载靠 refresh() 拉快照兜底，行为与现状一致

### 验证
- `tsc -p tsconfig.json` / `tsc -p tsconfig.electron.json` 双通过；`bun run build:electron` 通过
- `bun run lint`：0 errors / 70 warnings（均既有，本次改动文件无新警告）
- 全量 `bun test`：546 pass / 1 skip / 0 fail（含新增快照广播 3 用例）
