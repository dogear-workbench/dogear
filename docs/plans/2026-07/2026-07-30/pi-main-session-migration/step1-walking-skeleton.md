---
step: 1
title: apiFormat 路由 + PiSession 最小骨架
status: done
---

## 目标

跑通最短链路：给某个 `ModelProfile` 设置 `apiFormat: 'pi'`，新建/打开一个绑定该 Profile 的对话，发一句话，pi 模型的文字回复能以 `ExtendedSessionMessage`（`type: 'text'`）形式经现有 IPC 事件出现在前端聊天界面。不涉及工具调用、权限、插话、skill——纯文本单轮往返打通即可。

## 依赖上下文（接力棒输入）

- **现有 `ModelProfile` 定义**：`types/settings.ts:17-31` 和 `electron/main/services/settings-types.ts:26-38`，两处内容一致，字段：`id/name/apiKey/baseUrl/haikuModel/sonnetModel/opusModel/apiTimeoutMs/disableNonessentialTraffic/autoCompactWindow?`。新增 `apiFormat?: 'anthropic-sdk' | 'pi'`，缺省视为 `'anthropic-sdk'`（不写默认值到已有 profile 数据，靠代码里 `?? 'anthropic-sdk'` 兜底，避免动 `DEFAULT_SETTINGS` 之外的存量数据迁移）。
- **设置页表单**：`app/settings/page.tsx`，Profile 编辑区在 `:570-690` 附近，写回统一走 `updateProfileField(id, updates: Partial<ModelProfile>)`（`:189`）。haiku/sonnet/opus 三个模型字段用小型配置数组渲染（`:620-633`）可参考，新增 `apiFormat` 用 `<select>` 手写一段即可，不需要抽数组。
- **阶段一产出，直接复用**：
  - `electron/main/agents/pi/provider.ts` 导出 `resolvePiModel(appSettings, selection, subAgentFallback, fallback): { model, profile, tier }` 和 `buildPiModels(profile)`。
  - `electron/main/agents/pi/tool-adapter.ts` 导出 `ToolDef`/`defineTool`/`toSdkServer`/`toPiTools`。本步骤暂用不到工具，先记录位置。
- **现有 SDK 会话类接口面**（新 `PiSession`/`PiSessionManager` 要对齐的方法签名，来自 `query-based-session.ts`）：
  - 实例方法：`getSessionId()` `getSdkSessionId()` `start()` `getSupportedCommands()` `sendMessage(content)` `isIdle()` `close()` `interrupt()` `setPermissionMode(mode)` `respondPermissionRequest(...)` `respondAskUserQuestion(...)` `setModel(selection)` `setCachePolicy(policy)` `isSessionActive()`
  - Manager 方法：`createSession/getSession/closeSession/closeAll/retain/release/bindConversation/unbindConversation/getSessionIdByConversation/getConversationIdBySession`，事件转发（`session.on('message'/'error'/'complete'/'usage'/...)`）
  - 本步骤只需实现骨架版本：`start()`、`sendMessage()`、`close()`、`getSessionId()`，其余方法可先返回安全默认值（如 `isIdle()` 恒返回 true）或 no-op，后续 step 补全，**但方法必须存在，签名必须一致**，否则 `agent.ts` 路由层无法无缝调用。
- **调用方接口面**：`electron/main/tipc/agent.ts` 通过 `getQueryBasedSessionManager()`（模块级单例）调用 `sessionManager.getSession(sessionId)`、`.release()`、`.closeSession()`、`session.sendMessage(content)` 等（具体行号见 `agent.ts:242,300-457` 各处）。真正创建走 `conversation-runtime-service.ts` 的 `attachConversation(...)`。**本步骤要在这一层加路由判断**：读会话所属 conversation 的 Profile，若 `apiFormat === 'pi'` 则调用新 `PiSessionManager`，否则走原 `QueryBasedSessionManager`。
- **目标输出契约**：`ExtendedSessionMessage`（`electron/main/agents/task-types.ts:110-180`），本步骤只需产出 `type: 'text'` 分支，字段至少含 `content`（字符串）、`timestamp`（必填）。
- **广播机制**：`emit('message', extendedMessage)` → `tipc/agent.ts` 的 broadcaster → `getRendererHandlers().queryBasedSessionMessage.send({ sessionId, message })`。新 `PiSession` 复用同一个 IPC 事件名（`queryBasedSessionMessage`），前端不用区分来源。

## 计划改动

- [ ] `types/settings.ts`：`ModelProfile` 加 `apiFormat?: 'anthropic-sdk' | 'pi'`
- [ ] `electron/main/services/settings-types.ts`：同步加字段
- [ ] `app/settings/page.tsx`：Profile 表单加 `apiFormat` 下拉选项（选项：`anthropic-sdk`（默认）/ `pi`）
- [ ] 新建 `electron/main/agents/pi-session/pi-session.ts`：`PiSession` 类，构造函数签名参考 `QueryBasedSession`（`sessionId: string, config: ...`），内部持有 pi 的 `Agent` 实例（`new Agent({...})`，`streamFn` 用 `buildPiModels`/`resolvePiModel` 解析出的 model）
- [ ] 新建 `electron/main/agents/pi-session/pi-session-manager.ts`：`PiSessionManager extends EventEmitter`，方法面对齐 `QueryBasedSessionManager`（本步骤先实现 `createSession/getSession/closeSession/retain/release/bindConversation/getConversationIdBySession`，事件转发先只转发 `message`）
- [ ] 新建 `electron/main/agents/pi-session/message-converter.ts`：`convertPiEvent(event) → ExtendedSessionMessage | null`，本步骤只处理文本增量/完成事件，映射到 `type: 'text'`
- [ ] 改 `electron/main/tipc/agent.ts` 或 `electron/main/services/conversation-runtime-service.ts`（视代码结构，执行时确定改哪一层更薄）：加 `apiFormat` 路由判断，创建会话时查 conversation 绑定的 ModelProfile 决定用哪个 Manager
- [ ] 手测：设置页新建/编辑一个 Profile 选 `apiFormat: pi`，用该 Profile 开一个新对话，发消息，确认前端收到文字回复

## 实施回填（做完后填）

### 实际改动

- `types/settings.ts` / `electron/main/services/settings-types.ts`：`ModelProfile` 加 `apiFormat?: 'anthropic-sdk' | 'pi'`（缺省按 `?? 'anthropic-sdk'` 兜底，未动 `DEFAULT_SETTINGS`）。
- `app/settings/page.tsx`：Profile 表单里 Base URL 之后插入 `apiFormat` 原生 `<select>`，写回走已有 `updateProfileField`。
- 新建 `electron/main/agents/pi-session/pi-session.ts`：`PiSession extends EventEmitter`，构造函数 `(sessionId: string, config: { conversationId, modelSelection, systemPrompt? })`；`start()` 用 `resolvePiModel`+`buildPiModels` 建 `Agent` 实例（`private agent: Agent | null`）；`start/sendMessage/close/getSessionId/interrupt` 真实实现，权限/插话相关方法 no-op。
- 新建 `electron/main/agents/pi-session/pi-session-manager.ts`：`PiSessionManager extends EventEmitter`，方法面对齐 `QueryBasedSessionManager`；`release()` 归零直接销毁，无跑步机语义（阶段一无工具无副作用风险）。
- 新建 `electron/main/agents/pi-session/message-converter.ts`：`convertPiEvent(event)` 目前只处理 `message_update` + `text_delta` → `type:'text'`。
- `electron/main/services/conversation-runtime-service.ts`：`AttachmentMeta` 加 `apiFormat` 字段；新增 `resolveApiFormat()` 按 conversation.modelSelection（缺省回退 `settings.ai.defaultModelSelection`）查 profile 的 apiFormat；`attachConversation()` 入口路由到新增私有方法 `attachPiConversation()`（SDK 路径原逻辑未改动，只是外面包了判断）；detach/getRuntimeByConversation 同步按 apiFormat 查对应 manager。
- `electron/main/tipc/agent.ts`：模块加载时注册 `getPiSessionManager().setBroadcaster(...)`（与 SDK 广播对称）；`sendQueryBasedSessionMessage`/`closeQueryBasedSession`/`setSessionModel` 三个 handler 加了"先查 SDK manager 再查 PiSessionManager"的路由。
- 验证：`bun run build:electron`、`bun run lint`（0 error，警告均为改动文件之外的既有 `any` 警告）均通过；未做真实 pi API key 的端到端手测。

### 给下一步的接力棒

- **PiSession 构造函数最终签名**：`(sessionId: string, config: PiSessionConfig)`，`PiSessionConfig = { conversationId: string; modelSelection: ModelSelection | null; systemPrompt?: string }`。
- **Agent 实例持有方式**：`private agent: Agent | null = null`，`start()` 里 `new Agent({ initialState: { systemPrompt, model, tools: [] }, streamFn })` 赋值，`streamFn` 来自 `buildPiModels(profile).streamSimple`。
- **message-converter 扩展点**：`convertPiEvent()` 目前只认 `event.type==='message_update' && assistantMessageEvent.type==='text_delta'`。Step 2/3 加 skill/工具后需要在这里加分支：`toolcall_start/toolcall_end` → `tool_use`；`thinking_delta` → `thinking`；`AgentEvent` 顶层的 `tool_execution_start/tool_execution_end`（注意不在 `assistantMessageEvent` 里，需在函数最外层加 `if`）→ `tool_use`/`tool_result`。
- **Manager 事件转发写法**：`createSession()` 内对 `PiSession` 注册 `message`/`error`/`complete` 三个监听，各自 `this.emit('sessionXxx', ...)` + `this.broadcaster?.(...)`；`broadcaster` 由 `agent.ts` 模块加载时注入，事件名与 IPC 层（`queryBasedSessionMessage`/`queryBasedSessionComplete`）保持一致，前端零改动。
- **关键坑点（Step 2+ 排查问题先看这里）**：
  1. `setSessionModel` 必须路由——前端每个新会话第一条消息发送前必调它判断是否需要 `client.setSessionModel`，不路由会导致消息发不出去。当前 `PiSession.setModel()` 对"selection 与 attach 时完全一致"返回 `{ok:true}`，中途切模型会触发 `needsRestart:true`（还没做热切）。
  2. pi 分支完全绕开 `wireConversationSession()`，不广播 `sessionStateChanged`/`sessionClosed`，全局运行指示灯（`StatusPulse`）对 pi 会话不亮（本地 `isLoading` 靠 `queryBasedSessionComplete` 正常）。Step 5（插话队列）可能需要重新设计这块。
  3. pi 会话不持久化 `sdkSessionId`，关闭重开=全新空会话，符合已知限制。
  4. `interruptQueryBasedSession`/`setPermissionMode`/`respondPermissionRequest`/`respondAskUserQuestion`/`setSessionCachePolicy`/`getSessionCapabilities`/`forceCloseQueryBasedSession` 尚未路由到 `PiSessionManager`——权限类本来不会触发（无工具），但 `interruptQueryBasedSession`（停止生成按钮）和 `forceCloseQueryBasedSession`（`/clear`）对 pi 会话目前静默无效，需要哪个 step 用到时照抄 `sendQueryBasedSessionMessage` 的路由写法接上。`PiSession.interrupt()` 本身已实现好（`agent.abort()`）。
- **Step 2 待决问题**：pi 的 `Agent` 没有运行时动态注入 skill 内容的 hook，skill 内容需要在 `attachPiConversation()` 组装 `systemPrompt` 阶段就拼进去，而不是运行时注入。当前 `attachPiConversation()` 的 systemPrompt 只有 `appSettings.ai.defaultSystemPrompt` 一段，SDK 路径的人设/工作区画像/工具导览等拼装完全没有对齐。
- 完整交付细节见组共享区 `step1-delivery.md`（子会话产出，含更详细的代码位置和设计取舍说明）。
