---
step: 4
title: 自动压缩接入
status: done
---

## 目标

pi 会话在发消息前检测上下文用量，超过 `contextWindow × autoCompactPercent%` 时自动执行 harness 压缩，前端显示压缩状态与边界分隔线。

## 依赖上下文（接力棒输入）

- 前置 step 产出：[step3-context-catalog.md] `autoCompactPercent`（默认 80）已落类型；model-catalog 查表就绪，`buildPiModel.contextWindow` 为真实/回落窗口
- 关键机制事实（已读 pi-agent-core 源码确认）：
  - `AgentHarness.compact(customInstructions?)` 要求 `phase === 'idle'`，否则抛 busy；`prompt()` 同样要求 idle → 压缩放在 sendMessage 非 steer 分支、`prompt()` 之前天然无竞态（`node_modules/@earendil-works/pi-agent-core/dist/harness/agent-harness.js:640-681`）
  - compact 内部：`prepareCompaction` → emitHook `session_before_compact` → 一次独立 LLM 调用生成摘要（不走 agent 事件流）→ `session.appendCompaction` 写入 CompactionEntry → emitOwn `session_compact`；finally 置回 idle
  - contextTokens 计算：`usage.totalTokens || input + output + cacheRead + cacheWrite`（compaction.js:94-96）
  - `Nothing to compact` 场景：分支无内容可压时 compact 抛错
- 前端现成链路（零改动，仅验证）：
  - 实时：`ExtendedSessionMessage` type `'compacting'`（正在压缩提示）与 `'compact_boundary'`（transformers.ts:135 插入 isCompactBoundary 分隔消息，ContentBlockItem.tsx:322 渲染 CompactBoundaryDivider）
  - 历史：重开对话走 `tipc/agent.ts:411` → `history-adapter.ts:67` compactionToMessage，与实时路径不重复（历史唯一来源是 session tree，实时 emit 只更新内存 UI）
- compact_boundary 消息形状（transformers.ts:135-160 预期）：`{ type: 'compact_boundary', timestamp, compactTrigger: 'auto'|'manual', compactPreTokens: number }`

## 计划改动

- [x] `electron/main/agents/pi-session/pi-harness-adapter.ts`：加 `async compact(): Promise<void>` 转发 `this.harness.compact()`（错误上抛由调用方处置）
- [x] `electron/main/agents/pi-session/pi-session.ts`：
  - 实例字段：`lastContextTokens: number | undefined`、`currentModelId: string`、`currentContextWindow: number`（start() 里从 `resolvePiModel` 结果赋值；Step 1 已加 `currentModelId` 的话复用）
  - `handleAgentEvent` 的 `agent_end` 分支：从 `event.messages` 逆序找最后一条 `role === 'assistant'` 且 `stopReason` 非 aborted/error 且带 usage 的消息，算 contextTokens 存 `lastContextTokens`；找不到置 undefined
  - `sendMessage()` 非 steer 分支、`prompt()` 之前：
    - `percent = currentAutoCompactPercent`（start() 存的 `profile.autoCompactPercent ?? 80`）；`threshold = currentContextWindow * percent / 100`
    - `lastContextTokens !== undefined && lastContextTokens > threshold` 时：emit `'compacting'` 状态消息 → `await adapter.compact()` → 成功后 emit `{ type: 'compact_boundary', timestamp: Date.now(), compactTrigger: 'auto', compactPreTokens: lastContextTokens }` 并把 `lastContextTokens` 置 undefined（压缩后旧值失效）
    - compact 失败（含 Nothing to compact）：log warn + emit 一条 error 短消息「自动压缩失败已跳过：{原因}」，不中断，继续 `prompt()`（尽力而为；若上下文真超窗由模型错误自然浮现）
  - steer 分支不触发压缩（run 进行中，下一条非 steer 消息自然触发）
- [x] `docs/codebase-map.md`：若 agents/pi 或 pi-session 目录条目描述变化则同步（doc-sync）

## 验收

- `bun run build` + `bun run lint` 通过
- 手动场景：把某 profile `autoCompactPercent` 调到 50 并进行长对话，超过 50% 后再发消息 → 出现「正在压缩对话历史...」提示 → 出现压缩分隔线 → 消息正常发送、模型基于摘要继续对话
- 重开该对话：压缩分隔线仍在（历史路径），之前的消息按折叠逻辑处理（AgentChat 默认折叠 boundary 之前内容）
- 正常短对话（低于阈值）发消息无任何压缩痕迹

## 实施回填（做完后填）

### 实际改动
- 与计划差异：
  - step 文档笔误 `currentResolvedProfile?.autoCompactPercent`（Step 1 已删该字段）：按接力棒指示在 start() 存 `currentAutoCompactPercent: number`（= `profile.autoCompactPercent ?? 80`，resolvePiModel 返回的 profile）；同时存 `currentContextWindow = model.contextWindow`
  - `maybeAutoCompact(adapter)` 实现为独立私有方法（在 try 内、prompt() 之前调用），内部全捕获不抛错，compact 失败走 emitErrorMessage 短提示
  - contextTokens 口径模块级函数 `extractLastContextTokens`（pi-session.ts）：`usage.totalTokens || input + output + cacheRead + cacheWrite`，且 total>0 才采纳（对齐 pi compaction 的 calculateContextTokens + getAssistantUsage 判定）
  - agent_end 无条件重算 lastContextTokens（找到存值、找不到置 undefined），压缩成功后置 undefined 只影响"本轮 prompt 前不再重复判"，语义与计划一致
- 改动文件清单：`electron/main/agents/pi-session/pi-harness-adapter.ts`（加 compact() 转发）、`electron/main/agents/pi-session/pi-session.ts`（字段 + start() 赋值 + agent_end 提取 + sendMessage 接入 + maybeAutoCompact + extractLastContextTokens）、`docs/codebase-map.md`（pi-session.ts / pi-harness-adapter.ts 条目同步）

### 给下一步的接力棒
- 关键签名 / 数据结构：
  - `PiHarnessAdapter.compact(): Promise<void>`（要求 harness idle，错误原样上抛）
  - `PiSession` 实例字段：`currentContextWindow: number`（=0，start() 赋 model.contextWindow）、`currentAutoCompactPercent: number`（=80，start() 赋 profile.autoCompactPercent ?? 80）、`lastContextTokens: number | undefined`（agent_end 逆序找最后一条非 aborted/error 且带 usage 的 assistant 消息算出）
  - emit 消息形状：`{ type: 'compacting', timestamp }`、`{ type: 'compact_boundary', timestamp, compactTrigger: 'auto', compactPreTokens }`（与 transformers.ts:135 及 task-types.ts 字段一致；历史路径 history-adapter.ts compactionToMessage 从 session tree 读，不重复）
  - harness compact 期间的 steer 安全：steer() 只要求非 idle，phase='compaction' 时入队，compact 后的 prompt() 排空队列
- 下个 step 该从哪里继续：本 step 是计划最后一个实施 step（plan.md 仅 Step 1-4）；后续仅剩 plan 索引勾选与整体验证（验收中的长对话手动场景）
- 待办或已知限制：
  - 压缩失败时 lastContextTokens 不清（下次 agent_end 会重算覆盖）；若连续多轮 turn 都失败会每条消息重试压缩并重复提示
  - compact 的 LLM 调用产物不进 agent 事件流，usage 只落在 session JSONL 的 CompactionEntry（现有 usage 采集不统计压缩调用的 token）
  - 手动 /compact 命令（useSendMessage.ts 前端拦截）仍走旧链路发 `/compact` 文本，pi 会话不识别斜杠命令，属既有状态未动
