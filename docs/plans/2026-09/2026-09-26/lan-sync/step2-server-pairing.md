---
step: 2
title: 发现与服务
status: done
---

## 目标
两台 Dogear 在同局域网互相发现并完成安全配对；HTTP 对等服务可交换握手与清单。

## 依赖上下文（接力棒输入）
- 前置 step 产出：step1 的 `protocol.ts` 消息 schema（zod）与 `sync-state.ts`
- 关键决策回顾：不自动同步——发现对端有变化只通知，同步必须用户触发

## 计划改动
- [x] 选型并安装 mDNS 库（**选型结论：bonjour-service@1.4.4**。@homebridge/ciao 实测出局——其 README 明确说明 browse（发现对端）功能「will eventually gain in the future」，只有 Responder 广播应答能力，不满足「互相发现」的核心需求；bonjour-service 在本机 Windows + Bun 下实测广播/发现/TXT 传播均正常。）
- [x] 新建 `electron/main/services/sync/discovery.ts`：广播 `_dogear._tcp`（端口=HTTP 服务端口，设备名取 `syncOptions.deviceName` 或 OS 主机名）；browse 对端 → 维护 `peers: PeerInfo[]`（name、ip、port、deviceId、lastSeen），变化时通过 `onPeersChanged` 订阅接口通知（tipc 广播 step 3 接）
- [x] 新建 `electron/main/services/sync/server.ts`：主进程 `http.createServer`——路由：`GET /info`（握手包）、`POST /pair-request`（发起方提交 hello + 6 位码）、`POST /manifest`（交换清单 + 候选 hash）、`GET /file?path=`（流式取文件，gzip）、`POST /file`（收文件，gzip + 原子写 + mtime 对齐）；其余请求校验设备密钥 header（`/pair-request`、`/info` 除外）
- [x] 配对流程：A 端生成 6 位码并显示 → 发 `POST /pair-request`（带码）→ B 端展示码 + 请求方设备名等用户比对确认（`confirmPairRequest`/`rejectPairRequest`，tipc step 3 接）→ B 生成 `randomBytes(32).hex` 密钥响应 → 双方各自持久化到 settings 的 `syncOptions.pairedDevices`
- [x] 设备 ID：首次启动生成 UUID 持久化（sync-state.json 的 `deviceId` 字段，`getOrCreateDeviceId()`）
- [x] 启动集成：`main-app.ts` app ready 后经 `lan-sync-service.startLanSync()` 启动（默认端口 47210 占用自动退避随机端口并以 mDNS 广播实际端口；mDNS 失败仅记 `status.discoveryError` 不影响主功能；before-quit 时 stop 发 goodbye）
- [x] 验证：Windows 单机两实例（独立 sandbox 数据目录 + node loader stub electron）完成发现→握手→配对→清单交换→双向文件收发；防火墙拦截文案属 UI 层，留 step 4
- [x] `bun run build:electron` 通过

## 实施回填（做完后填）

### 实际改动
- 与计划差异：
  1. 配对码由**发起方生成**并在本端展示，随 pair-request 发给对端展示；对端用户比对两端码一致后点确认。计划原文「一端生成，用户比对」的双向展示语义即此，实现上码生成权在发起方（对 UI 无差异）。
  2. 新增 `apply.ts`（原计划 step 3 模块）：server 收文件（POST /file）的落盘动作即「原子写 + mtime 对齐」，为避免与 step 3 的拉取落盘重复实现，抽成 `writeIncomingFile()` 共用；step 3 在此之上补冲突副本与拉取编排。
  3. gzip 语义：线上协议恒 gzip，用自定义头 `x-dogear-content-encoding` 而非标准 `content-encoding`（undici 等 fetch 对后者自动解压会破坏客户端侧手动 gunzip，实测踩坑）；解压统一在落盘边界 `writeIncomingFile`。
  4. `settings-types.ts` 增加 `SyncOptions`（deviceName/syncStocksData/syncFeishu/pairedDevices）与 `normalizeSyncOptions`（secret 校验 64 位 hex、deviceId 去重、大小写归一）——step1 交付文档指出的「deviceId 生成与配对列表属 settings 扩展」在本 step 落地。
  5. HTTP 客户端封装独立成 `client.ts`（计划未列）：对端 fetch + 超时 + zod 响应校验，供 pairing 与 step 3 同步引擎共用。
- 改动文件清单：
  - 新增：`electron/main/services/sync/{device,discovery,server,client,pairing,apply,lan-sync-service}.ts`
  - 修改：`electron/main/services/sync/{protocol,sync-state}.ts`（配对 schema、AuthHeaders、SyncState.deviceId）、`electron/main/services/{settings-types,settings-service}.ts`（syncOptions 节 + normalize + applyThemeSource 非 Electron 环境防御）、`electron/main/main-app.ts`（启动/退出集成）、`package.json`/`bun.lock`（bonjour-service 依赖）

### 验证结果（Windows 单机两实例，独立 sandbox 数据目录）
- mDNS：B 端 ~3s 内发现 A（name/host/port/appVersion/protocolVersion 经 TXT 传播正确）；自己广播被过滤，未自发现
- 握手：GET /info 返回 hello，HandshakeHelloSchema 校验通过
- 配对：B 发起 → A 端展示码（如 778595）→ 自动确认 → 双方 settings.syncOptions.pairedDevices 各记对方且 **secret 完全一致**（randomBytes(32).hex）
- 设备身份：A/B 各自生成 UUID 持久化 sync-state.json，互不相同
- 清单交换：B 发本地清单 → A 返回自身清单 + candidateHashes（只对双侧同路径且 size/mtime 异的候选算 hash，单侧文件不算——逻辑正确）
- 文件收发：pull（memory/note-from-a.md 25B 内容一致）+ push（workspaces/note-from-b.md 27B 内容一致）均落盘正确
- 降级：B 启动时 47210 被 A 占用 → 自动退避随机端口继续服务；mDNS 故障仅记 discoveryError

### 给下一步的接力棒
- 关键签名 / 数据结构：
  - `lan-sync-service.ts`（门面）：`startLanSync()`（内部捕获错误降级）、`stopLanSync()`、`getLanSyncStatus(): LanSyncStatus`（running/httpPort/deviceId/deviceName/appVersion/error/discoveryError）、`listPeers(): PeerInfo[]`、`onLanSyncStatusChanged(cb)`、re-export `onPeersChanged`
  - `discovery.ts`：`PeerInfo = { deviceId, name, host, port, appVersion?, protocolVersion?, lastSeen }`；peer 90s 无更新自动剔除，30s 重查
  - `pairing.ts`：`startPairing({host,port,deviceId,deviceName})`（发起方，返回 PairingOutcome）、`onPairRequest(cb)`（B 端 UI 监听展示码）、`confirmPairRequest(requesetId)` / `rejectPairRequest(id, reason)`、`getPendingPairRequests()`、`onPairingCompleted(cb)`、`getSelfHello()`、`initSelfHello(appVersion)`（门面已调）
  - `client.ts`：`fetchPeerInfo(peer)`、`sendPairRequest(peer, hello, code)`、`fetchManifest(peer, {deviceId,secret}, hello, entries)` 返回 `ManifestResponseBody`（对端 hello 在此，版本警告比对用）、`pullFile(peer, auth, relPath)` 返回**未解压 gzip 流**、`pushFile(peer, auth, meta, source)`（内部 gzip）
  - `apply.ts`：`writeIncomingFile(dataDir, meta: FilePushMeta, gzipStream)`（gunzip + 临时文件 + rename + utimes 对齐 mtimeMs，返回 `{ok, bytesWritten}` 或 `{ok:false, reason}`）、`resolveWithinDataDir(dataDir, relPath)`（防穿越，server 已用）
  - `device.ts`：`getOrCreateDeviceId()`、`resolveDeviceName(settingsDeviceName?)`、`buildHello(deviceId, deviceName, appVersion)`
- 下个 step 该从哪里继续：step 3（apply + tipc 路由）——拉取侧直接 `pullFile → writeIncomingFile` 串联；diff 用 step1 `diffManifests`，对端清单来自 `fetchManifest`（entries + candidateHashes 合并成带 hash 的 entries 供 diff 使用）；同步完成后把本次清单 hash 写 sync-state 的 `peers[deviceId].lastManifestHash` 作下轮 baseline；tipc 路由接 lan-sync-service 与 pairing 的订阅接口
- 待办或已知限制：
  1. **settings.json 在同步白名单内而 pairedDevices 存于其中**：全量覆盖式同步会让两端 pairedDevices 互相覆盖丢失。step 4 的 apply 层需对 settings.json 做字段级合并（至少 pairedDevices 按 deviceId 取并集、deviceName 取本端值），或把 pairedDevices 移出 settings.json。**step 3 实施前必须定此方案**。
  2. mtime 跨机浮点：Windows stat().mtimeMs 精度 ~1ms，utimes 对齐后两边可能差小数（如 708 vs 708.955），下轮仍成候选——由 step1 same 的 hash 通道兜底（幂等无损仅多算 hash），不处理
  3. 配对码方向语义：发起方生成码展示、接收方展示等确认；版本不匹配警告需 UI 在 onPairRequest/onPairingCompleted 事件里比对 hello.protocolVersion/appVersion 后提示（服务层不拦截）
  4. 防火墙首拦引导文案属 UI 层，step 4
