---
step: 1
title: 主进程全局焦点状态中心
status: done
---

## 目标

主进程能记录「最近激活的会话」并在值变化时向所有窗口广播，提供 RPC 读写入口。

## 依赖上下文（接力棒输入）

- 设计文档：`docs/plans/2026-09/2026-09-04/2026-09-04-workbench-window-focus-sync-design.md`
- 广播工具已存在：`electron/main/services/renderer-broadcast.ts` 的 `broadcastToWindows((h) => h.xxx.send(payload))` 遍历所有存活窗口，窗口销毁竞态静默跳过
- 路由模板参考 `electron/main/tipc/windows.ts`：`const t = tipc.create()` + `t.procedure.action(async (input) => {...})`，channel 名即 router 对象的 key
- 事件类型集中定义在 `electron/main/tipc/renderer-handlers.ts` 的 `RendererHandlers`

## 计划改动

- [x] 新增 `electron/main/services/focused-conversation-service.ts`：
  - 模块级状态 `let focused: { conversationId: string; workspaceId: string } | null = null`
  - `setFocusedConversation(input: { conversationId: string; workspaceId: string }): void` — 与当前值相同（两字段都等）则 no-op，否则更新并 `broadcastToWindows((h) => h.focusedConversationChanged.send(input))`
  - `getFocusedConversation()` — 返回当前 focused
  - 广播 try/catch 包裹（对齐 renderer-broadcast 的容错风格）
- [x] `electron/main/tipc/renderer-handlers.ts`：`RendererHandlers` 新增
  `focusedConversationChanged: (data: { conversationId: string; workspaceId: string }) => void`
- [x] 新增 `electron/main/tipc/focus.ts`：`focusRouter`，两个 procedure
  - `'focus:setFocused'`：入参 zod 或手动校验后调 service 的 `setFocusedConversation`，返回 `{ success: true }`
  - `'focus:getFocused'`：返回 `getFocusedConversation()` 结果（可 null）
  - 入参校验风格对齐同目录其他路由（看一眼 `conversations.ts` 或 `group.ts` 用的是否 zod schema，保持一致）
- [x] `electron/main/tipc/index.ts`：import `focusRouter` 并 spread 进 `router` 对象（无需 registerXxx 桥接——广播在 service 内直接调，没有需要挂生命周期的 listener）

## 验证

- `bun run build:electron` 编译通过
- 渲染层任意处（临时）调 `client['focus:getFocused']()` 返回 null；调 `focus:setFocused` 两次同值只应触发一次广播（可临时在 setFocusedConversation 里加 console.log，验证后移除）

## 实施回填（做完后填）

### 实际改动
- 与计划差异：
  - 同值判定只比 `conversationId`（全局唯一决定 workspaceId，两字段比较等价）
  - channel 名即 router key `setFocusedConversation` / `getFocusedConversation`（tipc 机制，渲染层 `client.setFocusedConversation(...)` 直调，与设计文档一致；plan.md 里 `focus:setFocused` 为内部代号）
  - 入参风格对齐同目录：`.input<{...}>()` 泛型（项目 tipc 路由不用 zod）
  - 广播 try/catch 由 `broadcastToWindows` 内建（窗口销毁逐个 try/catch），service 层无需重复包裹
- 改动文件清单：`electron/main/services/focused-conversation-service.ts`（新）、`electron/main/tipc/focus.ts`（新）、`electron/main/tipc/renderer-handlers.ts`（事件类型插在 focusConversation 之后）、`electron/main/tipc/index.ts`（import + spread）

### 给下一步的接力棒
- 关键签名：`setFocusedConversation(input: { conversationId: string; workspaceId: string })` / `getFocusedConversation(): FocusedConversation | null`；渲染层 `client.setFocusedConversation({...})`、`client.getFocusedConversation()` 返回 `{ focused: FocusedConversation | null }`
- 下个 step 该从哪里继续：`stores/conversation-store.ts` 焦点联动 subscribe 与 `app/session-window/page.tsx` init() 接上报
- 待办或已知限制：编译验证通过；运行时同值 no-op 行为未加临时 log 逐条验证（静态审查 + 后续端到端覆盖）
