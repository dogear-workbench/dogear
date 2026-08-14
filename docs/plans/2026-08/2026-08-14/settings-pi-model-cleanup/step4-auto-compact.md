---
step: 4
title: 自动压缩接入
status: pending
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

- [ ] `electron/main/agents/pi-session/pi-harness-adapter.ts`：加 `async compact(): Promise<void>` 转发 `this.harness.compact()`（错误上抛由调用方处置）
- [ ] `electron/main/agents/pi-session/pi-session.ts`：
  - 实例字段：`lastContextTokens: number | undefined`、`currentModelId: string`、`currentContextWindow: number`（start() 里从 `resolvePiModel` 结果赋值；Step 1 已加 `currentModelId` 的话复用）
  - `handleAgentEvent` 的 `agent_end` 分支：从 `event.messages` 逆序找最后一条 `role === 'assistant'` 且 `stopReason` 非 aborted/error 且带 usage 的消息，算 contextTokens 存 `lastContextTokens`；找不到置 undefined
  - `sendMessage()` 非 steer 分支、`prompt()` 之前：
    - `percent = currentResolvedProfile?.autoCompactPercent ?? 80`；`threshold = currentContextWindow * percent / 100`
    - `lastContextTokens !== undefined && lastContextTokens > threshold` 时：emit `'compacting'` 状态消息 → `await adapter.compact()` → 成功后 emit `{ type: 'compact_boundary', timestamp: Date.now(), compactTrigger: 'auto', compactPreTokens: lastContextTokens }` 并把 `lastContextTokens` 置 undefined（压缩后旧值失效）
    - compact 失败（含 Nothing to compact）：log warn + emit 一条 error 短消息「自动压缩失败已跳过：{原因}」，不中断，继续 `prompt()`（尽力而为；若上下文真超窗由模型错误自然浮现）
  - steer 分支不触发压缩（run 进行中，下一条非 steer 消息自然触发）
- [ ] `docs/codebase-map.md`：若 agents/pi 或 pi-session 目录条目描述变化则同步（doc-sync）

## 验收

- `bun run build` + `bun run lint` 通过
- 手动场景：把某 profile `autoCompactPercent` 调到 50 并进行长对话，超过 50% 后再发消息 → 出现「正在压缩对话历史...」提示 → 出现压缩分隔线 → 消息正常发送、模型基于摘要继续对话
- 重开该对话：压缩分隔线仍在（历史路径），之前的消息按折叠逻辑处理（AgentChat 默认折叠 boundary 之前内容）
- 正常短对话（低于阈值）发消息无任何压缩痕迹

## 实施回填（做完后填）

### 实际改动
- 与计划差异：
- 改动文件清单：

### 给下一步的接力棒
- 关键签名 / 数据结构：
- 下个 step 该从哪里继续：
- 待办或已知限制：
