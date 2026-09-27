---
step: 4
title: 前端面板
status: done
---

## 目标
数据中心「设备同步」面板可用：对端状态、一键同步、结果/冲突展示、可选项开关；启动时对端变化通知。

## 依赖上下文（接力棒输入）
- 前置 step 产出：step3 的 tipc 路由全集与 `SyncReport` 结构、`syncEvent` 事件
- 关键决策回顾：不自动同步，通知只提示

## 计划改动
- [x] 新建 store `stores/sync-store.ts`（命名遵守 xxx-store.ts 规范）：peers、syncState、进行中报告、历史；事件订阅 tipc `syncEvent`
- [x] 数据中心新增「设备同步」面板（路由/导航挂入数据中心现有面板体系，参考用量/记忆面板的挂载方式）：
  - 对端卡片：设备名、在线状态、上次同步时间、「同步」按钮（进行中显示同步中态 spinner；事件 payload 无传输进度数据，见回填差异说明）
  - 结果区：拉取/推送/冲突/跳过计数；冲突文件列表（完整 relPath + 一键复制）；跳过文件列表与原因
  - 设置区：设备名编辑、可选项开关（行情数据、飞书数据）、已配对设备列表（可解除配对）
  - 配对流程 UI：发起配对 → 显示 6 位码等待对端确认 → 接收方卡片展示对端名+码比对后确认/拒绝 → 成功 toast + 刷新
- [x] 启动通知（按拍板决策改实现）：不做清单摘要比对，改为「已配对对端上线即通知」——peer-notify.ts 订阅 onPeersChanged，会话内首次出现且已配对 → 通知中心 add（dedupeKey `sync:{deviceId}:online`），点击跳转数据中心设备同步面板
- [x] 验证：build:electron + 渲染层 tsc + vite build + lint 全通过；双实例 UI 联调需人工点交互（配对码比对/确认框），留 step5 实测
- [x] `bun run build:electron` + lint 通过

## 实施回填（做完后填）

### 实际改动
- 与计划差异：
  1. 「进行中显示已传输文件数/字节」未做：`SyncProgressEvent` 只有 started/completed 两态，无传输量数据；改为 spinner + 同步中文案
  2. 「点击定位文件」未做：冲突/跳过文件为数据文件 relPath，无现成定位通道；按任务预案展示完整 relPath + 一键复制
  3. 「清单摘要比对通知」按拍板决策改为「已配对对端上线即通知」（主进程侧小接线 peer-notify.ts + notification-center type 扩展 'sync' + NotificationCenter 点击分支）
  4. 事件订阅挂 App 根层全局（而非面板内）：同步完成 toast、入站配对请求在任意页面都有效；面板未开时通过 initialize 拉全量恢复状态
- 改动文件清单：
  - 新增：`stores/sync-store.ts`、`app/data-center/sync-panel.tsx`、`sync-peer-card.tsx`、`sync-pair-requests.tsx`、`sync-result.tsx`、`sync-settings.tsx`、`sync-utils.ts`、`electron/main/services/sync/peer-notify.ts`
  - 修改：`app/data-center/page.tsx`（受控 tab + 设备同步页签）、`src/App.tsx`（全局订阅）、`components/NotificationCenter.tsx`（sync 类型图标+跳转分支）、`types/notification.ts`（镜像 type）、`electron/main/services/notification-center-service.ts`（type 加 'sync'）、`electron/main/services/sync/lan-sync-service.ts`（一行接线 initPeerOnlineNotifications）

### 给下一步的接力棒
- 关键签名：`useSyncStore`（status/peers/syncOptions/syncState/runningSync/lastReport/pendingPairRequests/outgoingPairing；subscribe/refresh/runSync/requestPair/confirmPairRequest/rejectPairRequest/updateSyncOptions）；`requestSyncPanelFocus()` + DataCenterPage 的 `syncPanelFocusAt` 消费实现通知跳转切 tab
- 下个 step 从哪继续：step5 真实双机实测（Windows 防火墙放行、跨机 mtime 精度、完整 UI 流程：配对→同步→冲突副本→通知跳转）
- 待办或已知限制：独立数据中心窗口开着时，主窗口通知点击无法把焦点请求传给独立窗口（zustand 不跨窗口）；同步中无文件级进度（协议层无此数据）；旧版 AppSettings 镜像 types/settings.ts 未加 syncOptions 字段（面板直接从主进程类型 import，渲染层镜像可后续补）
