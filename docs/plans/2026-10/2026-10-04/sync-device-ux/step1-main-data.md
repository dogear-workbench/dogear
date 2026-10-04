---
step: 1
title: 主进程数据层——地址记忆 + 解除配对 + 删通知
status: done
---

## 目标
持久化对端地址记忆、提供解除配对能力、下线上线通知，403 文案提示对端可能已解除。

## 依赖上下文（接力棒输入）
- 设计决策：`SyncStatePeer` 加 `lastHost?: string` / `lastPort?: number`；只在成功路径更新
- `pairing.ts` 现有 `ensureSelfHello()`、配对确认写入 `settings.syncOptions.pairedDevices`（pairing.ts:54 附近 filter+push 模式）
- `orchestrator.ts` runSync 的 peer 参数（RunSyncPeer extends PeerEndpoint 含 host/port）在收尾写 `peerState` 时可拿到地址
- `peer-notify.ts` 唯一调用点 `lan-sync-service.ts:92`

## 计划改动
- [ ] `electron/main/services/sync/sync-state.ts` SyncStatePeer 接口加 `lastHost?: string` / `lastPort?: number`
- [ ] `electron/main/services/sync/pairing.ts` 配对确认成功路径写 `peerState.lastHost/lastPort`；新增 `unpairDevice(deviceId: string): Promise<void>`——读 settings 删 `pairedDevices` 条目写回（不存在时幂等成功）；`runningSync` 非空时抛错「同步进行中，稍后再解除」（从 orchestrator import getRunningSync）
- [ ] `electron/main/services/sync/orchestrator.ts` runSync 成功收尾（写 lastManifest 的同一段 withSyncStateLock 内）补 `lastHost: peer.host, lastPort: peer.port`
- [ ] `electron/main/services/sync/orchestrator.ts:187` 403/未配对错误文案追加「对端可能已解除配对；若确已解除，请在本端解除配对后重新配对」
- [ ] 删除 `electron/main/services/sync/peer-notify.ts`；`lan-sync-service.ts` 移除 import 与 :92 调用
- [ ] 单测：unpair 幂等/进行中拒绝/正常删除；收尾写地址

## 实施回填（做完后填）

### 实际改动
- 与计划差异：
  - 403/未配对文案除了 orchestrator 未配对检查那一处，还在 fetchManifest 调用点加了对 HTTP 401/403 的 catch 追加同一句引导（设计文档未决问题的「对端已解除后本端仍显示已配对，同步时被拒」场景实际走的是 fetch 抛错路径，仅改 187 行覆盖不到；实现中对端拒绝返回的是 401）。
  - incoming 配对（对端主动发起、本端确认）不写地址：HandshakeHello 不携带对端地址，server 回调签名也没有地址，拿到它需要改 server.ts（计划外）；该场景由设计文档的「已配对但无地址记录」分支兑底（离线显示 deviceId，后续同步/扫描成功后补记）。
  - initSelfHello 里对 sync-state 的动态 import 改为顶部静态 import（无循环依赖，顺手清理）。
  - 测试放置方式：pairing/unpair 集成用例对进程级状态敏感（loadSettings/orchestrator.runningSync/env），bun test 合跑时被 delegation-test-mocks 进程级泄漏的 loadSettings mock 与多 worker env 串扰污染，故实际断言放 pairing-unpair.impl.ts（命名不带 .test 避免全量扫描收集，已加入 tsconfig.electron.json exclude），由 zz-pairing-unpair.test.ts 在干净子进程中 spawn 运行。
- 改动文件清单：
  - electron/main/services/sync/sync-state.ts（SyncStatePeer + lastHost/lastPort）
  - electron/main/services/sync/pairing.ts（recordPeerAddress + unpairDevice + outgoing 配对写地址 + 静态 import sync-state）
  - electron/main/services/sync/orchestrator.ts（收尾写地址 + 未配对文案 + fetchManifest 401/403 文案）
  - electron/main/services/sync/lan-sync-service.ts（移除 peer-notify import 与调用）
  - electron/main/services/sync/peer-notify.ts（删除）
  - electron/main/services/sync/pairing-unpair.impl.ts（新增，子进程集成断言）
  - electron/main/services/sync/zz-pairing-unpair.test.ts（新增，子进程壳）
  - tsconfig.electron.json（exclude 加 impl 文件）

### 给下一步的接力棒
- 关键签名：
  - `unpairDevice(deviceId: string): Promise<void>`（pairing.ts；runningSync 非空抛 Error「同步进行中，稍后再解除」，不存在幂等成功，仅删 settings.syncOptions.pairedDevices 条目）
  - `SyncStatePeer.lastHost?: string / lastPort?: number`（sync-state.ts）
  - 地址写入点：pairing.ts recordPeerAddress（outgoing 配对确认，withSyncStateLock 内）、orchestrator.ts 收尾（写 lastManifest 同一锁段，peer.host/port）
  - 401/403 追加文案：「对端可能已解除配对；若确已解除，请在本端解除配对后重新配对」
- 下个 step 该从哪里继续：Step 2 discovery.scanNow——探测已配对设备 lastHost/lastPort 用 fetchPeerInfo（client.ts 已有），成功后按 recordPeerAddress 同样的 withSyncStateLock 模式回写；peers 快照扩展 online 字段供 store 合并。
- 待办或已知限制：
  - incoming 配对不写地址（见上），Step 2 扫描探测成功后会自然补上。
  - tipc 层 unpair/scanPeers 路由未接（本 step 范围外）；注意 tipc setSyncOptions 已有 removeDeviceId 通道（settings-service.applySyncOptionsPatch），后续接 unpair 路由时需统一到带 runningSync 检查的 unpairDevice，避免绕过进行中保护。
  - orchestrator.runningSync 是模块级单例，集成测试对它敏感；新增同类测试建议沿用子进程隔离模式。
