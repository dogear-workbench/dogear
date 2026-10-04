# 设备同步发现与配对 UX 改进 实施计划

**目标**：解决「设备过几分钟消失且无法唤醒」——手动寻找按钮 + 已配对设备常驻（在线/离线态）+ 解除配对（带同步保护）+ 删上线通知。

**架构思路**：已配对设备数据源从 mDNS 发现列表改为 `pairedDevices` 持久注册（常驻），在线状态为内存态；「寻找设备」= 一次 mDNS 查询 + 已配对设备 `lastHost/lastPort` HTTP 探测（无后台循环）。排除：常驻探测（用户偏好手动）、更换发现协议（过度设计）。设计全文：`../sync-device-ux-design.md`

**涉及模块**：`electron/main/services/sync/`（discovery / sync-state / pairing / orchestrator / peer-notify 删除）、`electron/main/tipc/sync.ts`、`stores/sync-store.ts`、`app/data-center/sync-panel.tsx`、`app/data-center/sync-peer-card.tsx`

## 步骤索引

- [x] [Step 1: 主进程数据层——地址记忆 + 解除配对 + 删通知](./step1-main-data.md) — SyncStatePeer 加 lastHost/lastPort、配对/同步成功时记录、unpairDevice、peer-notify 下线、403 文案加解除提示
- [x] [Step 2: 发现层——scanNow 主动扫描 + 快照含离线已配对](./step2-discovery-scan.md) — mDNS 一轮查询 + 已配对地址探测合并，peers 快照结构扩展
- [x] [Step 3: tipc 路由与 store 合并数据源](./step3-tipc-store.md) — scanPeers/unpair 路由，store 组装「已配对常驻 ∪ mDNS 未配对」
- [x] [Step 4: UI——寻找按钮 + 离线常驻卡片 + 解除配对菜单](./step4-ui.md) — 面板按钮与空态、设备卡离线态、下拉菜单解除项（同步中禁用 + confirm）
- [x] [Step 5: 全量验证与文档收尾](./step5-verify-docsync.md) — lint/build:electron/vite build/bun test 全绿 + codebase-map 同步

## 完成总结

**实际改动**（5 笔提交：33586a44 / 500b73e7 / 0df1d2d7 / 965c5e36 / 本笔）：
- 主进程数据层：SyncStatePeer 加 lastHost/lastPort（仅成功路径更新：配对确认/runSync 收尾/探测成功）；unpairDevice（同步进行中拒绝、幂等删 pairedDevices 条目、sync-state.peers 保留）；删除 peer-notify 上线通知；未配对/401/403 文案追加解除配对引导
- 发现层：discovery 加 scanNow（并发防抖，mDNS 窗口 ~2s + 已配对地址 fetchPeerInfo 3s 探测）与 getDeviceSnapshot 合并快照（mDNS 在线 ∪ 探测在线 ∪ 离线已配对常驻）；fetchPeerInfo 加可选超时参数
- tipc/store：peersChanged 广播改推合并快照（合帧防乱序）；新增 scanPeers/unpair 路由；getPeers 改名 getPeersSnapshot 统一数据源；store 加 scanning/scan()/unpair()
- UI：面板「寻找设备」按钮 + 空态引导；设备卡在线/离线 Badge、地址未知兑底；已配对下拉菜单红字「解除配对」（同步中禁用 + showConfirm）；区标题「在线设备」改「设备」
- 测试：新增 16 用例（unpair 6 + scan 7 + broadcast 3，*.impl.ts + zz-* 子进程隔离模式）；codebase-map 同步

**与原计划偏差**：
1. 403 文案额外覆盖 fetchManifest 抛 401/403 路径（对端已解除的真实报错路径）
2. fetchPeerInfo 加参替代 AbortSignal.timeout（对齐现有参数风格）
3. peersChanged 快照化落点在 discovery.notifyChanged 而非 lan-sync-service（后者是透传层）
4. getPeers 改名 getPeersSnapshot（避免 refresh 拉纯 mDNS 列表覆盖事件快照的双数据源矛盾）
5. incoming 配对不写地址（协议无对端地址，改 server.ts 属计划外；由无地址兑底分支覆盖，扫描/同步成功后自然补记）
6. UI title 提示放 trigger 按钮而非菜单项（Radix disabled 项 pointer-events-none）

**已知限制**：探测在线但 mDNS 未命中的设备发起同步报「对端不在线」（runSync 仍按纯 mDNS 判可达，设计既定：离线可点、失败有明确报告）；三态渲染与 unpair 全链路需真机实测（Windows 本端 + Mac 对端）

## 全局决策

- 已配对常驻条目的显示名：`pairedDevices[].deviceName`，无地址记录时显示 deviceId 短码兜底；在线判定 = mDNS 命中 或 最近一次扫描探测成功（内存态，重启后初始离线）
- `lastHost/lastPort` 只在**成功**路径更新（配对确认、runSync 成功收尾、scanNow 探测成功）；探测失败不删旧值
- 解除配对仅删 `settings.syncOptions.pairedDevices` 条目；`sync-state.peers` 整条保留（基线/映射/地址），重新配对后无缝续用
- 未配对设备维持现状：mDNS 发现 + 90s 剔除，不常驻
- UI 文案口径：「寻找设备」按钮；离线 Badge 灰色「离线」；解除配对菜单项红字
- 错误返回一律 `isError` 结构化消息（tipc 层抛 Error 即可，tipc 自带传输）
