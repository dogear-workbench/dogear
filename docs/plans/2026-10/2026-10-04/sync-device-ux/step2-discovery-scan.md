---
step: 2
title: 发现层——scanNow 主动扫描 + 快照含离线已配对
status: pending
---

## 目标
提供手动触发的主动发现入口；peers 快照从「纯 mDNS 在线列表」扩展为「含离线已配对设备」的合并视图。

## 依赖上下文（接力棒输入）
- 前置 step 产出：[step1-main-data.md] SyncStatePeer 已有 lastHost/lastPort；unpairDevice 可用
- `discovery.ts` 现有：`peers: Map<deviceId, PeerInfo>`、`getPeers()`、`onPeersChanged`、requery 定时器（30s `browser.update()` + 90s 剔除）
- `client.ts` 已有 `fetchPeerInfo(peer): Promise<HandshakeHello>`（3s 超时可自定参传 timeout）——探测复用它，勿新写 HTTP
- 关键决策：已配对设备的常驻数据不进 discovery 的 peers Map（那是 mDNS 在线态）；合并视图在快照输出层做

## 计划改动
- [ ] `discovery.ts` PeerInfo 加 `online: boolean`（mDNS 在线条目恒 true；离线已配对 false）
- [ ] `discovery.ts` 新增 `getDeviceSnapshot(): Promise<DeviceSnapshot>`——mDNS peers（online:true）∪ pairedDevices 中不在 mDNS 的条目（online:false，host/port 取 peerState.lastHost/lastPort，name 取 paired.deviceName）；需 import loadSettings/readSyncStateFrom（模块内组装，不依赖调用方传参）
- [ ] `discovery.ts` 新增 `scanNow(): Promise<DeviceSnapshot>`——触发 `browser.update()` 等 mDNS 窗口 ~2s（可 Promise.all 计时）+ 并行 `fetchPeerInfo` 探测 pairedDevices 各条目（3s 超时）：探测成功 → 若 mDNS 未见过则并入快照（online:true，并回写 peerState.lastHost/lastPort）+ notifyChanged；失败仅计离线不报错；返回 getDeviceSnapshot()
- [ ] 探测成功回写地址走 `withSyncStateLock`（对齐 orchestrator 收尾写法）
- [ ] 单测：snapshot 合并去重（deviceId 键）、探测成功更新地址、mDNS 命中优先

## 实施回填（做完后填）

### 实际改动
- 与计划差异：
- 改动文件清单：

### 给下一步的接力棒
- 关键签名：
- 下个 step 该从哪里继续：
- 待办或已知限制：
