# 设备同步发现与配对 UX 改进 设计

**日期**：2026-10-04
**背景**：
- mDNS 组播在 Windows↔Mac 间不稳定：启动时能互相发现，持续组播流断后 90 秒（`discovery.ts` `PEER_STALE_MS`）对端从「在线设备」剔除，且 requery 依赖同一失效通道、面板无手动发现入口——设备「过几分钟就没了、唤不回」
- 已配对设备的呈现完全依赖 mDNS 发现列表，消失后连发起同步的入口都没有
- 「检测到 xxx 在线」通知（`peer-notify.ts`）被用户判定为多余
- 无解除配对功能
- 用户偏好：手动按需发现，**不接受后台常驻探测**（虽开销极小）

**目标**：
1. 「寻找设备」按钮：手动触发一次主动发现（mDNS 一轮 + 已配对设备已知地址 HTTP `/info` 探测）
2. 已配对设备常驻列表（在线绿点/离线灰态），不再随 mDNS 消失；未配对设备维持 mDNS 发现 + 90 秒剔除
3. 「解除配对」（下拉菜单项，同步进行中禁用；保留同步基线与工作区映射）
4. 删除「已配对对端上线」通知（`peer-notify.ts` 整个下线）；配对请求维持面板内卡片形式，不加通知（现状即满足，明确决策）

**架构**（核心做法 + 排除的选项）：
- 排除：后台常驻 HTTP 探测循环（用户偏好手动）；更换发现协议/UDP 广播自定义（过度设计，两台机器场景 mDNS 首次发现够用）
- 采纳：手动扫描 = mDNS 主动查询一轮（约 2s 窗口）+ 并行探测已配对设备 `lastHost:lastPort`（`fetchPeerInfo`，3s 超时/台）
- 已配对设备数据源 = `settings.syncOptions.pairedDevices`（持久注册）∪ mDNS 在线态；在线状态为内存态（mDNS 命中或探测成功），离线仍常驻显示
- 地址记忆：`SyncStatePeer` 增加 `lastHost?` / `lastPort?`（配对确认、同步成功、探测成功时更新）——IP 漂移后靠 mDNS 再发现时刷新
- 解除配对：仅删本端 `pairedDevices` 条目（协议层即断：对端请求 403）；`sync-state.peers` 条目（lastManifest 基线 / workspaceMap / 地址）**保留**，重新配对后接着同步

**模块边界**：
- `electron/main/services/sync/discovery.ts`：新增 `scanNow()`——主动 mDNS 查询一轮 + 已配对设备地址探测，结果并入 peers 快照；peers 快照结构扩展（含离线已配对条目，字段 `online: boolean`）
- `electron/main/services/sync/sync-state.ts`：`SyncStatePeer` 加 `lastHost?`/`lastPort?`
- `electron/main/services/sync/pairing.ts`：新增 `unpairDevice(deviceId)`（runningSync 进行中拒绝）；配对确认成功时记录对端地址
- `electron/main/services/sync/orchestrator.ts`：同步成功收尾把 peer.host/port 写入 `peerState.lastHost/lastPort`
- `electron/main/services/sync/peer-notify.ts`：删除；`lan-sync-service.ts:92` 移除 `initPeerOnlineNotifications()` 调用
- `electron/main/tipc/sync.ts`：新增 `scanPeers` / `unpair` 路由；peers 快照 tipc 输出结构同步扩展
- `stores/sync-store.ts`：peers 合并数据源（已配对常驻 + mDNS 未配对）、`scan()` / `unpair()` actions
- `app/data-center/sync-panel.tsx`：「寻找设备」按钮（扫描中 loading）+ 空态文案调整（提示点按钮）
- `app/data-center/sync-peer-card.tsx`：离线态（灰 Badge、地址显示 lastHost）、解除配对菜单项（红字，同步中禁用，confirm 弹窗确认）

**数据流**：
- 扫描：UI 按钮 → tipc `scanPeers` → `discovery.scanNow()`（mDNS 一轮等待 + 并行探测）→ 快照广播 `peersChanged` → store 刷新 → UI 出结果（在线/离线）
- 常驻：store 组装 = pairedDevices（含从未在线的，用 peerState.lastHost 或 deviceId 兜底显示）∪ 当前 mDNS peers；已配对条目永不因剔除消失
- 解除配对：UI confirm → tipc `unpair` → runningSync 检查 → settings 删条目 → 广播刷新（卡片转为未配对态或消失——按 mDNS 是否仍见它）

**错误处理 / 边界情况**：
- 探测失败的已配对设备：显示离线，地址保留，下次扫描再试；离线时同步按钮仍可点，失败有明确报告（不静默）
- 解除配对时对端正在拉取本端：文件传输先 temp 后完整落盘（`saveStreamToTempFile`），对端最多收到失败报告重试，无半成品文件
- 已配对但无地址记录（配对后从未同步/探测）：离线显示 deviceId 兜底，等 mDNS 发现
- 同设备 mDNS 实例名漂移（如 `-local` 后缀）：按 deviceId 去重（现有逻辑）

**未决问题**：
- 对端被解除后仍显示「已配对」，同步时 403。是否在 orchestrator 的 403 错误文案里加提示「对端可能已解除配对，请解除后重新配对」——实施 Step 时顺手改一行文案（倾向做，成本一句话）
