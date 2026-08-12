---
step: 4
title: 系统通知 + flashFrame + 提示音委托
status: done
---

## 目标
在 phase 边沿检测到 `running→needs-interaction/completed/error` 时发 Electron Notification + flashFrame，提示音通过 IPC 委托渲染进程播放。同时禁用渲染进程的 Web Notification（Windows 上只保留提示音）。

## 依赖上下文（接力棒输入）
- 前置 step 产出：[step2-surface-core.md] `WindowsAgentIslandSurface` 已有 `onNotification?(transition: PhaseTransition)` 回调
- 现有通知模板：`apps/electron/src/main/lib/planning-reminder-scheduler.ts:19-36` — 主进程 `new Notification()` + click 事件的完整写法
- 现有提示音：`apps/electron/src/renderer/atoms/notifications.ts` — `playNotificationSoundForType(type, sounds)` 独立函数，Web Audio API
- 现有通知调用：`apps/electron/src/renderer/hooks/useGlobalAgentListeners.ts` 4 处调用（行 577/1123/1140/1181/1252）
- 提示音场景映射：`NotificationSoundType = 'taskComplete' | 'permissionRequest' | 'exitPlanMode' | 'planningReminder'`
- 现有通知设置：`notificationsEnabledAtom`（渲染进程 Jotai）→ `settings.notificationsEnabled`

## 计划改动

### 1. IPC 通道（四层）

**通道常量**：`apps/electron/src/types/` 新增
```typescript
export const WINDOWS_AGENT_ISLAND_IPC_CHANNELS = {
  PLAY_SOUND: 'windows-agent-island:play-sound',  // main → renderer
  OPEN_SESSION: 'windows-agent-island:open-session',  // renderer(hover) → main
  PUSH_SNAPSHOT: 'windows-agent-island:push-snapshot',  // main → renderer(hover)
} as const
```

**main/ipc.ts**：注册 `OPEN_SESSION` handler（悬停窗点击跳转用，Step 5 接入）

**preload/index.ts**：暴露
- `onPlayNotificationSound(callback)` — 监听 main 的播放提示音消息
- `onPushAgentIslandSnapshot(callback)` — 监听 main 推送 snapshot（悬停窗用）
- `openAgentSession(sessionId)` — 调 main 打开会话

### 2. `apps/electron/src/main/lib/windows-agent-island-surface.ts`
- [ ] `onNotification` 回调实现：
  - 前台抑制：`mainWindow.isFocused()` 时跳过 Notification（提示音照播）
  - 构建通知 title/body：
    - needs-interaction: title="待处理: {title}", body="{detail}"
    - completed: title="已完成: {title}", body="点击查看"
    - error: title="需关注: {title}", body="{detail}"
  - `new Notification({ title, body, silent: true })` + click → 聚焦窗口 + 打开会话
  - flashFrame：仅 needs-interaction 时 `mainWindow.flashFrame(true)`
- [ ] 提示音触发：通过 `mainWindow.webContents.send(PLAY_SOUND, { type })` 委托渲染进程
  - needs-interaction + interactionKind=permission → `permissionRequest`
  - needs-interaction + interactionKind=ask_user_question → `permissionRequest`
  - needs-interaction + interactionKind=plan_review → `exitPlanMode`
  - completed → `taskComplete`
  - error → `taskComplete`
- [ ] flashFrame 停止：监听 `mainWindow.on('focus', () => flashFrame(false))`

### 3. `apps/electron/src/renderer/atoms/notifications.ts`
- [ ] `sendDesktopNotification` 中 Windows 平台跳过 `new Notification`（只保留提示音播放）
  ```typescript
  // 提示音照播（不变）
  if (options?.playSound && options.soundType) {
    await playNotificationSoundForType(...)
  }
  if (!enabled) return
  // Windows 上通知由主进程统一发，渲染进程跳过
  if (process.platform === 'win32') return
  // macOS 保留原有 Web Notification（不变）
  ```

### 4. `apps/electron/src/renderer/hooks/useGlobalAgentListeners.ts`
- [ ] 新增 IPC listener：`window.electronAPI.onPlayNotificationSound(({ type }) => { playNotificationSoundForType(type, sounds) })`
- [ ] 注意：现有 4 处 `sendDesktopNotification`/`sendBlockingNotification` 调用**不需要删除**——`sendDesktopNotification` 内部已在 Windows 上跳过通知，提示音仍由原始调用路径播放（作为 fallback）。主进程的 IPC 提示音触发是主路径。两条路径播放同一个音，靠 `playNotificationSound` 的 300ms 防重叠机制避免双音。

### 5. 测试：`apps/electron/src/main/lib/windows-agent-island-surface.test.ts`（扩展）
- [ ] phase 边沿 → 通知 title/body 映射正确（needs-interaction/completed/error 各一条）
- [ ] 前台抑制：mainWindow.isFocused()=true 时不发通知
- [ ] flashFrame 仅 needs-interaction 触发
- [ ] 提示音 type 映射正确（permission→permissionRequest, plan_review→exitPlanMode, completed→taskComplete）
- [ ] 设置关闭（notificationsEnabled=false）时不发通知也不播放提示音

注意：涉及 Electron API（Notification/BrowserWindow/webContents）的部分用依赖注入 mock：
```typescript
// surface 构造函数接受 deps
interface SurfaceDeps {
  isForeground: () => boolean
  showNotification: (opts: { title: string; body: string }) => { onClick: (cb: () => void) => void }
  flashFrame: (on: boolean) => void
  sendPlaySound: (type: string) => void
  notificationsEnabled: () => boolean
}
```
测试传入 mock deps，不依赖真实 Electron。

## 实施回填（做完后填）

### 实际改动
- 与计划差异（3 处，均合理）：
  1. **SurfaceDeps 增加 `openSession` 方法**：通知 click 需要打开会话，纳入依赖注入。
  2. **OPEN_SESSION handler 已完整实现**：为 Step 5 悬停窗预留（转发到 TRAY_IPC_CHANNELS.OPEN_AGENT_SESSION + show + focus）。
  3. **渲染进程平台判断用 `detectIsWindows()`**（`@/lib/platform`，基于 navigator.userAgentData / navigator.platform），不用 `process.platform`（渲染进程不可用）。
- 改动文件清单（proma 仓库 C:/proma，9 个文件）：
  1. `apps/electron/src/types/settings.ts` — 新增 WINDOWS_AGENT_ISLAND_IPC_CHANNELS（PLAY_SOUND / OPEN_SESSION / PUSH_SNAPSHOT）
  2. `apps/electron/src/main/lib/windows-agent-island-surface.ts` — SurfaceDeps 接口 + buildNotificationTitleBody / mapTransitionToSoundType / shouldFlashOnTransition / processNotification
  3. `apps/electron/src/main/lib/windows-agent-island-surface.test.ts` — 新增 22 条测试（总计 34 pass）
  4. `apps/electron/src/preload/index.ts` — onWindowsAgentIslandPlaySound / onWindowsAgentIslandPushSnapshot / openAgentIslandSession
  5. `apps/electron/src/main/ipc.ts` — OPEN_SESSION handler
  6. `apps/electron/src/main/index.ts` — win32 守卫下连接 surface.onNotification + SurfaceDeps 实现 + flashFrame 停止监听
  7. `apps/electron/src/renderer/atoms/notifications.ts` — Windows 上 detectIsWindows() 跳过 Web Notification（提示音保留）
  8. `apps/electron/src/renderer/hooks/useGlobalAgentListeners.ts` — onWindowsAgentIslandPlaySound IPC listener
  9. `apps/electron/package.json` — 0.17.20 → 0.17.21

### 给下一步的接力棒
- **SurfaceDeps 接口**：`{ isForeground, showNotification, flashFrame, sendPlaySound, notificationsEnabled, openSession }`
- **IPC 通道**：`WINDOWS_AGENT_ISLAND_IPC_CHANNELS.PLAY_SOUND`（main→renderer 提示音）/ `OPEN_SESSION`（renderer→main 已实现）/ `PUSH_SNAPSHOT`（main→renderer 悬停窗用，Step 5 接入）
- **preload bridge**：`onWindowsAgentIslandPushSnapshot(callback)` 已就绪，Step 5 悬停窗 React 组件直接监听
- **onHoverWindowUpdate 回调**：WindowsAgentIslandSurface 已有此回调（V1 no-op），Step 5 需在 index.ts win32 块里注入：发送 PUSH_SNAPSHOT 到悬停窗
- 下个 step 创建悬停窗 BrowserWindow + React 组件，注入 onHoverWindowUpdate。
