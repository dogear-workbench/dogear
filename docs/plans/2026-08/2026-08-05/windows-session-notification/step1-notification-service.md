---
step: 1
title: 原生通知与窗口生命周期
status: done
---

## 目标

建立不依赖 Pi 会话或渲染层的主进程通知服务，使其能判断 Dogear 是否在后台、发送 Windows 原生 Toast、驱动任务栏闪烁，并在点击后恢复已注册的目标窗口。

## 依赖上下文（接力棒输入）

- 前置 step 产出：无。
- 当前窗口所有权在 `electron/main/index.ts`：`mainWindow` 位于 `:37`，`sessionWindows` 位于 `:58`，主窗口由 `createWindow()` 创建（`:65`），独立会话窗口由 `createSessionWindow()` 创建（`:240`）。
- 主窗口关闭到托盘时会 `hide()` 且关闭全部子窗口（`electron/main/index.ts:524`）；因此后台判定必须将隐藏窗口视为不可见。
- 当前会话窗口创建/关闭路径已在 `createSessionWindow()` 内统一维护 `sessionWindows`，不要在其它模块复制 Map。
- 关键决策：服务通过入口模块主动注册/注销窗口引用来处理窗口恢复；服务不得反向 import `index.ts`，避免入口、tipc 注册和服务间循环依赖。

## 计划改动

- [ ] 新增 `electron/main/services/session-notification-service.ts`：
  - 定义最小公开输入类型，至少含 `kind: 'complete' | 'permission'`、`notificationId`、`conversationId`、`workspaceId`、`title` 与授权工具名。
  - 提供主窗口、独立会话窗口的注册/注销方法；内部只保存存活窗口，关闭后不得保留已销毁引用。
  - 实现“前台不提醒”判定：仅注册的主窗口/独立会话窗口中存在 `isVisible() && !isMinimized() && isFocused()` 的窗口时跳过提醒。
  - 在 Electron `Notification.isSupported()` 时创建 `Notification`，使用对话标题、完成/授权文案和 `silent: false`；不可用或创建失败时记录主进程日志并安全返回。
  - 通知发出时，仅当主窗口非隐藏状态（`isVisible()`）时才 `flashFrame(true)`；主窗口隐藏到托盘时不做任务栏闪烁（隐藏窗口 flash 在 Windows 上不可靠），仅靠 Toast 通知。所有已注册窗口 `focus` 时停止主窗口闪烁，窗口注销时也清理闪烁状态。
  - 为同一 `notificationId` 做内存去重，设置有界清理，避免长时间运行无限增长；不对不同轮次的完成事件做时间窗口合并。
  - Toast click 时优先恢复、显示、聚焦该 `conversationId` 的独立窗口；否则恢复、显示、聚焦主窗口，并调用注入的主窗口定位回调。目标窗口已销毁、主窗口未注册或回调失败时只安全降级。
- [ ] 修改 `electron/main/index.ts:65`：主窗口创建后向服务注册；在主窗口 `focus`、销毁和真正退出相关路径中调用对应清理/停止闪烁方法。
- [ ] 在 `before-quit` 中调用通知服务的 dispose（注销所有 Notification 监听、停止 flashFrame），避免退出过程中残留闪烁。
- [ ] 修改 `electron/main/index.ts:240`：独立会话窗口创建后以 `conversationId` 注册；在 `closed` 回调中注销后再执行既有 runtime detach 和主窗口 Tab 恢复逻辑。
- [ ] 保持现有托盘行为、`sessionWindows` 的唯一所有权和窗口创建 API 不变。

## 实施回填（做完后填）

### 实际改动

- 新增 `electron/main/services/session-notification-service.ts`：单例通知服务，含窗口注册/注销、前台判定、Notification 创建（`silent:false`）、隐藏窗口不 flash、去重（FIFO 上限 500）、点击恢复（优先独立窗口→降级主窗口+定位回调）、dispose
- 修改 `electron/main/index.ts`：4 处接入——导入(行15)、主窗口注册(行94)、独立会话窗口注册(行270)、before-quit dispose(行578)
- 与计划差异：无

### 给下一步的接力棒

- 关键签名：`SessionNotificationInput { kind, notificationId, conversationId, workspaceId, title, toolName?, body? }`
- `getSessionNotificationService().setLocateCallback(cb)` 已就绪，Step 2 在 index.ts whenReady 中接线
- `notify(input)` 是核心入口，Step 2 在 agent.ts broadcaster 中调用
- 下个 step 从 agent.ts broadcaster 接入 complete/permissionRequest 事件 + renderer-handlers.ts 新增 focusConversation 事件
