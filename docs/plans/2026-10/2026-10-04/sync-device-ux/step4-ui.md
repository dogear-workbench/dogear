---
step: 4
title: UI——寻找按钮 + 离线常驻卡片 + 解除配对菜单
status: pending
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
- 改动文件清单：

### 给下一步的接力棒
- 关键签名：
- 下个 step 该从哪里继续：
- 待办或已知限制：
