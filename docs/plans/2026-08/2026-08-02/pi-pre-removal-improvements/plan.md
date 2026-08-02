# pi SDK 移除前增量改进实施计划

**目标**：在不依赖 AgentHarness 或 SDK 移除的前提下，为 PiSession 补齐 thinking 流展示、全自动工具权限模式和上下文用量快照，使其复用既有前端渲染、权限与用量基础设施。

**架构思路**：保持 PiSession 的裸 `Agent` 架构不变，只在其现有事件转换、工具权限拦截和用量事件边界增量扩展。权限模式对外继续兼容 SDK 的 `PermissionMode`，把 `dontAsk` 映射为 Pi 内部自动放行，避免修改既有 IPC、设置和微信 bot/子会话调用方；不提前引入 AgentHarness、会话持久化或 compaction。

**涉及模块**：
- `electron/main/agents/pi-session/message-converter.ts`
- `electron/main/agents/pi-session/pi-session.ts`
- `electron/main/agents/pi-session/usage-extractor.ts`
- `electron/main/types.ts`（仅在现有 `ContextSnapshot` 不能满足实际类型时调整）

## 步骤索引

- [x] [Step 1: Thinking 流事件转换](./step1-thinking-stream.md) — 将 pi 的 `thinking_delta` 转为既有前端可渲染的 thinking 消息。
- [x] [Step 2: 全自动权限模式](./step2-auto-approve-permission.md) — 实现 PiSession 的权限模式存储、SDK `dontAsk` 兼容映射与自动放行。
- [x] [Step 3: 上下文用量快照](./step3-context-usage.md) — 从 pi assistant usage 发出 `usageContext` 事件，恢复既有上下文进度展示。

## 全局决策

- 不改动 tipc IPC 签名：继续使用 SDK 的 `PermissionMode` 作为 PiSession 的对外入参类型，保证既有前端、微信 bot 与子会话调用兼容。
- PiSession 的自动放行语义由 `dontAsk` 触发；`default` 保持现有逐工具确认逻辑。其他 SDK mode 的处理必须明确且保守，不得意外扩大权限。
- `thinking_start`、`thinking_end` 不产生展示消息；仅转发 `thinking_delta`，沿用前端现有 transformers 对相邻块的合并机制。
- 上下文快照按单条 assistant `message_end` 的最新 usage 计算，不使用整轮累计 usage，避免多工具轮次累加造成当前上下文大小虚高。
- 上下文 token 口径固定为 `input + cacheRead + cacheWrite`；最大窗口来自 `MODEL_CONTEXT_WINDOWS`。未知模型窗口时不伪造比例，`maxTokens` 与 `percentage` 均为 `0`。
- 所有新增事件继续通过现有 EventEmitter → conversation runtime → usage service 链路传递，不新增渲染层文件系统访问或绕过 tipc 的 IPC。

## 完成总结

- PiSession 已将 `thinking_delta` 转换为既有前端消息流可直接渲染的 thinking 消息。
- PiSession 已支持 SDK `PermissionMode`，其中 `dontAsk` 自动放行，其他模式保留逐工具确认的保守语义。
- PiSession 已从每条 assistant usage 发出并持久化上下文快照，复用既有 usage 刷新链路。
