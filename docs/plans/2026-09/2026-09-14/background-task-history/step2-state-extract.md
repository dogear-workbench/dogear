---
step: 2
title: STATE_EXTRACT 接入
status: pending
---

## 目标
话题状态卡抽取任务进入统一历史：补回丢失的 token 用量、提交时注册运行、终态写历史条目。

## 依赖上下文（接力棒输入）
- 前置 step 产出：step1 加了 `RunHistorySource` 类型、`background-activity-service`（`reportRunning/reportDone/getRunning`）、写历史走 `appendHistoryEntry`
- 当前关键文件状态：
  - `electron/main/services/memory/state-extract-trigger.ts` — `submitExtractTask` 内 `submitTask(task, callback)`，终态回调收 `(taskId, status, result, error)`，result 即 agent-worker 返回值
  - `electron/main/agents/agent-worker.ts` `handleStateExtractTask` — 逐会话 `runOnce`，result 有 `usage`（inputTokens/outputTokens/cacheReadInputTokens/cacheCreationInputTokens）但未累加传出；返回值形如 `{ groupId, processed, skipped, failed, failures, tier, profileName }`
  - in-flight 按组去重 Map 不变，key 是 `wsId:groupId`
- 关键决策回顾：先写历史再 reportDone；写历史失败 catch+log 不影响任务；tokens 需跨会话累加

## 计划改动
- [ ] `electron/main/agents/agent-worker.ts` — `handleStateExtractTask` 循环内累加每次 `runOnce` 的 `result.usage`（跳过/空跑不计），放进返回值 `tokens` 字段（结构对齐 RunTokens：inputTokens/outputTokens/cacheReadInputTokens?/cacheCreationInputTokens?）；取消/失败提前返回的分支也带上已累计值
- [ ] `electron/main/services/memory/state-extract-trigger.ts` — `submitExtractTask`：
  - `submitTask` 调用前 `reportRunning(task.id, { source: 'state-extract', name: 状态抽取 · {组标题} })`（组标题用 `getGroup` 查，查不到回退 groupId 短形式；注意此处是 async，放在现有 async IIFE 内）
  - 终态回调（COMPLETED/FAILED/CANCELLED 分支统一出口 finish 后或 finish 内）组装 RunHistoryEntry 写 `appendHistoryEntry`：`source: 'state-extract'`、planName = 注册时同名、status 映射（COMPLETED 且无 result.error → completed；COMPLETED 带 error / FAILED → failed；CANCELLED → cancelled）、summary = 结果文本（处理 X 会话 / 成功 X / 跳过 X / 失败 X，失败列会话与原因首行）、error、tokens（result.tokens 映射）、startedAt（任务创建时间）、endedAt（Date.now()）、triggerReason: 'condition'
  - 写历史与 reportDone 均 try/catch + log
- [ ] `bun run build:electron` 编译通过；开新会话触发一次抽取，历史出现条目且带 tokens

## 实施回填（做完后填）

### 实际改动
- 与计划差异：
- 改动文件清单：

### 给下一步的接力棒
- 关键签名 / 数据结构：
- 下个 step 该从哪里继续：
- 待办或已知限制：
