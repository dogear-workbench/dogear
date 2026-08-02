---
step: 3
title: 上下文用量快照
status: pending
---

## 目标

从 pi 每次 assistant `message_end` 的 usage 中生成并发出 `usageContext` 快照，让现有 usage service 与 `UsageBadge` 显示 Pi 会话的上下文进度。

## 依赖上下文（接力棒输入）

- 前置 step 产出：Step 1 和 Step 2 分别扩展消息转换与权限行为，不改变 usage 累加器、`message_end` 处理或 usage event 的路由。
- 当前关键文件状态：`PiSession.handleAgentEvent()` 在 assistant `message_end` 时调用 `accumulatePiUsage()`；`agent_end` 时调用 `emitUsageEntry()` 并 emit `usage`。`usage-extractor.ts` 已导入 `MODEL_CONTEXT_WINDOWS`，但只用于 `ConversationUsageEntry.modelUsage`。
- 现有下游契约：`ContextSnapshot` 位于 `electron/main/types.ts`，字段为 `turnIndex`、`timestamp`、`totalTokens`、`maxTokens`、`percentage`、`model`、`categories`。SDK 会话以 `usageContext` 事件发送该结构；conversation runtime 与 usage service 已负责持久化和前端刷新。
- 关键决策回顾：快照基于最新单次 assistant usage，不基于当前 run 的累加器。`totalTokens = input + cacheRead + cacheWrite`；模型窗口来自 `MODEL_CONTEXT_WINDOWS[modelId]`。模型未知或窗口缺失时，`maxTokens` 与 `percentage` 均为 `0`，不猜测上下文容量。

## 计划改动

- [ ] `electron/main/agents/pi-session/usage-extractor.ts`：新增纯函数，从单条 `AssistantMessage` 提取 Pi 上下文快照所需的模型 ID、总 token 和最大窗口；复用已导入的 `MODEL_CONTEXT_WINDOWS`，避免在 PiSession 重复 token 计算规则。
- [ ] `electron/main/agents/pi-session/pi-session.ts`：在 assistant `message_end` 分支中，完成 usage 累加后基于该条 message 创建 `ContextSnapshot`，并 emit `usageContext`，携带当前 conversationId。
- [ ] `electron/main/agents/pi-session/pi-session.ts`：确定快照 `turnIndex` 与现有 usage entry 的一致性：使用将要在本次 `agent_end` 生成的 `usageTurnIndex`，同一 run 中多条 `message_end` 允许覆盖同一个 turn 的 latestContext。
- [ ] `electron/main/agents/pi-session/pi-session.ts`：无 conversationId、无 usage 或未知模型窗口时保持安全降级，不得影响消息流或 `usage` entry 采集。
- [ ] 核对 `wireConversationSession()` 中 `usageContext` 监听与 usage service 写入路径，确认不新增 IPC 路由或渲染层改动。
- [ ] 执行类型检查或 lint；若项目现有 usage 测试便于覆盖，为快照纯函数增加普通、含缓存和未知模型窗口的最小测试。

## 验收标准

- Pi assistant `message_end` 携带 usage 时，会发出符合 `ContextSnapshot` 的 `usageContext` 事件。
- `totalTokens` 精确等于该条 usage 的 `input + cacheRead + cacheWrite`。
- 已知模型的 `maxTokens` 来自 `MODEL_CONTEXT_WINDOWS`，`percentage = totalTokens / maxTokens * 100`；未知模型窗口时二者为 `0`（其中 `totalTokens` 仍保留真实值）。
- 一次包含工具调用的 Pi run 中，usage entry 的累计费用/用量语义不变；上下文显示采用最后一次 LLM 调用的最新快照。
- 前端无需新增处理，即可通过既有 usage 刷新链路获得 `latestContext`。

## 实施回填（做完后填）

### 实际改动

- 与计划差异：
- 改动文件清单：

### 给下一步的接力棒

- 关键签名 / 数据结构：
- 下个 step 该从哪里继续：
- 待办或已知限制：
