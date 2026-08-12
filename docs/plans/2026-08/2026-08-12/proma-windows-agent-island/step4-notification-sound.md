---
step: 4
title: 系统通知 + flashFrame + 提示音委托
status: pending
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
- 与计划差异：
- 改动文件清单：

### 给下一步的接力棒
- `SurfaceDeps` 接口的最终定义：
- IPC 通道常量的最终命名：
- 下个 step 该从哪里继续：
