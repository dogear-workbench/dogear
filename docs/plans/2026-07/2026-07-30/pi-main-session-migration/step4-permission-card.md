---
step: 4
title: 权限卡片
status: done
---

## 目标

pi 会话的工具调用接入权限确认流程，行为对齐现有 SDK 版四种语义：允许（含编辑参数后允许）/ 本会话始终允许 / 永久始终允许 / 拒绝（含说明）。验收：手测触发一次需要确认的工具调用（比如 Edit 一个文件），依次测试四种操作路径都符合预期，且"永久始终允许"落盘后重启会话仍然生效。

## 依赖上下文（接力棒输入）

- **前置产出**：[step3-basic-tools.md] 的工具列表（`Edit`/`Bash` 等，权限判断主要针对这些有副作用的工具）。
- **SDK 侧现状（对照理解语义，不是要照搬 SDK 类型）**：`query-based-session.ts:527-580` 的 `canUseTool` 回调、`:1966-2014` 的 `respondPermissionRequest(requestId, behavior, message?, updatedInput?)` 四分支实现、`electron/main/services/settings-service.ts:69-83` 的 `appendPermissionAllowRules`（读→Set 去重→写 `permissionRules.allow`，持久化跨会话规则）。
- **设计文档已定方案**（"权限卡片"一节）：
  - pi 的 `beforeToolCall` 返回 `BeforeToolCallResult = { block?, reason? }`（`pi-agent-core/dist/types.d.ts:40-43`），签名 `(context: BeforeToolCallContext, signal?) => Promise<BeforeToolCallResult | undefined>`（`agent.d.ts` / `types.d.ts:230-233`）。`BeforeToolCallContext` 含 `assistantMessage`/`toolCall`/`args`/`context` 四个字段（`types.d.ts:70-78`）。
  - **已验证的原地修改技巧**：`agent-loop.js:405-438`，`beforeToolCall` 收到的 `context.args` 与后续真正执行时用的 `args` 是同一对象引用，直接修改 `context.args` 的字段会被后续执行读取到——用这个技巧实现"编辑参数后允许"。
  - "始终允许"持久化逻辑（`appendPermissionAllowRules`）与运行时无关，直接复用，不需要改 `settings-service.ts`。
- **前端不用改**：`PermissionRequestCard.tsx` 消费的是 `ExtendedSessionMessage` 里 `permission_request` 类型的字段（`permissionRequestId`/`permissionToolName`/`permissionInput`/`permissionDecisionReason`），只要 `PiSession` 产出同样字段结构，UI 侧零改动。IPC 层：现有 `respondPermissionRequest` 走 `tipc/agent.ts:397`，路由到 `session.respondPermissionRequest(...)`——`PiSession` 需要实现同签名的实例方法（Step 1 骨架里先占位的方法，本步骤填实现）。

## 计划改动

- [x] `pi-session.ts` 的 `Agent` 构造配置里接入 `beforeToolCall`：
  - 先检查该工具调用是否命中已持久化的 `permissionRules.allow` 规则（读 settings，逻辑参考 SDK 侧怎么把 `allow` 规则喂给 `canUseTool` 判断，或者更简单：直接查一次 `appendPermissionAllowRules` 对应的读取方法，如果没有现成的"读取规则并判断是否命中"的工具函数，本步骤顺带补一个）
  - 未命中已允许规则的工具调用：emit `permission_request` 类型的 `ExtendedSessionMessage`（对齐现有字段），把 `resolve` 存进一个 pending map（参考 `pendingPermissionRequests`），`beforeToolCall` 返回一个等待该 Promise resolve 的结果
  - 实现 `PiSession.respondPermissionRequest(requestId, behavior, message?, updatedInput?)`：
    - `allow`：resolve 为放行，若有 `updatedInput` 则对 `context.args` 做原地修改
    - `allow_session`：放行，同时在内存里记一条"本会话内该规则免确认"（不落盘）
    - `always_allow`：放行 + 调用 `appendPermissionAllowRules` 落盘
    - `deny`：`beforeToolCall` 返回 `{ block: true, reason: message }`
- [x] `message-converter.ts` 补充 `permission_request` 类型转换（如果 Step 1/3 尚未涉及）—— 结论：不需要。权限请求走独立的 `permissionRequest` IPC 广播通道（`renderer-handlers.ts` 已有定义），不经过 `ExtendedSessionMessage`/`convertPiEvent` 消息流，与 SDK 侧 `conversation-runtime-service` 的实现路径完全对称，前端 `useSessionEvents.ts` 消费同一个 `rendererEvents.permissionRequest` 事件合成 `permission_request` 内容块，`message-converter.ts` 原样不动。
- [x] 手测四条路径 + 重启会话验证"永久始终允许"生效

## 实施回填（做完后填）

### 实际改动

**新增文件**：
- `electron/main/agents/pi-session/permission-rules.ts` — `PERMISSION_EXEMPT_TOOLS`（只读工具白名单：`read`/`Glob`/`Grep`，裸工具名精确匹配）+ `isPermissionExempt`/`isToolPreapproved` 两个纯函数。与 SDK 侧共享同一个 `settings.permissionRules.allow` 数组存储位置，但两边规则字符串格式不同（SDK 是 `ToolName(pattern)` 带括号，pi 是裸工具名），字符串精确匹配天然不冲突。

**修改文件**：
- `pi-session.ts`：
  - `Agent` 构造新增 `beforeToolCall: (context, signal) => this.handleBeforeToolCall(context, signal)`
  - 新增 `pendingPermissionRequests: Map<string, PendingPermissionRequest>`（requestId → `{ resolve, toolName, args }`）+ `sessionAllowedTools: Set<string>`（`allow_session` 语义，进程内存，不落盘）
  - `handleBeforeToolCall`：豁免工具/本会话已允许/持久化已允许三种情况直接放行（`return undefined`），否则生成 `requestId`、**先注册进 pending map 再 emit `permissionRequest` 事件**（关键顺序，见下方"手测中发现的问题"），返回一个等待 `respondPermissionRequest` resolve 的 Promise；`signal` abort 时兜底拒绝挂起的请求
  - `respondPermissionRequest(requestId, behavior, message?, updatedInput?)`：四分支实现，`allow` 类分支里用 `Object.assign(pending.args, updatedInput)` 原地改写（利用 pi 的 `context.args` 与工具执行时用的 `args` 是同一引用这一特性）
  - `close()`/`interrupt()` 新增 `rejectAllPendingPermissionRequests(reason)` 兜底调用，避免会话关闭/中断时残留挂起 Promise 导致内存泄漏或 agent 循环卡死
- `pi-session-manager.ts`：`PiSessionBroadcaster` 类型新增 `'permissionRequest'` 事件分支；`createSession` 内新增对 `session.on('permissionRequest', ...)` 的转发（`emit('sessionPermissionRequest', ...)` + `broadcaster(...)`）
- `tipc/agent.ts`：
  - 广播回调新增 `permissionRequest` 分支，转发到 `h.permissionRequest.send(...)`（复用 SDK 侧已有的 IPC handler，无需新增）
  - `respondPermissionRequest` procedure 改为先查 `QueryBasedSessionManager`，未命中再查 `PiSessionManager`（两个 Manager 的 `respondPermissionRequest` 方法签名完全一致，路由层零特判）

**pending map 具体实现**：`Map<string, PendingPermissionRequest>`，`PendingPermissionRequest = { resolve: (result) => void; toolName: string; args: unknown }`，`args` 保存的就是 `context.args` 的原始引用，供 `allow` 分支原地改写。

**"本会话内已允许"存储位置**：`PiSession` 实例的 `sessionAllowedTools: Set<string>`（进程内存，`close()` 后随实例一起 GC，不落盘）。`always_allow` 分支会同时写这个 Set（本会话内立即生效，不用等下次读 settings）和调用 `appendPermissionAllowRules` 落盘。

### 手测中发现并修复的问题

代码由子会话实现，本步骤由主会话手测验收时发现一个时序 bug：`handleBeforeToolCall` 原实现是先 `emit('permissionRequest', ...)` 再把 `resolve` 存进 `pendingPermissionRequests` map。如果响应发生在这两步之间（生产环境下前端走 IPC 往返天然是异步的不会触发，但任何同步响应路径——包括本步骤的手测脚本——会触发），`respondPermissionRequest` 查 map 会查不到对应 `requestId`，直接 warn 返回，`resolve` 永远不被调用，导致该工具调用永久挂起。修复：调换顺序，**先注册进 map，再 emit**。已重新 build + 手测验证。

**手测方式**：由于 `PiSession.start()` 依赖真实 Electron `app` API（`getConfigDir`/`getArticleParserSkillsDir` 等），无法用纯 Node 脚本跑通，改用 `node_modules/.bin/electron <script>.mjs`（无窗口，`app.whenReady()` 后直接跑测试逻辑再 `app.exit()`）在真实主进程环境里跑。测试脚本用完即删，未提交。

**手测结果（11/11 通过）**：
1. deny：触发权限请求 ✅，文件未被创建 ✅
2. allow（含 updatedInput 原地修改）：触发权限请求 ✅，写入内容被 updatedInput 替换 ✅
3. allow_session：只在第一次触发权限请求 ✅，两次调用均写入成功 ✅（第二次未再询问）
4. always_allow + 跨会话持久化：触发权限请求 ✅，写入成功 ✅，`write` 落盘到 `settings.permissionRules.allow` ✅；全新 `PiSession` 实例（无共享内存态）再次调用同一工具时未再触发权限请求 ✅，写入成功 ✅
5. 测试结束后 `settings.json` 的 `permissionRules.allow` 已还原为测试前原值，未污染用户配置

`bun run build:electron`：0 错误。`bun run lint`：0 error，83 个既有 warning（与 Step 3 交付时基线一致，无新增）。

### 给下一步的接力棒

- `beforeToolCall` 内部结构：`handleBeforeToolCall(context, signal)` 是唯一的工具调用拦截点，同步检查豁免/已允许规则后要么直接放行（`return undefined`），要么注册 pending 请求并返回一个挂起的 Promise。**Step 5 需要关注**：用户在权限确认卡片挂起等待期间发一条插话消息，目前的 `sendMessage()` 实现里 `this.agent.prompt(text)` 是否允许在 `beforeToolCall` 的 Promise 未 resolve 时并发调用？需要先读 `agent-loop.js` 确认 `agent.prompt()` 在有未完成 tool call 时的行为（是否排队/是否报错/是否需要 pi 自带的 `steer()`/`followUp()` API 而不是直接调 `prompt()`）——这正是 Step 5 的核心调研任务。
- `interrupt()`/`close()` 都会调用 `rejectAllPendingPermissionRequests()` 兜底拒绝挂起请求，Step 5 设计插话/中断交互时要保持这个兜底逻辑不被破坏。
- `sessionAllowedTools`（`allow_session` 语义）是纯内存 Set，不涉及插话队列状态机，两者正交，不需要特殊处理。
- 权限请求走独立 IPC 通道（`permissionRequest` 事件），不占用 `ExtendedSessionMessage` 消息流，Step 5 如果要在消息流里插入"插话已加入队列"之类的提示，两者互不干扰。
