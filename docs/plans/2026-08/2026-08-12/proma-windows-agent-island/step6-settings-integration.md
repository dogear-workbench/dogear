---
step: 6
title: 设置项 + 端到端集成
status: done
---

## 目标
Windows 上在 GeneralSettings 显示"Agent 状态通知"开关，复用 `agentIsland.enabled` 设置项。完成全链路端到端验证。

## 依赖上下文（接力棒输入）
- 前置 step 产出：
  - [step1-gate-split.md] 状态机在 Windows 初始化
  - [step2-surface-core.md] WindowsAgentIslandSurface 接收 snapshot
  - [step3-tray-icon.md] 托盘图标 + tooltip
  - [step4-notification-sound.md] 通知 + flashFrame + 提示音
  - [step5-hover-window.md] 悬停弹窗
- 现有设置 UI：`apps/electron/src/renderer/components/settings/GeneralSettings.tsx:400-408`，`{isMac && (...)}` 包裹的灵动岛开关
- 现有设置类型：`apps/electron/src/types/settings.ts:258-261`，`AgentIslandSettings { enabled?: boolean }`
- 设置生效链路：用户切换 Toggle → `updateSettings({ agentIsland: { enabled } })` → `ipc.ts:1761` → `refreshAgentIslandConfiguration()` → `agent-island-service.ts:872` 重置 lastStateJson + pushState()

## 计划改动

### 1. `apps/electron/src/renderer/components/settings/GeneralSettings.tsx`
- [ ] 灵动岛开关的 `{isMac && (...)}` 改为 `{(isMac || isWindows) && (...)}`
- [ ] Windows 上文案：
  - label: `"Agent 状态通知"`
  - description: `"在任务栏托盘显示 Agent 运行状态，悬停查看会话详情"`
- [ ] macOS 文案不变（"Agent 灵动岛"）

### 2. `apps/electron/src/main/lib/windows-agent-island-surface.ts`
- [ ] enabled 检查：`onSnapshot` 开头检查 `getSettings().agentIsland?.enabled !== false`，关闭时清空托盘图标 + 隐藏悬停窗

### 3. `apps/electron/src/main/lib/agent-island-service.ts`
- [ ] `refreshAgentIslandConfiguration()` 确认 Windows 上也能触发（不只是 macOS）
- [ ] enabled 回调最终确认：Windows 上 `enabled: () => getSettings().agentIsland?.enabled !== false`（不依赖 macOS native host）

### 4. 版本号
- [ ] `apps/electron/package.json` 的 `version` patch +1

### 5. 端到端验证清单（手动）
- [ ] Agent 运行中 → 托盘图标出现蓝色色点
- [ ] Agent 请求权限 → 托盘图标变橙 + 系统通知弹出 + 任务栏闪烁 + 提示音
- [ ] Agent 完成 → 托盘图标变绿 + 系统通知弹出 + 提示音
- [ ] Agent 出错 → 托盘图标变红 + 系统通知弹出 + 提示音
- [ ] 鼠标悬停托盘 → 弹窗显示会话列表
- [ ] 点击弹窗中的会话 → 主窗口聚焦 + 切换到该会话
- [ ] 鼠标移开托盘 → 弹窗消失
- [ ] 设置关闭"Agent 状态通知" → 托盘图标恢复默认 + 无通知 + 无弹窗
- [ ] 设置关闭后再开启 → 恢复正常
- [ ] 多会话并行：不同状态的会话都正确展示
- [ ] 主窗口前台时：不弹通知（提示音照播）
- [ ] 窗口最小化到托盘：通知正常弹出

### 6. typecheck
- [ ] `bun run typecheck` 通过

## 实施回填（做完后填）

### 实际改动
- 与计划差异：无重大差异。改动点 3（agent-island-service.ts）确认不需要改——step1 已完整实现 enabled 回调 + pushState 门禁 + refreshAgentIslandConfiguration 链路。
- 改动文件清单（proma 仓库 C:/proma，3 个文件）：
  1. `apps/electron/src/renderer/components/settings/GeneralSettings.tsx` — 导入 detectIsWindows，`{isMac || isWindows}` 守卫 + Windows 文案差异化
  2. `apps/electron/src/main/lib/windows-agent-island-surface.ts` — onSnapshot 开头 enabled 门禁（idle pill 清空 + prevPhases 清空防虚假 transition）
  3. `apps/electron/package.json` — 0.17.22 → 0.17.23

### 端到端验证清单（需用户在 Windows 环境手动验证）
- [ ] Agent 运行中 → 托盘图标出现蓝色色点
- [ ] Agent 请求权限 → 托盘图标变橙 + 系统通知弹出 + 任务栏闪烁 + 提示音
- [ ] Agent 完成 → 托盘图标变绿 + 系统通知弹出 + 提示音
- [ ] Agent 出错 → 托盘图标变红 + 系统通知弹出 + 提示音
- [ ] 鼠标悬停托盘 → 弹窗显示会话列表
- [ ] 点击弹窗中的会话 → 主窗口聚焦 + 切换到该会话
- [ ] 鼠标移开托盘 → 弹窗消失
- [ ] 设置关闭 → 托盘图标恢复默认 + 无通知 + 无弹窗
- [ ] 设置关闭后再开启 → 恢复正常
- [ ] 多会话并行：不同状态的会话都正确展示
- [ ] 主窗口前台时：不弹通知（提示音照播）
- [ ] 窗口最小化到托盘：通知正常弹出

### 完成总结

**全部改动文件汇总（step1-6）：**

主进程新增文件：
- `apps/electron/src/main/lib/windows-agent-island-surface.ts` — Surface 核心协调器（phase 边沿检测 + 通知逻辑 + enabled 门禁）
- `apps/electron/src/main/lib/windows-tray-icon.ts` — SVG 托盘图标 + tooltip 纯函数
- `apps/electron/src/main/lib/macos-version.test.ts` — 门禁函数测试
- `apps/electron/src/main/lib/windows-tray-icon.test.ts` — 图标生成测试
- `apps/electron/src/main/agent-status-hover-bounds.ts` — 窗口定位纯函数
- `apps/electron/src/main/agent-status-hover-bounds.test.ts` — 定位测试
- `apps/electron/src/main/agent-status-hover-window.ts` — 悬停窗管理器

渲染进程新增文件：
- `apps/electron/src/renderer/components/agent-status-hover/HoverPanel.tsx` — 悬停窗 React 组件

修改文件：
- `apps/electron/src/main/lib/macos-version.ts` — 门禁拆分（状态机 / Surface）
- `apps/electron/src/main/lib/agent-island-service.ts` — pushState 平台分发 + Windows surface 接入
- `apps/electron/src/main/tray.ts` — updateTrayIcon/updateTrayTooltip + mouse-enter/leave
- `apps/electron/src/main/index.ts` — win32 连接块（onTrayUpdate/onNotification/onHoverWindowUpdate + SurfaceDeps + flashFrame）
- `apps/electron/src/main/ipc.ts` — OPEN_SESSION handler
- `apps/electron/src/preload/index.ts` — 3 个 bridge API
- `apps/electron/src/types/settings.ts` — WINDOWS_AGENT_ISLAND_IPC_CHANNELS
- `apps/electron/src/renderer/atoms/notifications.ts` — Windows 跳过 Web Notification
- `apps/electron/src/renderer/hooks/useGlobalAgentListeners.ts` — 提示音 IPC listener
- `apps/electron/src/renderer/main.tsx` — agent-status-hover 渲染分支
- `apps/electron/src/renderer/components/settings/GeneralSettings.tsx` — Windows 设置开关
- `apps/electron/package.json` — 0.17.17 → 0.17.23（6 次 patch 递增）

**与原设计的偏差：**
- Surface 直接 import getSettings()（非依赖注入），轻微破坏纯度但简化实现
- calculateHoverWindowBounds 拆为独立文件（可测试性）
- mouse-enter 用 tray.getBounds() 替代事件参数

**已知限制：**
- 端到端验证需 Windows 环境 + AI 渠道配置（未自动化）
- Linux 平台不支持（门禁返回 false）
- 悬停窗加载同一个 index.html（SPA 模式），首次加载有 Vite 依赖开销

**后续优化方向：**
- 悬停窗可加 framer-motion 动画（出现/消失过渡）
- 托盘右键菜单可集成 Agent 状态快捷操作
- 通知可加分组聚合（多会话同时完成时合并通知）
