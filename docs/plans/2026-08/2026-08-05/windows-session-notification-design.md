# Windows 会话原生通知设计

**背景**：Dogear 的会话完成和工具授权请求目前只通过渲染层状态、卡片与 Sonner toast 呈现。主窗口最小化、隐藏至托盘或失焦后，用户无法及时感知需要处理的会话。

**目标**：在 Windows 上，当 Dogear 不处于前台时，为主会话的“本轮回复完成”和“等待工具授权”发送带系统声音的原生 Toast 通知，并使任务栏图标闪烁。用户点击通知后，Dogear 恢复并定位到对应对话。子会话完成不单独通知。

## 架构

新增主进程的会话通知协调服务，封装 Electron `Notification`、窗口前台判定、任务栏闪烁、通知点击后的窗口恢复及对话定位。服务只接受已归一化的 `{ kind, conversationId, sessionId, title, toolName? }` 事件，不了解 PiSession 和渲染层实现。

通知服务订阅/接收现有 PiSessionManager 广播链路中的两个事件：

- `complete`：通过 `sessionId` 查询 `conversationId`，对每个停止的主会话发送结果通知：成功为“AI 已完成回复”、失败为“会话执行失败，请查看详情”、取消为“会话已停止”。
- `permissionRequest`：由 PiSession 的权限拦截点发出，发送“等待你确认：<工具名>”。

主会话限定依据为会话运行时绑定的 `conversationId`，不对 delegation bridge 中的子会话交付事件单独发送通知。父会话结束时仍按普通 `complete` 规则通知。

通知服务在创建通知前检查所有可见应用窗口：只要存在一个未最小化且 `isFocused()` 的 Dogear 主窗口或独立会话窗口，即跳过原生通知和任务栏闪烁。应用处于最小化、隐藏至托盘或失焦时才提醒，避免用户正在查看会话时收到重复系统提示。

使用 Electron `Notification` 创建 Windows 原生 Toast；`silent: false` 交由 Windows 根据用户的声音、勿扰和应用通知偏好决定是否播放声音。每次实际发出 Toast 时，对主窗口调用 `flashFrame(true)`；主窗口重新获得焦点时调用 `flashFrame(false)` 停止闪烁。

不使用浏览器 `Notification`，也不在渲染层直接调用 Electron API；通知、窗口控制全部在主进程完成。

## 模块边界

- `electron/main/services/session-notification-service.ts`：新增。维护通知去重状态；判断是否应提示；发送 Toast 与任务栏闪烁；处理通知 click；根据 `conversationId` 恢复/聚焦目标窗口。
- `electron/main/agents/pi-session/pi-session-manager.ts`：继续产生 `complete`、`permissionRequest`，不增加 UI 或 Windows 逻辑。
- `electron/main/tipc/agent.ts`：在现有 PiSessionManager 广播回调中，将两个事件连同会话映射和对话标题交给通知服务；保留当前 tipc 广播，通知不替代界面状态更新。
- `electron/main/index.ts`：在创建、关闭主窗口和独立会话窗口时向通知服务注册/注销受控窗口引用；窗口 focus 时通知服务停止闪烁。通知服务不反向导入入口模块，避免循环依赖。
- `electron/main/tipc/renderer-handlers.ts`：新增 main → renderer 的 `focusConversation` 事件，载荷为 `conversationId` 和 `workspaceId`。
- `app/page.tsx` 或专门的顶层事件 hook：消费 `focusConversation`，切换目标工作区、加载该工作区对话、选中目标会话并激活标签。

## 数据流

1. PiSession 完成或需要权限，PiSessionManager 触发既有 `complete` / `permissionRequest` 广播。
2. `agent.ts` 保持向所有渲染器发送既有状态事件，并从 `PiSessionManager` 查到 `conversationId`；通过 conversation service 获得会话标题和所属 `workspaceId`。
3. 通知协调服务判断应用是否在后台。前台时结束；后台时创建对应 Windows Toast，并开始主窗口任务栏闪烁。
4. 用户点击 Toast：通知服务从已注册窗口中查找该 `conversationId` 的存活独立会话窗口，存在则恢复、显示、聚焦它；否则恢复、显示、聚焦已注册主窗口，并仅向主窗口发送 `focusConversation` tipc 事件。
5. 主窗口渲染层根据事件先切换到目标工作区，再获取/定位对话并调用既有 `selectConversation` 与 `openTab`。如果对话已删除或所属工作区不可用，保留已恢复的主窗口且静默忽略定位请求。
6. 主窗口获得焦点时停止 `flashFrame`；独立窗口被聚焦时也停止闪烁。

## 去重与边界情况

- 停止通知以每次 `complete` 事件为准，按结果类型显示文案且不合并后续轮次；权限通知以 `requestId` 为键，防止重复事件产生多条 Toast。
- 授权通知不在用户已在同一会话界面操作时发送；原有权限卡片与 `pendingAction` 状态不变。
- 系统关闭通知、开启勿扰或静音时，应用不尝试绕过系统策略；点击与闪烁仍以 Electron/Windows 可用性为准。
- 通知服务必须在 Electron `Notification.isSupported()` 为 false 时安全降级，只保留前端原有状态更新与可选任务栏闪烁。
- 多窗口广播仍沿用 tipc，不新增 `ipcMain` / `ipcRenderer` 直连通信。
- 不新增用户设置项。第一版按已确认的默认策略启用：原生通知、系统声音、任务栏闪烁。后续若有关闭需求，再将开关加入 `AppSettings`。

## 验收标准

- 主窗口最小化或失焦时，主会话以成功、失败或取消任一结果停止都会出现带声音的 Windows 通知，任务栏图标闪烁。
- 主会话请求工具授权时，出现带工具名的 Windows 通知，点击后可看到对应授权卡片。
- 点击两类通知都能恢复并定位到准确对话；独立会话窗口优先被恢复。
- 用户正在聚焦任意 Dogear 窗口时，不产生重复的原生通知和闪烁。
- 子会话的独立交付与完成不会产生额外 Windows 通知。
- Windows 勿扰或通知关闭时不报错、不影响会话继续与前端卡片状态。

**未决问题**：无。