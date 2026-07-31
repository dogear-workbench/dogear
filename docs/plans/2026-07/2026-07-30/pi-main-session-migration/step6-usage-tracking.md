---
step: 6
title: usage 统计
status: done
---

## 目标

pi 会话产出与 SDK 版结构一致的 `ConversationUsageEntry`，让现有 usage 徽章（`components/agent-chat/usage-badge/`）在 pi 会话下正常显示 token 用量，不因数据缺失报错或显示异常。

## 依赖上下文（接力棒输入）

- **SDK 侧现状**：`query-based-session.ts` 的 `processMessageLoop()` 里嵌在 result 消息分支（`:980-1014`）fire-and-forget 提取 usage、`emit('usage', ...)`/`emit('usageContext', ...)`，消费方 `usage-extractor.ts`（`extractUsageEntry`，纯函数，从 SDK `result` 消息提取 `ConversationUsageEntry`）+ `usage-service.ts`（`appendEntry`/`appendCompactMarker`/`appendContext`，写 `.dogear/usage/{conversationId}.jsonl`）。
- **目标类型**：`ConversationUsageEntry`/`ContextSnapshot`（`types/usage.ts`，主进程镜像在 `electron/main/types.ts`）——具体字段执行时重新读取确认（本文档不复制字段列表，避免与实际代码演进脱节）。
- **pi 侧 usage 数据来源**：pi 的 `Model`/`Agent` 在流式响应或轮次结束时会有 usage/cost 相关事件（阶段一 `pi/provider.ts` 的 `PiModelResult` 提到 `cost` 相关字段，具体事件名和字段形状需要执行时读 `pi-ai`/`pi-agent-core` 的类型定义确认，不要凭空猜测字段名）。
- **usage 徽章前端**：`UsageBadge.tsx`/`useConversationUsage.ts` 走 `getUsage` IPC 查询 + `usageEntryAdded` 事件触发刷新，这两个都是读 `.dogear/usage/{conversationId}.jsonl` 文件，只要写入格式一致，前端不用改。

## 计划改动

- [x] 执行时先读 `pi-ai`/`pi-agent-core` 的类型定义，确认 pi 暴露的 usage/cost 事件的准确字段（token 数、模型 id、cache 命中等），与 `ConversationUsageEntry` 字段逐一对照
- [x] 新建 `electron/main/agents/pi-session/usage-extractor.ts`：`extractPiUsageEntry(piEvent): ConversationUsageEntry`，产出结构与现有 `usage-extractor.ts` 一致
- [x] `pi-session.ts` 在对应事件点调用 `appendUsageEntry`/`appendUsageContext`（复用现有 `usage-service.ts`，不需要新写存储层）
- [ ] 手测：pi 会话跑几轮对话后，打开 usage 徽章确认数据展示正常（token 数、模型名等）——留 Step 7 真实任务里顺带验证

## 实施回填（做完后填）

### 实际改动

**新建 `electron/main/agents/pi-session/usage-extractor.ts`**
- 导出 `PiUsageAccumulator` 接口 + `createPiUsageAccumulator` / `accumulatePiUsage` / `extractPiUsageEntry` 三个函数
- 设计：pi 没有 SDK 那种"整 run 累计"的 result.usage，每条 AssistantMessage.usage 只反映单次 LLM call。所以用一个累加器在 `message_end` 时累加每条 AssistantMessage.usage，`agent_end` 时一次性转成 `ConversationUsageEntry`

**`pi-session.ts`**
- 新增 import：`v4 as uuidv4`、`AssistantMessage`、usage-extractor 三个函数
- 新增字段：`currentTurnMessages`（本轮 emit 的 ExtendedSessionMessage 快照，喂给 extractPiUsageEntry 聚合 toolActivity）、`usageTurnIndex`、`currentRunUsageAccum`
- `handleAgentEvent`：
  - `message_end` + `message.role === 'assistant'` → 累加 usage（lazy 创建累加器）
  - `convertPiEvent` 产出 message 时 push 进 `currentTurnMessages`
  - `agent_end` → 调 `emitUsageEntry()`，清空 `currentTurnMessages` 和 `currentRunUsageAccum`，再处理原 steer 兜底与 `syncSessionState`
- 新增私有方法 `emitUsageEntry()`：组装 entry + 自填 uuid + 自增 turnIndex + `emit('usage', { conversationId, entry })`；异常只 warn
- `sendMessage` catch 路径兜底清空本轮 usage 状态（pi 极端路径 streamFn throw 可能跳过 agent_end）

**`pi-session-manager.ts`**
- 新增 import：`BrowserWindow` / `getRendererHandlers` / `appendEntry` / `applyUsageSummary` / `RendererHandlers` 类型 / `ConversationUsageEntry` 类型
- 顶层新增 `broadcastUsageEntryAdded()`：与 SDK 侧 `query-based-session.ts:2101` 完全对称的实现，给所有 BrowserWindow 发 `usageEntryAdded` 事件
- `createSession` 内新增 `session.on('usage', ...)`：先 await `appendUsageEntry` 落盘 → `applyUsageSummary` 增量合并到对话索引 → `broadcastUsageEntryAdded` 通知前端刷新

### 字段映射（pi `Usage` → `ConversationUsageEntry.usage`）

| ConversationUsageEntry 字段 | pi 来源 | 备注 |
|---|---|---|
| `usage.inputTokens` | `Σ AssistantMessage.usage.input` | 多轮 input 会重复计算（第二轮含前轮上下文），与 SDK `result.usage.input_tokens` 累加口径一致 |
| `usage.outputTokens` | `Σ usage.output` | |
| `usage.cacheReadInputTokens` | `Σ usage.cacheRead` | |
| `usage.cacheCreationInputTokens` | `Σ usage.cacheWrite` | |
| `usage.cacheCreation.ephemeral1hInputTokens` | `Σ usage.cacheWrite1h` | pi 只有 Anthropic 暴露这个拆分 |
| `usage.cacheCreation.ephemeral5mInputTokens` | `Σ (usage.cacheWrite - usage.cacheWrite1h)` | pi 不直接报，反推 |
| `usage.serviceTier` / `speed` / `serverToolUse` | — | pi 不暴露，留 undefined |
| `totalCostUsd` | `Σ usage.cost.total` | |
| `numTurns` | `accum.messageCount`（累加过的 AssistantMessage 条数） | |
| `stopReason` | 最后一条 AssistantMessage.stopReason | 'stop' / 'toolUse' / 'length' / 'aborted' / 'error' |
| `terminalReason` | 由 stopReason + errorMessage 派生：'completed' / 'aborted' / 'max_turns' / 'error' | |
| `uuid` | `uuidv4()` 自填 | pi 无原生 run uuid |
| `durationMs` / `durationApiMs` / `ttftMs` | `0` / `0` / undefined | pi 不暴露分阶段耗时 |
| `modelUsage` | 按 `responseModel \|\| model` 分桶累加 | contextWindow 用 `MODEL_CONTEXT_WINDOWS` 兜底 |
| `toolActivity` | 从 `currentTurnMessages` 聚合 `type:'tool_use'` 消息（按 toolName 计数，Read 工具收集 file_path 去重保序） | 与 SDK 侧 `extractUsageEntry` 口径完全一致 |
| `subagentCalls` / `permissionDenials` / `permissionWaits` | — | 第一批 pi 会话不产子代理、不采集权限统计，全 undefined |

### 给下一步的接力棒

- **usageContext（ContextSnapshot）暂不产出**：SDK 侧靠 `query.getContextUsage()` 拿真实快照，pi 无等价 API。前端 `useConversationUsage` 派生上下文占用/上限时会拿到 `latestContext = undefined`，徽章 fallback 到 entries 累加估算——视觉上是"上下文进度条不显示"，但 token 总量、模型名、工具计数都正常。Step 7 验收时把这个体感记一下
- **durationMs / ttftMs / numTurns 字段都是 0 或粗略**：Step 7 看真实数据，如果用户对 pi 路径下"首 token 耗时"特别关心，再单独立项（pi 要在 streamFn 外面包计时器，工作量不小）
- **手测验证点**：跑 1-2 个含工具调用的 pi 任务，打开 usage 徽章确认：①token 数 > 0；②模型名正确（responseModel 优先）；③按工具次数聚合的 Top5 列表能显示 Read/Edit/Bash 等；④hover 单条 entry 二级展开能看到 cacheRead/cacheWrite 拆分（如果模型走 Anthropic 直连）
