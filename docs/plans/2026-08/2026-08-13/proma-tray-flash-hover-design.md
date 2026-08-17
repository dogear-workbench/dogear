# Proma Windows 托盘微信式提示 设计

**背景**：Windows Agent Island 通知系统（step1~step6）已完成，当前交互为：托盘图标按状态变色 + 系统 Notification 弹窗 + flashFrame + 悬停气泡。用户希望改成微信式交互——托盘不显示状态色点，改为需要介入时闪烁；状态只显示在悬停气泡里；去掉系统弹窗。

**目标**：
1. 托盘图标始终普通图标，不再按 phase 变色。
2. 出现「需要用户介入」状态时托盘图标闪烁；running 不闪烁。
3. 悬停气泡显示 running + 待介入会话；完全空闲（无任何会话）时不弹气泡。
4. 点气泡里某会话 → 打开对应会话并标记已读，闪烁随处理进度收敛。
5. 去掉系统 Notification 弹窗和 flashFrame；保留提示音，由 `notificationSoundEnabled` 控制。

**需要用户介入 = attention 为 true 的会话**，精确覆盖三类：
- needs-interaction（权限确认 / 等待回答 / 等待计划审批）
- completed（未读）
- error（未读）

## 架构

- 状态机 `agent-island-service.ts` 不变，继续产出 snapshot（`state.sessions[].attention` 是闪烁判断唯一依据）。
- `WindowsAgentIslandSurface` 新增 `onTrayFlash(flashing)` 回调；`onTrayUpdate(pill)` 保留（只用于 tooltip）。
- `tray.ts` 新增 `setTrayFlash(on)`；删除 `updateTrayIcon(phase)` 调用。
- 打开会话链路打通「标记已读」，让闪烁能在处理完后自动停止。

## 模块边界（proma 仓库 C:/proma）

1. `apps/electron/src/main/tray.ts` — 新增 `setTrayFlash`（普通图标 ↔ 空图标，500ms 交替）；`updateTrayTooltip` 保留；`updateTrayIcon` 停止使用。
2. `apps/electron/src/main/lib/windows-tray-icon.ts` — 删除 phase 色点 PNG base64（running/needs-interaction/error/completed），保留 idle 图标与 `generateTrayTooltip`。
3. `apps/electron/src/main/lib/windows-agent-island-surface.ts` — 新增 `onTrayFlash` 回调；`processNotification` 简化为仅发提示音；`SurfaceDeps` 去掉 `showNotification`/`flashFrame`，新增 `soundEnabled`。
4. `apps/electron/src/main/lib/windows-agent-island-surface.test.ts` — 同步更新测试。
5. `apps/electron/src/main/agent-status-hover-window.ts` — `show()` 前置判断无会话则不显示；`updateSnapshot()` 时若窗口可见且 sessions 清空则 `hide()`。
6. `apps/electron/src/renderer/components/agent-status-hover/HoverPanel.tsx` — 会话行内状态色点保留（气泡内需要区分状态）；基本不动。
7. `apps/electron/src/main/index.ts` — 接线调整：`onTrayUpdate` 只更新 tooltip；`onTrayFlash` 接 `setTrayFlash`；`onNotification` 接简化版 `processNotification`；删除 flashFrame 停止监听。
8. `apps/electron/src/main/ipc.ts` — `OPEN_SESSION` handler 里增加 `markAgentIslandSessionViewed(sessionId)`。
9. `apps/electron/src/main/lib/agent-island-service.ts` — 导出 `markAgentIslandSessionViewed`（当前为私有）。
10. `apps/electron/package.json` — patch 版本 +1。

## 数据流

```
Agent 事件 → agent-island-service 状态机 → snapshot
  → surface.onSnapshot
    → onTrayFlash(sessions 中存在 attention===true) → tray.setTrayFlash
    → onTrayUpdate(pill) → updateTrayTooltip(generateTrayTooltip(pill))
    → onHoverWindowUpdate(snapshot) → hoverWin.updateSnapshot

悬停托盘 → hover window.show()（仅当 sessions 非空）→ HoverPanel 渲染
  → 点击会话 → preload openAgentIslandSession
    → ipc OPEN_SESSION handler
      → markAgentIslandSessionViewed(sessionId)（completed/error 清 unread/attention）
      → 转发 TRAY_IPC_CHANNELS.OPEN_AGENT_SESSION + 聚焦主窗口
    → 状态机 pushState → 新 snapshot → onTrayFlash(更新) → 无 attention 则停闪
```

needs-interaction 的 attention 只在用户实际响应（权限确认 / 回答 / 计划审批）后由状态机清除；从气泡打开它不会误清。

## 错误处理 / 边界情况

- `markAgentIslandSessionViewed` 在状态机未初始化或 sessionId 不存在时幂等返回。
- 托盘闪烁 timer 在 `destroyTray()` 时清理，避免泄漏。
- `agentIsland.enabled === false` 时 `onTrayFlash(false)`，停闪。
- 气泡打开期间所有会话被处理清空 → `updateSnapshot` 主动 hide。
- completed/error 未读在 `UNREAD_RETAIN_MS`（10 分钟）超时后自动清除，闪烁随之停。
- 托盘左键 click 行为保持不变（win32 打开主窗口）；悬停弹窗是跳转会话的唯一入口。

## 提示音决策

- 系统 Notification 弹窗删除后，`notificationsEnabled` 在 Windows 上不再有作用（仅 macOS 桌面通知仍使用它）。
- 提示音保留，改由 `notificationSoundEnabled` 专门设置门控（用户确认沿用现有设置，不新增设置项）。
- 渲染进程 `onWindowsAgentIslandPlaySound` listener 保持现状；主进程发送前用 `soundEnabled()` 判断。

## 未决问题

- 无。
