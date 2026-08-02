---
step: 2
title: 全自动权限模式
status: done
---

## 目标

让 PiSession 支持与现有 SDK 调用兼容的全自动工具放行模式：`dontAsk` 启用自动放行，`default` 恢复逐工具确认。

## 依赖上下文（接力棒输入）

- 前置 step 产出：Step 1 只改事件转换，不影响 PiSession 权限控制。
- 当前关键文件状态：`electron/main/agents/pi-session/pi-session.ts` 以 `Agent.beforeToolCall` 调用 `handleBeforeToolCall()`；该方法先放行豁免工具、会话允许工具与持久化允许规则，其余通过 `permissionRequest` 等待前端响应。`setPermissionMode()` 目前为 no-op。
- 调用兼容性：`electron/main/tipc/agent.ts` 的 `setPermissionMode` 入参是 SDK `PermissionMode`；`conversation-runtime-service.ts` 会为微信 bot 与子会话传入 `dontAsk`。
- 关键决策回顾：不修改 IPC 或设置格式。PiSession 只将 `dontAsk` 解释为自动放行，`default` 为正常确认；其余 mode 采用正常确认，避免 SDK 特有 mode 在 pi 中意外扩大权限。

## 计划改动

- [ ] `electron/main/agents/pi-session/pi-session.ts`：从 SDK 导入 `PermissionMode` 类型，并新增会话内当前权限模式字段，默认值为 `default`。
- [ ] `electron/main/agents/pi-session/pi-session.ts`：将 `setPermissionMode(mode)` 改为真实实现，更新当前模式、记录日志并 emit 既有 `permissionModeChanged` 事件；不依赖底层 pi Agent 的权限模式能力。
- [ ] `electron/main/agents/pi-session/pi-session.ts`：在 `handleBeforeToolCall()` 的最前方判断当前模式；仅当模式为 `dontAsk` 时直接放行，其他模式保持现有豁免、规则与确认顺序。
- [ ] `electron/main/agents/pi-session/pi-session.ts`：实现与 `QueryBasedSession` 对齐的 `getPermissionMode()`，供 runtime 在 attach 返回当前状态时读取。
- [ ] 核对 PiSessionManager、conversation runtime 与 tipc 路由的结构类型，确认 PiSession 实例在运行时已具备 `getPermissionMode()`，无需为兼容性增加类型断言或旁路。
- [ ] 执行类型检查或 lint；必要时为权限模式映射添加覆盖 `dontAsk` / `default` 的最小测试，遵循项目现有测试组织方式。

## 验收标准

- 外部调用 `session.setPermissionMode('dontAsk')` 后，所有 Pi 工具调用均不触发 `permissionRequest`，直接执行。
- 外部调用 `session.setPermissionMode('default')` 后，非豁免、非会话允许、非持久化允许工具仍走原有确认流程。
- 切换模式时会发出 `permissionModeChanged`，且 runtime attach 返回值可读取当前模式。
- `allow_session`、`always_allow`、`deny`、中断与关闭时的既有权限请求清理语义不变。

## 实施回填（做完后填）

### 实际改动

- 与计划差异：无。
- 改动文件清单：`electron/main/agents/pi-session/pi-session.ts`、本文件。
- 新增 `currentPermissionMode`，默认 `default`；`setPermissionMode(mode)` 更新状态、记录日志并 emit `permissionModeChanged`。
- 新增 `getPermissionMode()`，与 conversation runtime attach 返回值兼容。
- `handleBeforeToolCall()` 在最前方仅对 `dontAsk` 自动放行；其他 SDK 权限模式继续走既有豁免、会话规则、持久化规则与前端确认链路。
- 已执行 `bun run lint`（仅项目既有 83 条 warning，无 error）与 `bun run build:electron`（通过）。

### 给下一步的接力棒

- 关键签名 / 数据结构：`setPermissionMode(mode: PermissionMode)` 与 `getPermissionMode(): PermissionMode` 已由 PiSession 提供。
- 下个 step 该从哪里继续：在 `usage-extractor.ts` 提取单条 assistant message 的上下文快照，并在 PiSession 的 `message_end` 发出 `usageContext`。
- 待办或已知限制：无。
