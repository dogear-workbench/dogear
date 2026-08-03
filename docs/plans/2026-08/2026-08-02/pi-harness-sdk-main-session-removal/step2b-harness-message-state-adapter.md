---
step: 2b
title: Harness 消息与状态适配
status: done
---

## 目标

以 AgentHarness 替换 PiSession 的裸 Agent，同时保持 Dogear 消息、插话队列、状态和 usage 事件语义。

## 依赖上下文（接力棒输入）

- Step 2A 已实现 Conversation sessionId 和 PiSession 的 repository create/open 生命周期。
- `pi-harness-adapter-design.md` 定义了 Harness 类型不得泄漏出 PiSession 目录的边界。
- 现有 `PiSession` 的裸 Agent 事件经 `message-converter.ts` 输出 ExtendedSessionMessage，PiSessionManager 负责广播与 usage 落盘。
- Harness 替换必须同时接入完整权限状态机；否则裸 Agent 的 beforeToolCall 被移除会降低产品语义。

## 计划改动

- [ ] 新增 `pi-harness-adapter.ts`，集中构造 AgentHarness 和订阅 Harness 事件，避免 Harness 类型进入 runtime/TIPC/renderer。
- [ ] 使用 repository 返回的 Session、models、tools、system prompt、thinking level 和 streamOptions 构造 Harness；不启用自动 compaction。
- [ ] 将底层 Agent 消息事件映射回现有 message、thinking、tool_use、tool_result、错误和 usage 输入；必要时演进 message-converter，但不得修改渲染层消息协议。
- [ ] 用 Harness `queue_update` 计算 pendingCountChanged，用 `settled` 驱动 running=false 与单轮结算，用 save_point 建立后续关闭落盘边界。
- [ ] 将 sendMessage 的 prompt/steer 路径与 Harness 正式 API 对齐，保持插话一条条消费的产品语义；仅暴露供 Step 2C 调用的 adapter abort/clearQueue 原语，不在本步骤实现生命周期出口清理。
- [ ] 将完整权限状态机接入 Harness `tool_call` hook，保留 dontAsk、豁免规则、会话 allow、持久 allow、allow、deny、编辑工具输入和前端 `permissionRequest` / `respondPermissionRequest` 的既有正常路径语义，并建立供 Step 2C 清理的 pending permission registry。
- [ ] 验证编辑工具输入后允许时 Harness 执行器对 input 的传递语义；若不共享引用，使用上游支持的显式改写机制。
- [ ] 执行 `bun run build:electron`，手动验证文本消息、工具消息、单次插话、usage、权限允许/拒绝与编辑后允许；中断、关闭、release 与挂起权限清理由 Step 2C 验证。

## 实施回填（做完后填）

### 实际改动

- 与计划差异：`builtin-tools.ts` 按计划建议落地简化——不再用 `wrapHarnessTool()` 把 harness 原生工具（`createReadTool`/`createWriteTool`/`createEditTool`/`createBashTool`）降级包装成裸 `AgentTool` 4 参形状，改为直接导出这批 `AgentHarnessTool<{env}>`，`env` 统一由 `AgentHarness` 的 `toolContext: { env }` 注入。`toPiTools()` 产出的裸 `AgentTool[]`（4 参 execute）无需任何改动即可结构兼容赋值给 `AgentHarnessTool<{env}>[]`（TS "更少参数函数可赋值给更多参数函数类型"规则），未触碰 `tool-adapter.ts`。
- 改动文件清单：
  - 新增 `electron/main/agents/pi-session/pi-harness-adapter.ts`：封装 `AgentHarness` 构造与事件订阅，导出 `PiHarnessAdapter` 类（`prompt`/`steer`/`abort` 三个方法）+ `HarnessToolCallEvent`/`HarnessToolCallResult`/`HarnessToolCallHandler`/`PiHarnessAdapterOptions` 类型；`AgentHarness`/`Session`/`JsonlSessionMetadata` 等 Harness 类型只在本文件内使用，不对外导出。
  - 重写 `electron/main/agents/pi-session/builtin-tools.ts`：去掉降级包装，直接导出 harness 原生工具，签名从 `(workspacePath: string)` 简化为无参（`env` 移交调用方经 `toolContext` 注入）。
  - 改造 `electron/main/agents/pi-session/pi-session.ts`：`Agent` → `PiHarnessAdapter`；新增 `running` 字段镜像 harness phase（Harness 不暴露 `isStreaming` 查询）；`handleBeforeToolCall` 改名 `handleToolCall` 接 `HarnessToolCallEvent`（无 `AbortSignal` 参数，因为 Harness 的 `tool_call` hook 不传 signal）；权限状态机（dontAsk/豁免/sessionAllowedTools/持久化规则/pending map/编辑参数后原地改写）逐字保留；新增 `handleSteerQueueChanged`/`handleSettled` 两个回调分别驱动 `pendingSteerCount` 和 `running=false` 的结算。

### 给下一步的接力棒

- adapter 的公共内部接口：`PiHarnessAdapter` 构造参数 `{ session, models, tools, toolContext, systemPrompt, model, thinkingLevel, timeoutMs?, onAgentEvent, onSteerQueueChanged, onSettled, onToolCall }`；方法 `prompt(text)`/`steer(text)`/`abort()`（fire-and-forget）。Step 2C 若要做 `waitForIdle()` 语义，建议在 `PiHarnessAdapter` 上加薄封装方法，不要绕过 adapter 直接碰 `AgentHarness`。
- Harness event → Dogear event 映射：裸 `AgentEvent`（`agent_start/end`、`turn_start/end`、`message_start/update/end`、`tool_execution_start/update/end`）经 `subscribe()` 透传给 `onAgentEvent`，走现有 `convertPiEvent()` 不变；`queue_update`（`emitOwn` 分发）→ `onSteerQueueChanged(event.steer.length)`；`settled`（`emitOwn` 分发）→ `onSettled()`；`tool_call`（`emitHook` 分发，`.on()` 有效）→ `onToolCall` 权限状态机。**关键 API 事实**：`queue_update`/`settled`/`save_point`/`abort` 等 `AgentHarnessOwnEvent` 走 `emitOwn()`，只有 `subscribe()` 注册的通配符监听器能收到；用 `.on(type, handler)` 注册这些类型会被静默忽略（无报错、handler 永远不被调用）。`.on()` 只对经 `emitHook()` 分发的事件有效（`tool_call`/`tool_result`/`context`/`before_agent_start`/`before_provider_*`/`session_before_*`）。这是本步骤手测阶段才发现的运行时坑（build 类型检查发现不了），Step 2C 如果要监听 `save_point`/`abort`/`tool_result` 等事件必须走 `subscribe()`。
- queue/settled/save_point 时序：`queue_update` 在 `steer()` 入队和每个 turn 开头 one-at-a-time drain 时触发（队列已空则不触发）；`settled` 在 `agent_end` 裸事件透传**之后**、`prompt()`/`steer()` 外层 Promise resolve **之前**触发，是 `running=false` 的唯一权威来源（不再需要像裸 Agent 时代靠 `finally` 兜底等 `isStreaming` 翻false）；`save_point` 本步骤未订阅，确认在每个工具调用批次结束、session 落盘后触发一次，`hadPendingMutations` 反映是否真的写了东西，是 Step 2C "落盘后才允许关闭"判断的候选锚点。
- usage 结算时机：不变，仍挂在裸 `agent_end` 事件分支（`emitUsageEntry()`），与阶段一实现完全一致。
- 下个 step 入口：Step 2C 聚焦 abort、close、release 的 pending permission 清理，以及 settled/save_point 落盘顺序；`PiHarnessAdapter.abort()` 目前是唯一暴露的清理原语，没有单独的"仅清队列不中断当前工具调用"接口（Harness 本身也不提供）。
- 待办或已知限制：`PiHarnessAdapter` 未暴露 `waitForIdle()`；权限确认"挂起清理"的穷尽测试（abort/close/release 时批量拒绝且不遗漏）留给 Step 2C；开发环境 `.dogear/settings.json` 的 `defaultModelSelection` 与当前激活 profile 的模型清单不匹配时，新对话首次 attach 会失败且 UI 无清晰引导——这是环境配置问题，不阻塞本步骤，值得后续单独看一下 attach 失败的 UX 兜底。
