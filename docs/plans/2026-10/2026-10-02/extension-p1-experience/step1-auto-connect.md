---
step: 1
title: 自动连接 + 去页面绑定 + popup 改造
status: done
---

## 目标
扩展装好/浏览器启动即自动连接 Dogear，断线自动重试；「连接」不再绑定用户当前页面；popup 改为「把当前页交给 Dogear」手动焦点入口。

## 依赖上下文（接力棒输入）
- 设计依据：[../extension-p1-experience-design.md](../extension-p1-experience-design.md) 主题一第 1 节
- 当前关键文件状态：
  - `extension/src/background.js` 顶部为模块级初始化区（state、port 变量），`connect()` 在约 385 行：`getActiveTab()` → setStatus(tabId/title/url) → connectNative → hello 帧
  - `onHostDisconnect()`（约 442 行）：port=null 后仅 setStatus，无重连
  - popup：`extension/popup.html` 有 connect/disconnect/handoff 三按钮，`popup.js` render() 中 handoff 按钮仅 connected 可见
- 关键决策回顾：重连不做指数退避（固定 30s alarm）；断开按钮记录 manualDisconnected 否则「断开」无意义

## 计划改动
- [ ] 新建 `extension/src/connect-autoretry.js`：`ensureConnected()`（port 空且未手动断开 → connect()）、`scheduleRetry()`（chrome.alarms 30s，alarm 名 dogear-reconnect）、`markManualDisconnect(v)` / `isManualDisconnected()`（storage.local 持久化，浏览器重启即失效天然满足）
- [ ] `background.js`：connect() 删除 getActiveTab 逻辑，hello 帧 tabId 传 null；顶层调用 ensureConnected()（SW 每次冷启动重跑顶层即自动重连）；onHostDisconnect 里 scheduleRetry()；`dogear_connect`/`dogear_disconnect` 消息分支接 manualDisconnected 标记（disconnect 时置 true，connect 时清 false 并立即 connect）
- [ ] `chrome.alarms` 需在 manifest permissions 加 `alarms`
- [ ] `manifest.json` version 0.2.0 → 0.3.0
- [ ] `popup.html`/`popup.js`：connect 按钮文案改「把当前页交给 Dogear」，点击时若未连接先触发 connect 再把当前 tab 设为焦点（新 runtime 消息 `dogear_focus_current`）；disconnect 按钮行为不变；未连接时 handoff 按钮不再隐藏（自动连接下移交应随时可用，点击时未连接则提示「等待连接」）
- [ ] `background.js` 加 `dogear_focus_current` 消息分支：getActiveTab → setFocusedTab(tab)（setFocusedTab 逻辑复用 TAB_COMMAND_CTX 的实现，若在连接中需等待 welcome 后执行）

## 实施回填（做完后填）

### 实际改动
- 与计划差异：
  1. hello 帧 tabId 传 `-1`（NO_FOCUS_TAB_ID 哨兵）而非计划的 `null`：browser-gateway.ts:315 校验 `typeof message.tabId === 'number'`，null 会被忽略（不 takeOver、无 welcome），扩展会永远停在 connecting。传 -1 桌面端零改动，gateway 初始 fields 即 NO_FOCUS 空闲态
  2. manualDisconnected 用 `chrome.storage.session` 而非计划的 storage.local：session 存储「浏览器重启即清空」天然满足设计意图（重启后恢复自动连接）；storage.local 持久不清除，做不到
  3. connect() 的 connectNative 同步失败分支也调 scheduleRetry()（计划外补充）：否则 Dogear 未运行时重试链断裂，只能靠事件唤醒
  4. pushGroupTabSnapshots 加 `state.tabId == null` 早退：NO_FOCUS 态下组内残留 tab 快照会让 gateway 误抢焦点（applyTabSnapshot 在 NO_FOCUS 态宽松匹配首个快照），与扩展侧 null 焦点不一致 → 后续命令 stale_tab
  5. dogear_focus_current 在「已连接且焦点不同」时走完整重连：gateway 的 applyTabSnapshot 宽松匹配仅在 NO_FOCUS 态生效，已连接态下仅 setFocusedTab + 快照无法让 gateway 感知焦点切换；重连（takeOver 重置 fields）是唯一不新增帧类型的通道
- 改动文件清单：extension/src/connect-autoretry.js（新）、extension/src/background.js、extension/manifest.json、extension/popup.html、extension/popup.js

### 给下一步的接力棒
- 关键签名 / 数据结构：
  - `initAutoConnect({ connect, isPortAlive })`：顶层接线，注册 onAlarm + 立即 ensureConnected；`scheduleRetry()` 单次 30s alarm（名 dogear-reconnect）；`markManualDisconnect(v)`/`isManualDisconnected()` 走 storage.session；`waitForConnected(isConnected, timeoutMs=10000)` 200ms 轮询
  - connect() 幂等（先 disconnectPort），hello 帧 `tabId: NO_FOCUS_TAB_ID(-1)`，成功建连后扩展侧 state.tabId 为 null
  - `dogear_focus_current` 回包 `{ ok, error? }`；handleFocusCurrent 顺序：getActiveTab → 焦点相同早退 → 清手动断开标记 → connect → 等 welcome（10s 超时）→ TAB_COMMAND_CTX.setFocusedTab + sendTabSnapshot
  - popup connect 按钮现在发 `dogear_focus_current`（不再发 dogear_connect）；handoff 按钮始终可见，port 空时回「等待连接」
- 下个 step 该从哪里继续：step2（agent 独立窗口）改 tab-commands.js openTab 的 tabs.create 加 windowId + dogearWindowId 存取；焦点已由本 step 与用户页面解耦，agent 窗口内开 tab 后 setFocusedTab 链路不变
- 待办或已知限制：
  - 未连接时点击 handoff 只提示不触发连接（计划的「等待连接」文案，连接由 30s alarm 自动恢复）
  - 手动断开后 popup 状态区仍显示「未连接」，无「已手动断开」区分（计划未要求）
  - focus_current 重连会取消 agent 进行中的 pending 命令（takeOver rejectAllPending），用户主动夺控语义可接受
