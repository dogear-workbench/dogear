---
step: 2
title: 主会话事件通知与定位协议
status: pending
---

## 目标

将 Pi 主会话的完成和权限请求接入通知服务，同时通过 tipc 定义通知点击后主窗口定位对话的类型安全协议。

## 依赖上下文（接力棒输入）

- 前置 step 产出：`step1-notification-service.md` 将提供通知服务的窗口注册、通知发送和主窗口定位回调注入能力；实施时以其“给下一步的接力棒”记录的实际签名为准。
- 当前 Pi 广播集中在 `electron/main/tipc/agent.ts:37`。`complete`、`permissionRequest`、`sessionStateChanged` 等事件分支从 `:44` 开始，必须保留其向所有渲染窗口发送既有事件的行为。
- `PiSessionManager` 能通过 `getConversationIdBySession(sessionId)` 映射运行时会话（`electron/main/agents/pi-session/pi-session-manager.ts:154`）。
- `conversationService.getByIdGlobal(conversationId)` 可返回 `{ conv, workspaceId }`（`electron/main/services/conversation-service.ts:219`）；`conv.role` 是筛掉子会话的唯一持久化口径。
- `RendererHandlers` 是主进程到渲染层的唯一事件协议（`electron/main/tipc/renderer-handlers.ts:10`），渲染层由 `lib/events.ts:5` 生成类型化监听器。
- 关键决策：事件处理绝不能等待 Toast 点击，也不能使通知失败影响当前 renderer 广播、权限 Promise 或会话完成处理。

## 计划改动

- [ ] 在 `electron/main/tipc/renderer-handlers.ts` 增加 `focusConversation` 事件，载荷固定为 `{ conversationId, workspaceId }`；不携带完整对话或不可信窗口输入。
- [ ] 在 `electron/main/index.ts` 通过 Step 1 服务已注入的定位回调，使用 `getRendererHandlers<RendererHandlers>(mainWindow.webContents).focusConversation.send(...)` 向主窗口发送上述事件；主窗口销毁、webContents 不可用和发送失败均吞掉并记录，不影响点击处理。
- [ ] 在 `electron/main/tipc/agent.ts:37` 的既有 broadcaster 内，为 `complete` 和 `permissionRequest` 增加 fire-and-forget 通知分支：
  - 先用 `sessionId` 解析 `conversationId`，再用 `getByIdGlobal` 读取标题、工作区和 `role`；任一步找不到数据时跳过通知。
  - 仅当 `conv.role === 'main'` 时调用服务。
  - 每次完成结果都发送停止通知：`success` 为“AI 已完成回复”，`failed` 为“会话执行失败，请查看详情”，`cancelled` 为“会话已停止”；权限通知文案包含 `toolName`，如“等待你确认：<工具名>”。不要把底层错误原文放入 Toast，避免锁屏或通知中心泄露冗长内容。
  - 权限通知 ID 采用 `requestId`；停止通知在 broadcaster 收到每个 `complete` 事件时生成独立 ID（例如 sessionId 加递增序号），不能只用会话 ID，否则会错误抑制后续轮次的停止提醒。
  - 原有 `queryBasedSessionComplete`、`permissionRequest` 的 tipc 广播顺序和载荷保持兼容。
- [ ] 使用 `void`/受控 `catch` 启动异步元数据读取和通知，避免 unhandled rejection；用 `mainLogger` 或项目现有主进程日志风格记录非致命失败。

## 实施回填（做完后填）

### 实际改动

- 与计划差异：
- 改动文件清单：

### 给下一步的接力棒

- 关键签名 / 数据结构：
- 下个 step 该从哪里继续：
- 待办或已知限制：
