---
step: 4
title: UI——寻找按钮 + 离线常驻卡片 + 解除配对菜单
status: done
---

## 目标
面板加「寻找设备」按钮；已配对设备离线常驻显示；设备卡下拉菜单加解除配对（同步中禁用 + confirm）。

## 依赖上下文（接力棒输入）
- 前置 step 产出：[step3-tipc-store.md] store 有 `scan()` / `unpair(deviceId)`；peers 条目含 `online: boolean`（false=离线已配对）
- `app/data-center/sync-panel.tsx` 「在线设备」区（peers.length===0 空态卡）；`sync-peer-card.tsx` 在线 Badge（emerald）与下拉菜单（方向三选）
- 红线：confirm 用 confirm-store 的 `showConfirm()`，不用 window.confirm
- 文案口径（全局决策）：按钮「寻找设备」、离线灰 Badge「离线」、解除项红字「解除配对」

## 计划改动
- [ ] `sync-panel.tsx` 区标题行右侧加「寻找设备」按钮（RefreshCw/Search 图标 + store.scan 的 loading 自旋）；空态文案改为提示「点右上『寻找设备』主动扫描；已配对设备会常驻显示，离线也可发起同步」
- [ ] `sync-peer-card.tsx` Badge 按 `peer.online` 切换（在线 emerald / 离线 muted）；host/port 行离线时显示 `lastHost`（快照已带）或「地址未知」
- [ ] `sync-peer-card.tsx` 已配对分支的下拉菜单末尾加分隔线 + 红字「解除配对」：`syncing` 时 disabled + title 提示；点击走 `showConfirm()`（文案说明：仅解除信任关系，同步基线保留，重新配对可续用；对端需在其设备上另行解除）→ `unpair(deviceId)`
- [ ] `vite build` 通过 + 手动走查一遍三态（在线已配对/离线已配对/未配对）

## 实施回填（做完后填）

### 实际改动
- 与计划差异：
  - 「title 提示」未放解除菜单项上（Radix disabled 项 pointer-events-none，title 无法触发；且 syncing 时下拉 trigger 本身已 disabled、菜单打不开）——改放 trigger 按钮上：syncing 时 title=「同步进行中，稍后再解除」，菜单项仅保留 disabled 防御
  - 解除菜单项加 Unlink 图标；寻找按钮 scanning 时文字变「寻找中…」（与卡内「同步中…」模式一致）
  - 空态保留防火墙提示行（有实用价值），新提示句加在其前
- 改动文件清单：
  - `app/data-center/sync-panel.tsx`：设备区标题行右侧「寻找设备」按钮（RefreshCw + scanning 自旋 + disabled）；空态文案加「点右上…已配对设备会常驻显示，离线也可发起同步」
  - `app/data-center/sync-peer-card.tsx`：Badge 按 `peer.online` 切换（在线 emerald / 离线 subtle 灰）；地址行 `peer.host && peer.port` 判空显示「地址未知」；已配对分支下拉菜单末尾 DropdownMenuSeparator + 红字「解除配对」（syncing disabled）→ `showConfirm()` → `unpair(deviceId)`
- 三态走查（代码走查，无法真机）：见共享区交付文档 sync-device-ux/step4-delivery.md

### 给下一步的接力棒
- 关键签名：
  - `sync-panel.tsx` 新增 `FindDevicesButton`（内部组件，读 `scanning` / `scan`）
  - `sync-peer-card.tsx` 新增 `handleUnpair()`（showConfirm → unpair）；confirm 文案口径「仅解除信任关系，基线与映射保留，重新配对可续；对端需另行解除」
- 下个 step 该从哪里继续：
  - 设计文档 47 行 403 文案已在 Step 3 落地（orchestrator.ts:187/225），无遗留
  - 区标题「在线设备」含离线已配对条目名不副实——主会话验收时已拍板改为「设备」（sync-panel.tsx:34，微改动例外）
- 待办或已知限制：
  - 未真机验证三态渲染与 unpair 全链路，需用户实测
  - lint 0 error（既有 70 条 any warning 与本次无关）；vite build ✓；build:electron ✓（未碰主进程）
