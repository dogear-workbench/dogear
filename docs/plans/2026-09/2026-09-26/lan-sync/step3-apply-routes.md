---
step: 3
title: 传输与应用
status: done
---

## 目标
完整同步编排：清单交换 → diff → 双向传输 → 原子写入 + 冲突副本；tipc 路由齐备。

## 依赖上下文（接力棒输入）
- 前置 step 产出：step1 `diffManifests` 签名、step2 server 的 HTTP 路由与设备密钥
- 关键决策回顾：LWW mtime 新者胜；旧方写 `.conflict-<对端短ID>` 副本；中断幂等

## 计划改动
- [ ] 新建 `electron/main/services/sync/apply.ts`：
  - `applyIncoming(root, entries, peerId)`——逐文件：临时文件写 + rename；冲突文件先落 `.conflict` 副本再覆盖
  - `pushOutgoing(root, entries, peer)`——流式读 + gzip + POST
  - 单文件失败（占用/权限）→ 记入 `skipped[]` 继续其余，不整体失败
- [ ] `electron/main/services/sync/orchestrator.ts`：`runSync(peer): Promise<SyncReport>`——握手版本检查（不匹配抛可确认警告）→ 双向清单 + hash → diff → 先拉后推（或按 mtime 交错，简单起见串行）→ 写 sync-state → 返回报告 `{ pulled, pushed, conflicts, skipped, durationMs }`
- [ ] 同步中防重入：进行中再次触发直接返回状态
- [ ] 新建 `electron/main/tipc/sync.ts` 路由（文件末尾 `registerTools()` 注册，遵守项目 tipc 规范）：`getPeers()`、`getSyncState()`、`runSync(peerId)`、`requestPair(peerId, code)`、`getPairCode()`、`setSyncOptions(opts)`、`syncEvent` 事件订阅（进度/完成推渲染层）
- [ ] settings 结构：`settings-service.ts`/`settings-types.ts` 增 `syncOptions: { deviceName, syncStocksData, syncFeishu, pairedDevices }`（默认值见 plan.md 全局决策）
- [ ] 验证：Windows 双实例 localhost 全流程——增量（改笔记→同步→对端可见）、冲突（双侧同文件各改→LWW+副本）、中断重试（同步中 kill 对端→重启→续传语义正确）
- [ ] `bun run build:electron` 通过 + Windows 主功能冒烟

## 实施回填（做完后填）

### 实际改动
- 与计划差异：
  1. apply.ts 在计划两项（applyIncoming/pushOutgoing）外新增：冲突副本函数（conflictCopyRelPath/saveLocalConflictCopy）、saveStreamToTempFile（本端胜冲突时对端旧内容的中转）、mergeIncomingSettings（settings.json 字段级合并，拉取端 applyIncoming 与服务端 POST /file 双入口共用）
  2. sync-state 的 baseline 存取形态：SyncStatePeer 增 `lastManifest?: FileEntry[]`（同步收敛后本端清单快照，带内容 hash），lastManifestHash 退化为快照整体指纹（仅展示）；新 baseline 由 buildNextBaseline 增量构建——传输文件用传输时刻 hash、未变文件继承旧基线 hash、其余重算，避免每轮全量 sha256
  3. pairing.ts 将 startPairing 拆为 beginPairing（同步返回展示码 + 后台结果 Promise），避免 tipc 层挂 150s；新增 ensureSelfHello/getOutgoingPairingCode
  4. tipc/sync.ts 除计划 7 项外补充：getSyncStatus/getRunningSync/getPendingPairRequests/confirmPairRequest/rejectPairRequest（配对与状态面板必需）；事件订阅用项目现有 renderer-handlers + broadcastToWindows 广播模式（RendererHandlers 增 syncEvent 统一事件，五路合一：status/peers/sync/pair-request/pairing-completed）
  5. 实施中发现并修复：settings.json 字段级合并最初只在拉取端做，推送端（被动接收方）POST /file 是整文件覆盖，配对信息仍会互丢 → server.ts 对 settings.json 同样走 mergeIncomingSettings
  6. 实施中发现并修复：merge 并集会把自身 deviceId 吸进 pairedDevices → mergeIncomingSettings 剔除自身条目
- 改动文件清单：
  - `electron/main/services/sync/apply.ts`：applyIncoming/pushOutgoing/冲突副本/saveStreamToTempFile/mergeIncomingSettings/shortDeviceId/conflictCopyRelPath
  - `electron/main/services/sync/orchestrator.ts`（新建）：runSync 全流程（版本检查拦截确认 → 清单交换+候选 hash 合并 → diff → LWW 冲突双方向副本保障 → 先拉后推 → buildNextBaseline → 写 sync-state）、防重入、onSyncProgress
  - `electron/main/services/sync/sync-state.ts`：SyncStatePeer 增 lastManifest
  - `electron/main/services/sync/pairing.ts`：beginPairing/getOutgoingPairingCode/ensureSelfHello
  - `electron/main/services/sync/manifest.ts`：导出 sha256File
  - `electron/main/services/sync/server.ts`：POST /file 对 settings.json 走字段级合并
  - `electron/main/tipc/sync.ts`（新建）：10 个 procedure + registerSyncBroadcaster
  - `electron/main/tipc/renderer-handlers.ts`：RendererHandlers 增 syncEvent + SyncEventPayload
  - `electron/main/tipc/index.ts`：注册 syncRouter + registerSyncBroadcaster

### 验证结果

Windows 单机双实例（两进程 + 独立 sandbox 数据目录 + electron stub），10 组场景 48 项断言全部通过：
增量（新建互传）、幂等重跑零传输、baseline 单侧判定（本地改→push / 对端改→pull，无基线不误判）、
双改冲突两方向（对端胜→本端留 .conflict-<对端短ID> 副本后拉覆盖；本端胜→对端旧内容先推成对端侧副本再覆盖）、
settings.json 字段级合并（双端各自配对不同设备后双向同步，配对并集不丢、deviceName 各自保留、开关跟人走、不含自身 deviceId）、
中断重试（对端不可达→failed 且 lastSyncAt/baseline 不动→重启→补齐→幂等）、防重入（并发第二次返回 in-progress）、
协议版本不匹配（blocked+confirmRequired → 确认后放行+警告留存）。`bun run build:electron` 通过，本 step 文件 lint 零警告。

### 给下一步的接力棒
- 关键签名 / 数据结构：
  - `runSync(peer: {deviceId,host,port,deviceName?}, opts?: {confirmVersionMismatch?}): Promise<SyncReport>`；SyncReport 含 status('completed'|'failed'|'blocked'|'in-progress')/pulled/pushed/conflicts[]/skipped[]/warnings[]/confirmRequired?('protocol-version-mismatch')/remoteHello
  - tipc procedure 名：getSyncStatus/getPeers/getSyncState/getRunningSync/runSync/requestPair/getPairCode/getPendingPairRequests/confirmPairRequest/rejectPairRequest/setSyncOptions（支持 removeDeviceId）；渲染层订阅 `syncEvent`（SyncEventPayload 五路 kind）
  - requestPair 立即返回 `{code}`（本端展示码），结果走 pairing-completed 事件；对端请求走 pair-request 事件（confirm/reject 用 requestId）
- 下个 step 该从哪里继续：step4 前端「设备同步」面板——订阅 syncEvent 渲染在线状态/同步进度/冲突列表/配对确认弹窗；版本不匹配时按 confirmRequired 弹确认后带 confirmVersionMismatch:true 重调 runSync
- 待办或已知限制：
  1. settings.json 因 deviceName 机器特定，物理内容两端永不完全一致 → 每轮同步稳态拉取一次（约 1-2KB，merge 后落盘内容无变化），UI 计数上会常驻 1 条 pull，属预期行为
  2. 冲突副本（*.conflict-<短ID>）会作为普通文件在下一轮同步到对端（两端都能看到冲突记录），结果面板展示时注意与正式文件区分
  3. 首次同步（无共同基线）同名异内容仍保守判 conflict（step1 设计），面板层建议提供「首次以某端为准」引导
  4. mtime 跨机浮点漂移使部分文件每轮成候选（hash 兑底判 same，幂等无损），v1 不处理
