# Windows 会话原生通知实施计划

**目标**：当 Dogear 在后台时，为主会话的成功、失败或取消停止，以及等待工具授权发送带系统声音的 Windows 原生通知，并使任务栏闪烁；点击通知后定位到对应对话。

**架构思路**：主进程新增独立通知服务，集中管理 Electron `Notification`、窗口前台判定、任务栏闪烁及通知点击。Pi 会话事件仍经既有 `agent.ts` 广播链路，不改变运行态或权限状态；仅在该链路旁路触发通知服务。主进程通过已注册的窗口引用处理独立窗口恢复，主窗口内的跨工作区对话定位则走新增的 tipc renderer event。排除浏览器 Notification 和直连 ipc，以保持现有安全边界及类型安全 IPC 约定。

**涉及模块**：

- `electron/main/services/session-notification-service.ts`（新增）
- `electron/main/index.ts`
- `electron/main/tipc/agent.ts`
- `electron/main/tipc/renderer-handlers.ts`
- `app/page.tsx`
- `stores/workspace-store.ts`

## 步骤索引

- [ ] [Step 1: 原生通知与窗口生命周期](./step1-notification-service.md) — 创建主进程通知服务并接入主窗口、独立会话窗口的注册与闪烁生命周期。
- [ ] [Step 2: 主会话事件通知与定位协议](./step2-session-events.md) — 把完成/授权事件接入服务，并增加类型安全的主进程到主窗口定位事件。
- [ ] [Step 3: 渲染层跨工作区对话定位](./step3-renderer-navigation.md) — 消费定位事件，切换工作区并激活目标对话，完成构建与手工验收。

## 全局决策

- 仅 `role === 'main'` 的会话产生通知；子会话完成与交付不单独通知。
- 只在已注册的主窗口和独立会话窗口均未同时满足“可见、未最小化、已聚焦”时，才发原生通知和任务栏闪烁。
- 原生通知一律 `silent: false`，声音是否播放由 Windows 的通知、勿扰、静音设置决定；不得绕过系统偏好。
- 同一权限请求以 `requestId` 去重；每次 `complete` 事件按 `subtype` 发送对应停止通知并生成独立通知 ID，不能抑制后续用户发起的新一轮回复结束提醒。
- 通知点击优先恢复目标独立会话窗口；没有目标窗口时恢复主窗口，之后仅向主窗口发 `focusConversation` tipc 事件。
- 通知或目标对话不可用时必须安全降级：不影响既有消息、权限卡片、运行状态或会话继续执行。
- 不增加设置项或 JSON 持久化；第一版默认启用原生通知、系统声音与任务栏闪烁。
- 不使用 `ipcMain` / `ipcRenderer` 直连；主进程到渲染层事件只通过 `RendererHandlers` 和 `rendererEvents`。