---
step: 1
title: 自动连接 + 去页面绑定 + popup 改造
status: pending
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
- 改动文件清单：

### 给下一步的接力棒
- 关键签名 / 数据结构：
- 下个 step 该从哪里继续：
- 待办或已知限制：
