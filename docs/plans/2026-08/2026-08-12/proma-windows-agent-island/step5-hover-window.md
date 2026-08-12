---
step: 5
title: 悬停弹窗
status: done
---

## 目标
实现鼠标悬停托盘时弹出无边框小窗口，展示会话列表 + 状态色点 + 点击跳转。这是整个方案中 UI 最复杂的部分。

## 依赖上下文（接力棒输入）
- 前置 step 产出：
  - [step2-surface-core.md] `WindowsAgentIslandSurface` 已有 `onHoverWindowUpdate?(snapshot)` 回调
  - [step4-notification-sound.md] IPC 通道 `WINDOWS_AGENT_ISLAND_IPC_CHANNELS.PUSH_SNAPSHOT` 和 `OPEN_SESSION` 已定义
- 窗口参考模板：`apps/electron/src/main/lib/voice-dictation-window.ts:149-188`
  - `frame:false` + `transparent:true` + `backgroundColor:'#00000000'` + `skipTaskbar:true` + `focusable:false` + `hasShadow:true`
  - 加载方式：`loadFile('renderer/index.html', { query: { window: 'agent-status-hover' } })`（生产）/ `loadURL('http://127.0.0.1:5173?window=agent-status-hover')`（开发）
- 渲染入口模式：proma SPA 所有窗口加载同一个 `index.html`，通过 query 参数 `?window=xxx` 区分
- snapshot 结构：`state.sessions[]` 每个含 `phase`/`detail`/`title`/`interactionKind`/`attention`

## 计划改动

### 1. `apps/electron/src/main/agent-status-hover-window.ts`（新增）

窗口管理器：
```typescript
class AgentStatusHoverWindow {
  private win: BrowserWindow | null = null
  private hideTimer: NodeJS.Timeout | null = null
  private showTimer: NodeJS.Timeout | null = null
  private latestSnapshot: NativeAgentIslandSnapshot | null = null

  // 预创建窗口（show:false），避免首次显示延迟
  ensureCreated(): void

  // tray mouse-enter 调用
  onTrayMouseEnter(bounds: Electron.Rectangle): void {
    // 清除 hide timer，设 show timer（300ms 延迟）
    // 计算窗口位置：bounds 上方居中
    // showInactive()
    // 推送 latestSnapshot
  }

  // tray mouse-leave 调用
  onTrayMouseLeave(): void {
    // 清除 show timer，设 hide timer（400ms 延迟）
  }

  // surface 调用（每次 snapshot 更新）
  updateSnapshot(snapshot: NativeAgentIslandSnapshot): void {
    // 缓存 + 如果窗口可见则 webContents.send(PUSH_SNAPSHOT, snapshot)
  }

  dispose(): void
}
```

窗口定位纯函数（可测试）：
```typescript
export function calculateHoverWindowBounds(
  trayBounds: Electron.Rectangle,
  windowSize: { width: number; height: number },
  display: Electron.Display
): Electron.Rectangle
// 贴在 trayBounds 正上方，水平居中，不出屏（clamp 到 display.workArea）
```

### 2. `apps/electron/src/main/tray.ts`
- [ ] 注册 `tray.on('mouse-enter', (_e, bounds) => hoverWindow.onTrayMouseEnter(bounds))`
- [ ] 注册 `tray.on('mouse-leave', () => hoverWindow.onTrayMouseLeave())`
- [ ] 兜底：5 秒超时自动隐藏（防止 mouse-leave 丢失）

### 3. `apps/electron/src/main/lib/windows-agent-island-surface.ts`
- [ ] `onHoverWindowUpdate` 回调实现：调 `hoverWindow.updateSnapshot(snapshot)`

### 4. `apps/electron/src/renderer/components/agent-status-hover/HoverPanel.tsx`（新增）

React 组件，监听 IPC 推送的 snapshot，渲染：
- 头部：pill 摘要（priorityStatus 图标 + "N 个会话"）
- 会话列表（最多 5 个，按优先级排序）：每行 = 色点 + phase 标签 + 标题 + detail
- 点击行 → `window.electronAPI.openAgentSession(sessionId)`
- 空状态：无活跃会话时显示"暂无活跃 Agent"
- 样式：深色背景 + 圆角 + 阴影（匹配 proma 暗色主题）

### 5. `apps/electron/src/renderer/main.tsx`（或 App 入口）
- [ ] 根据 `new URLSearchParams(window.location.search).get('window')` 判断
- [ ] `window === 'agent-status-hover'` → 渲染 `<HoverPanel />`，跳过主应用路由
- [ ] 参考 voice-dictation-indicator 的渲染分支模式

### 6. 测试：`apps/electron/src/main/agent-status-hover-window.test.ts`（新增）
- [ ] `calculateHoverWindowBounds`：托盘在屏幕底部居中 → 窗口在托盘正上方
- [ ] `calculateHoverWindowBounds`：托盘在右下角 → 窗口 clamp 不出屏
- [ ] `calculateHoverWindowBounds`：窗口高度超过可用空间 → clamp 到 workArea 高度上限
- [ ] `calculateHoverWindowBounds`：多显示器（display 有 offset）→ 坐标正确

## 实施回填（做完后填）

### 实际改动
- 与计划差异（2 处，均合理）：
  1. **`calculateHoverWindowBounds` 拆为独立文件** `agent-status-hover-bounds.ts`：原计划放在 hover-window.ts 内，但该文件 import electron 运行时值，bun:test 无法加载。拆出纯函数文件（仅 type-only import）使其可测试。
  2. **`mouse-enter` 事件参数是 `Point` 不是 `Rectangle`**：Electron API 实际行为，改用 `tray.getBounds()` 获取托盘矩形。
- 改动文件清单（proma 仓库 C:/proma，8 个文件）：
  1. `apps/electron/src/main/agent-status-hover-bounds.ts`（新增）— calculateHoverWindowBounds 纯函数
  2. `apps/electron/src/main/agent-status-hover-bounds.test.ts`（新增）— 5 个定位测试
  3. `apps/electron/src/main/agent-status-hover-window.ts`（新增）— AgentStatusHoverWindow 类 + 单例工厂（预创建/show 300ms/hide 400ms/autoHide 5s/dispose）
  4. `apps/electron/src/renderer/components/agent-status-hover/HoverPanel.tsx`（新增）— React 组件（pill 头 + 会话列表 + 点击跳转 + 空状态）
  5. `apps/electron/src/main/tray.ts` — TrayActions 新增 onTrayMouseEnter/onTrayMouseLeave；win32 守卫注册 mouse-enter/mouse-leave
  6. `apps/electron/src/main/index.ts` — win32 预创建 hover window、传 tray 回调、连接 onHoverWindowUpdate、before-quit dispose
  7. `apps/electron/src/renderer/main.tsx` — agent-status-hover 渲染分支（动态 import HoverPanel）
  8. `apps/electron/package.json` — 0.17.21 → 0.17.22

### 给下一步的接力棒
- **AgentStatusHoverWindow 生命周期**：`getAgentStatusHoverWindow()` 懒加载单例，`destroyAgentStatusHoverWindow()` 在 app before-quit 调用。
- **HoverPanel IPC 接口**：监听 `onWindowsAgentIslandPushSnapshot(setSnapshot)`，点击调 `openAgentIslandSession(sessionId, title)`。
- **三个回调已全部接入**：onTrayUpdate（step3）、onNotification（step4）、onHoverWindowUpdate（step5）。
- 下个 step 做设置项 + 端到端集成验证。
