---
step: 1
title: 托盘去色点 + 闪烁接线
status: done
---

## 目标
托盘图标不再按 phase 变色，始终普通图标；新增 `setTrayFlash`，由 surface 的 `onTrayFlash` 驱动「有 attention 会话即闪烁」；系统通知弹窗与 flashFrame 移除，提示音保留走 `notificationSoundEnabled`。

## 依赖上下文（接力棒输入）
- 设计文档：`docs/plans/2026-08/2026-08-13/proma-tray-flash-hover-design.md`
- 当前托盘代码：`apps/electron/src/main/tray.ts` — `getTrayIconImage(phase)` + `updateTrayIcon(phase)` + `updateTrayTooltip(text)`；初始图标用 `getTrayIconImage('idle')`
- 当前图标资源：`apps/electron/src/main/lib/windows-tray-icon.ts` — `TRAY_ICON_PNG_BASE64`（5 个 phase 的 PNG base64）+ `getTrayIconPngBase64(phase)` + `generateTrayTooltip(pill)`
- 当前 surface：`apps/electron/src/main/lib/windows-agent-island-surface.ts` — `onTrayUpdate(pill)` / `onNotification(transition)` / `onHoverWindowUpdate(snapshot)`；`processNotification(transition, deps)` 用 `SurfaceDeps`（含 isForeground/showNotification/flashFrame/sendPlaySound/notificationsEnabled/openSession）
- 当前接线：`apps/electron/src/main/index.ts:678-713`（win32 块内 surface 三个回调 + flashFrame 停止监听）
- 提示音设置：`getSettings().notificationSoundEnabled ?? true`（`apps/electron/src/types/settings.ts:306` 定义，默认 true）

## 计划改动

### 1. `apps/electron/src/main/lib/windows-tray-icon.ts`
- [ ] `TRAY_ICON_PNG_BASE64` 只保留 `idle` 一项，删除 running/needs-interaction/error/completed 四项
- [ ] `getTrayIconPngBase64` 改为无参（或删除函数，导出 idle 常量），只返回 idle 图标
- [ ] `generateTrayTooltip` 保持不变

### 2. `apps/electron/src/main/tray.ts`
- [ ] 移除 `TrayPhase` 类型 import 与 `getTrayIconImage(phase)` 的 phase 参数化，改为单例 idle 图标（`getTrayIdleIcon()`）
- [ ] 删除 `updateTrayIcon(phase)` 导出函数
- [ ] 新增 `setTrayFlash(on: boolean)`：on 时每 500ms 在「idle 图标 ↔ `nativeImage.createEmpty()`」之间交替；off 时恢复 idle 图标并清 timer
- [ ] `destroyTray()` 中清理闪烁 timer
- [ ] 保留 `updateTrayTooltip`

### 3. `apps/electron/src/main/lib/windows-agent-island-surface.ts`
- [ ] 新增回调 `onTrayFlash?(flashing: boolean): void`
- [ ] `onSnapshot` 中：`onTrayUpdate` 之后计算 `hasAttention = snapshot.state.sessions.some(s => s.attention)` 并调 `onTrayFlash?.(hasAttention)`
- [ ] 禁用分支（`agentIsland.enabled === false`）调 `onTrayFlash?.(false)`
- [ ] `SurfaceDeps` 简化为 `{ sendPlaySound, soundEnabled }`，删除 isForeground/showNotification/flashFrame/notificationsEnabled/openSession
- [ ] `processNotification` 简化为：`if (!deps.soundEnabled()) return; deps.sendPlaySound(mapTransitionToSoundType(transition))`
- [ ] 删除 `buildNotificationTitleBody` / `shouldFlashOnTransition`；保留 `mapTransitionToSoundType`

### 4. `apps/electron/src/main/lib/windows-agent-island-surface.test.ts`
- [ ] 删除 `buildNotificationTitleBody` / `shouldFlashOnTransition` 相关测试
- [ ] `processNotification` 测试改为：soundEnabled=false 不播；soundEnabled=true 播对应 soundType
- [ ] 保留 `mapTransitionToSoundType` / `detectPhaseTransitions` 测试（先读文件确认现有断言）

### 5. `apps/electron/src/main/index.ts`（win32 块，约 678-713 行）
- [ ] import：`updateTrayIcon` → `setTrayFlash`；移除不再用的 `Notification` import（确认无其他使用处）
- [ ] `surface.onTrayUpdate` 只保留 `updateTrayTooltip(generateTrayTooltip(pill))`
- [ ] 新增 `surface.onTrayFlash = (flashing) => setTrayFlash(flashing)`
- [ ] `notificationDeps` 改为 `{ sendPlaySound, soundEnabled: () => getSettings().notificationSoundEnabled ?? true }`
- [ ] 删除 `winForFlash` focus 停止 flashFrame 监听与 flashFrame 相关代码

## 实施回填（做完后填）

### 实际改动
- 与计划差异：
  1. 额外改了 `windows-tray-icon.test.ts`（计划 5 文件外）：`getTrayIconPngBase64` 改无参后原测试必挂，已同步删 phase 差异断言、保留 idle 非空 / PNG 签名头断言。
  2. `WindowsAgentIslandSurface` 构造函数新增可选 `isEnabled?: () => boolean`，默认 `() => getSettings().agentIsland?.enabled !== false`（与原 `=== false` 判断等价），供测试覆盖启用/禁用两分支；生产 `getWindowsAgentIslandSurface()` 无参不变。
- 改动文件清单：
  - `apps/electron/src/main/lib/windows-tray-icon.ts`
  - `apps/electron/src/main/tray.ts`
  - `apps/electron/src/main/lib/windows-agent-island-surface.ts`
  - `apps/electron/src/main/lib/windows-agent-island-surface.test.ts`
  - `apps/electron/src/main/lib/windows-tray-icon.test.ts`
  - `apps/electron/src/main/index.ts`

### 给下一步的接力棒
- `setTrayFlash(on: boolean)`：非 win32 直接 return；on=false 清 timer 并恢复 idle 图标；on=true 每 500ms 在 idle 图标 ↔ `nativeImage.createEmpty()` 交替；`destroyTray()` 已清 timer。
- `surface.onTrayFlash(flashing)`：触发依据 `snapshot.state.sessions.some(s => s.attention)`；禁用分支触发 `onTrayFlash(false)`。
- `SurfaceDeps` 新签名：`{ sendPlaySound, soundEnabled }`。
- 遗留：全量 `bun test` 有 1 个预先存在的 `planning-manager.test.ts` 失败（`UNIQUE constraint failed: planning_groups.name`），与本步无关，已单独复现确认。
