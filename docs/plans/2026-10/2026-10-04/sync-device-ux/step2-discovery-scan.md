---
step: 2
title: 发现层——scanNow 主动扫描 + 快照含离线已配对
status: done
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
  - `fetchPeerInfo` 加可选 `timeoutMs` 参数（默认仍 30s），scanNow 探测传 3s——比计划的「AbortSignal.timeout 覆盖」更贴合 client.ts 现有 timeout 参数风格，无行为破坏
  - `scanNow` 并发调用共享同一轮结果（in-flight promise 去重，防 UI 双击扫描风暴）
  - 探测成功的在线态存模块级 `probeOnline` Map（内存态）；快照组装时过滤已不在 pairedDevices 的残留条目（unpair 后即消失，不依赖 unpair 调 discovery）
  - 测试沿用 impl + zz-子进程隔离模式（discovery-scan.impl.ts / zz-discovery-scan.test.ts）；踩坑：PairedDevice.secret 被 normalizeSyncOptions 校验 64 位 hex，非法字符条目会被静默丢弃
- 改动文件清单：
  - `electron/main/services/sync/discovery.ts`：PeerInfo 加 `online: boolean`；新增 `DeviceSnapshot`、`getDeviceSnapshot()`、`scanNow()`、私有 `recordProbeAddress`/`onProbeSuccess`/`runScanNow`；stopDiscovery 清 probeOnline
  - `electron/main/services/sync/client.ts`：`fetchPeerInfo` 加 `timeoutMs = DEFAULT_TIMEOUT_MS` 参数
  - `electron/main/services/sync/discovery-scan.impl.ts`（新增，7 用例）+ `zz-discovery-scan.test.ts`（新增，子进程 spawn）
  - `tsconfig.electron.json`：exclude 加 discovery-scan.impl.ts

### 给下一步的接力棒
- 关键签名：
  - `scanNow(): Promise<DeviceSnapshot>`（并发共享同一轮）；`getDeviceSnapshot(): Promise<DeviceSnapshot>`；`DeviceSnapshot = { peers: PeerInfo[] }`
  - `PeerInfo.online: boolean`（mDNS 命中或探测成功 = true；离线已配对 = false）
  - 离线条目字段语义：host/port ← `peerState.lastHost/lastPort`（无则 ''/0），name ← `paired.deviceName`（无则 deviceId 短码），lastSeen ← `peerState.lastSyncAt`（无则 0）
- 下个 step 该从哪里继续：
  - tipc `sync.ts` 加 `scanPeers` 路由（调 `scanNow()` 返回快照）；`peersChanged` 广播 payload 目前仍是纯 mDNS peers 数组，若要推快照需改 `notifyChanged`/`registerSyncBroadcaster`（scanNow 内已有 changed 信号只在快照内容变化时触发）
  - store/UI 按 plan.md：已配对常驻卡片、离线态（灰 Badge + lastHost 显示，host 空时用 deviceId 短码兑底）、「寻找设备」按钮接 `scanPeers`
- 待办或已知限制：
  - mDNS 命中的设备 scanNow 也会探测其 lastHost（若仍可达则回写同值，无操作；不可达则不影响 mDNS 在线态）——计划字面行为，非 bug
  - 在线判定是「mDNS 命中 或 最近一次扫描探测成功」，mDNS 90s 剧除后若上次探测仍成功则保持在线直到下次扫描，属设计预期（内存态）
  - lan-sync 未启动（browser null）时 scanNow 仍可探测已配对设备地址（跳过 mDNS 窗口），行为已测试覆盖
