# Proma Windows Agent 状态通知方案设计

## 背景

Proma 的「Agent 灵动岛」是一个 macOS 26+ 独占功能，通过原生 Swift `NSPanel` 进程在屏幕刘海区常驻展示 Agent 运行状态。Windows/Linux 上**完全没有实现**（连状态机都不初始化），用户在后台运行 Agent 时只能依赖渲染进程的 Web Notification（窗口隐藏时可靠性存疑）+ 任务栏 Overlay Icon 数字角标。

本方案为 Windows 平台设计一套 Agent 状态通知系统，作为灵动岛的跨平台替代，核心价值：
- **主进程级系统通知**（不依赖窗口存活，比渲染进程 Web Notification 更可靠）
- **托盘图标状态化**（一眼看全局，不需要打开窗口）
- **悬停弹窗**（鼠标移到托盘显示会话列表，类似灵动岛展开态的轻量版）
- **flashFrame**（需要用户操作时任务栏闪烁）

## 目标

1. 复用现有 `AgentIslandService` 状态机，不重复造轮子
2. macOS 完全不动，Windows 作为平行 surface 接入
3. 提示音功能不受影响（Web Audio API 留在渲染进程）
4. 不挡窗口、不抢焦点——这是对灵动岛"常驻刘海"体验的 Windows 友好替代

## 架构

### 核心做法

```
agentEventBus（已有，平台无关）
    │
    ▼
AgentIslandService 状态机（已有，平台无关，零改动）
    │  产出 NativeAgentIslandSnapshot
    │
    ├──→ [macOS 26+] Swift helper → NSPanel（已有，不动）
    │
    └──→ [Windows] WindowsAgentIslandSurface（新增）
              │
              ├── ① 托盘图标状态化（SVG 动态生成，叠加状态色点）
              ├── ② 系统通知（phase 边沿检测 → Electron Notification）
              ├── ③ flashFrame（仅 needs-interaction 触发）
              └── ④ 悬停弹窗内容推送（webContents.send → hover window）
```

### 排除的选项及原因

- **Electron 透明悬浮窗模拟灵动岛（常驻置顶）**：常驻 alwaysOnTop 会挡窗口、焦点抢占、多显示器适配差。用户明确反馈过"挡着前台"的问题，不重蹈覆辙。这里排除的是「常驻」置顶悬浮窗；悬停弹窗是短暂显示，置顶不构成常驻遮挡（见下文窗口属性）。
- **从零写一套独立的状态通知服务**：AgentIslandService 的事件折叠、优先级、节流、可见性指纹等逻辑已经成熟，重新写一遍既浪费又容易不一致。
- **把提示音也迁移到主进程**：主进程没有 Web Audio API，现有提示音系统的蓝牙兼容性（AudioBuffer 预解码 + 防破音）无法在主进程实现。

### 门禁拆分

当前 `isAgentIslandSupported()` 把"状态机初始化"和"macOS Swift surface 启动"绑在一个布尔值里。拆为两个：

| 函数 | macOS | Windows | 用途 |
|------|-------|---------|------|
| `isAgentIslandServiceSupported()` | ✅ | ✅ | 状态机是否初始化 |
| `isMacAgentIslandSurfaceSupported()` | ✅ (26+) | ❌ | Swift helper 是否启动 |

`index.ts` 初始化逻辑改为：
```typescript
if (isAgentIslandServiceSupported()) {
  initAgentIslandService({ ... })  // macOS + Windows 都跑
}
if (isMacAgentIslandSurfaceSupported()) {
  startAgentIslandSurface()  // 仅 macOS
}
if (process.platform === 'win32') {
  initWindowsAgentIslandSurface({ ... })  // 仅 Windows
}
```

### pushState() 接入

`agent-island-service.ts` 的 `pushState()` 末尾当前硬编码 macOS 截断：
```typescript
// 现有（保留）
if (isMacAgentIslandNativeHostReady()) {
  publishMacAgentIslandSnapshot(buildNativeSnapshot(state, planning))
}
// 新增 Windows 平行出口
if (process.platform === 'win32') {
  publishWindowsAgentIslandSnapshot(buildNativeSnapshot(state, planning))
}
```

状态机本身（事件折叠、快照、优先级、节流、可见性指纹）**零改动**。

## 模块边界

### 新增文件

| 文件 | 职责 |
|------|------|
| `main/lib/windows-agent-island-surface.ts` | Windows surface 协调器：接收 snapshot → 分发给四个子职责 + phase 边沿检测 |
| `main/lib/windows-tray-icon.ts` | SVG 动态生成托盘图标（复用 `dock-badge-service.ts` 的 SVG→nativeImage 管道） |
| `main/agent-status-hover-window.ts` | 悬停弹窗窗口管理器（创建/定位/显示/隐藏，参考 `voice-dictation-window.ts`） |
| `renderer/components/agent-status-hover/HoverPanel.tsx` | 悬停窗 React 组件（会话列表 + 状态色点 + 点击跳转） |

### 修改文件

| 文件 | 改动 |
|------|------|
| `main/lib/agent-island-service.ts` | `pushState()` 加 Windows 出口；`enabled` 回调去掉 macOS 硬依赖 |
| `main/lib/macos-version.ts` | 拆分 `isAgentIslandSupported` → 两个函数 |
| `main/index.ts` | 初始化逻辑按平台分发（状态机全平台、Swift 仅 macOS、Windows surface 仅 Windows） |
| `main/tray.ts` | 注册 `mouse-enter`/`mouse-leave` 事件；暴露 `getBounds()` 给悬停窗定位；接收动态图标 |
| `main/ipc.ts` | 新增 `PLAY_NOTIFICATION_SOUND` 通道（主进程→渲染进程委托播放提示音）；悬停窗点击跳转 handler |
| `preload/index.ts` | 暴露 `onPlayNotificationSound` 监听 + 悬停窗 IPC bridge |
| `renderer/atoms/notifications.ts` | `sendDesktopNotification` 在 Windows 上跳过 Web Notification（只保留提示音由主进程 IPC 触发） |
| `renderer/hooks/useGlobalAgentListeners.ts` | Windows 上跳过 4 处通知调用（`sendDesktopNotification` × 2 + `sendBlockingNotification` × 2），提示音改由 IPC listener 触发 |
| `renderer/main.tsx`（或入口） | 根据 `?window=agent-status-hover` query 参数渲染 HoverPanel |
| `types/settings.ts` | `AgentIslandSettings` 可选复用（语义从"灵动岛"扩展为"Agent 状态展示"） |
| `renderer/components/settings/GeneralSettings.tsx` | Windows 上显示"Agent 状态通知"开关（复用 `agentIsland.enabled`，改文案） |

## 数据流

### 1. 状态更新流（每次 snapshot 变化）

```
Agent 运行
  → agentEventBus.emit(sessionId, payload)
  → AgentIslandService.handleAgentEvent()  // 事件折叠
  → schedulePush()  // 节流（即时 80ms / 流式 2000ms）
  → pushState()
    → JSON diff 去重（已有，平台无关）
    → buildNativeSnapshot()  // 聚合可见会话 + planning
    → publishWindowsAgentIslandSnapshot(snapshot)  // 新增 Windows 出口
      → WindowsAgentIslandSurface.onSnapshot(snapshot)
        → ① 更新托盘图标（取 pill.priorityStatus → 生成 SVG → tray.setImage）
        → ② 更新 tooltip（"N 个会话执行中 · M 个待处理"）
        → ③ 推送悬停窗内容（webContents.send → HoverPanel 更新）
```

### 2. 通知触发流（仅 phase 边沿）

```
WindowsAgentIslandSurface 维护 prevSnapshot
  → 新 snapshot 到来
  → diff 每个 session 的 phase
  → 检测边沿：
      running → needs-interaction  → Notification + flashFrame + 提示音
      running → completed           → Notification + 提示音
      running → error               → Notification + 提示音
      其他                            → 不通知
  → 前台抑制（窗口聚焦时跳过 Notification，提示音照播）
  → 点击通知 → 聚焦主窗口 + 打开对应会话
  → 提示音 → webContents.send('play-notification-sound', { type }) → 渲染进程播放
```

### 3. 悬停弹窗交互流

```
鼠标移入托盘
  → tray.on('mouse-enter', (bounds) => ...)
  → 延迟 300ms（防抖）
  → 计算窗口位置（bounds.x + bounds.width/2 - windowWidth/2, bounds.y - windowHeight）
  → HoverWindow.showInactive()（不抢焦点）
  → 显示最新 snapshot 内容（已通过数据流 1 持续推送）

鼠标移出托盘
  → tray.on('mouse-leave', () => ...)
  → 延迟 400ms
  → HoverWindow.hide()

点击会话卡片
  → IPC → 主进程 → 打开对应会话 + 聚焦主窗口
  → HoverWindow.hide()
```

## 悬停弹窗设计

### 窗口属性（参考 voice-dictation-window.ts）

```typescript
{
  width: 320,
  height: 'auto',  // 根据内容动态调整，上限 400
  frame: false,
  transparent: true,
  backgroundColor: '#00000000',
  skipTaskbar: true,
  alwaysOnTop: true,    // 必须：Windows 上透明窗口 showInactive() 不提升 Z 序，会被主窗口遮挡
  focusable: false,     // 不抢焦点
  resizable: false,
  movable: false,
  show: false,          // 初始隐藏
  hasShadow: true,
  webPreferences: { preload: 'preload.cjs', contextIsolation: true }
}
```

> 实测修正：**必须用 `alwaysOnTop: true`**。Windows 上 `transparent` 窗口调用 `showInactive()` 不会提升 Z 序，窗口会显示在主窗口下面，导致「日志全对、窗口看不见」。置顶在 hover 场景不构成「挡窗口」：窗口只在悬停时短暂显示（mouse-leave 400ms / 5 秒 autoHide），且 `focusable: false` 不抢焦点。与 voice-dictation-window.ts 的语音指示器做法一致。

### 渲染入口

复用 proma SPA 模式（所有窗口加载同一个 `index.html`，用 query 参数区分）：
- 开发环境：`http://127.0.0.1:5173?window=agent-status-hover`
- 生产环境：`loadFile('renderer/index.html', { query: { window: 'agent-status-hover' } })`

### 内容布局

```
┌──────────────────────────────────┐
│  🔵 执行中  ·  3 个会话           │  ← pill 摘要（priorityStatus + 计数）
├──────────────────────────────────┤
│  🟠 待处理                        │
│  "帮我重构认证模块..."             │  ← 点击 → 打开会话
│  等待权限确认: Edit               │  ← detail（交互类型）
├──────────────────────────────────┤
│  🔵 执行中                        │
│  "分析 Q3 销售数据..."             │  ← 点击 → 打开会话
│  正在使用 Read                    │  ← detail（最近活动行）
├──────────────────────────────────┤
│  🟢 已完成                        │
│  "写周报..."                      │  ← 点击 → 打开会话
└──────────────────────────────────┘
```

数据来源：`NativeAgentIslandSnapshot.state.sessions[]`，每个 session 已含 `phase`/`detail`/`title`/`interactionKind`/`attention`。

最多显示 5 个会话（按优先级排序，状态机已算好）。无活跃会话时显示"暂无活跃 Agent"+ 最近 1 个完成的会话。

## 托盘图标状态映射

| pill.priorityStatus | 色点颜色 | 含义 |
|---------------------|---------|------|
| `running` | 蓝色 `#6BB7FF` | 有 Agent 在执行 |
| `needs-interaction` | 橙色 `#FFA835` | 需要用户操作 |
| `error` | 红色 `#E5534B` | 执行出错 |
| `completed`（有未读） | 绿色 `#4ADE80` | 有完成的任务 |
| `idle` | 无色点 | 默认图标 |

多状态并存时取最高优先级（复用 `getAgentIslandPhasePriority()`）。

图标生成方式：基础图标 SVG + 右下角 6px 色点圆 → `nativeImage.createFromDataURL()`，复用 `dock-badge-service.ts:9` 的管道。

## 设置项

复用 `agentIsland.enabled`（语义从"灵动岛开关"扩展为"Agent 状态展示开关"）：
- macOS：控制灵动岛（行为不变）
- Windows：控制托盘图标状态化 + 悬停弹窗 + 主进程通知（新增）
- 通知和提示音继续跟随现有的 `notificationsEnabled`（行为不变）

GeneralSettings.tsx 改动：
- macOS：文案不变（"Agent 灵动岛"）
- Windows：显示开关，文案改为"Agent 状态通知"（描述："在任务栏托盘显示 Agent 运行状态"）
- 把 `{isMac && (...)}` 改为 `{(isMac || isWindows) && (...)}`

## 错误处理 / 边界情况

1. **Windows 托盘被系统折叠**：Windows 11 默认可能将托盘图标折叠到溢出区。这是系统行为，无法控制。Overlay Icon（任务栏角标）作为补充仍可见。
2. **多显示器**：`tray.getBounds()` 返回托盘图标所在显示器的坐标，悬停窗定位基于此计算。需要用 `screen.getDisplayNearestPoint()` 确保窗口不出屏。
3. **DPI 缩放**：托盘图标 SVG 需要同时生成 16×16 / 32×32 两种尺寸（`nativeImage` 支持 `@2x` 后缀自动选择）。
4. **mouse-leave 未触发**：如果用户鼠标快速移出，`mouse-leave` 可能丢失。增加兜底：悬停窗 `mouse-leave` 事件 + 5 秒超时自动隐藏。
5. **窗口最小化时提示音不可靠**：Windows 上窗口 `hide()` 到托盘后 webContents 存活，IPC 通信正常。但如果主进程完全崩溃，提示音和通知都不会触发——这是合理的降级（进程都没了）。
6. **状态机初始化失败**：`initAgentIslandService` 已有 `safeRun` 包裹，失败不影响主应用。Windows surface 同理用 `safeRun` 包裹。
7. **悬停窗 ready-to-show 延迟**：首次创建 BrowserWindow 需要加载渲染进程。预创建 + `show: false`，首次显示可能延迟 ~200ms。可接受。

## 未决问题

1. **悬停窗是否需要显示 Planning 信息**（待办/日程）？灵动岛有这个功能，但 Windows 悬停窗的交互场景不同（用户主动 hover vs 常驻可见）。建议 V1 不做，后续按反馈加。
2. **托盘图标状态色点在低分辨率（100% DPI）下的可辨识度**：16×16 图标上 6px 色点偏小。可能需要 A/B 测试后调整尺寸或改用整体色调变化。
3. **悬停窗出现时主窗口已在后台，用户点击会话卡片后的行为**：是直接聚焦主窗口 + 切换到对应会话，还是先聚焦再等用户操作？建议前者（直接定位）。
4. **是否需要悬停窗的键盘交互**（Tab 导航 / Enter 打开）：`focusable: false` 意味着窗口不接受键盘焦点。如果需要键盘操作，需要改为 `focusable: true` 但不 `focus()`。建议 V1 不做。
