---
step: 2
title: 增量抽取任务
status: pending
---

## 目标
新增 STATE_EXTRACT 后台任务：逐会话 runOnce 便宜模型，输入新增 entry + 该会话旧条目，输出 zod 增量，调 Step 1 的合并函数写回状态卡。

## 依赖上下文（接力棒输入）
- 前置 step 产出：[step1-store.md] 合并函数 `mergeIncrement(card, increment)` 与增量 zod schema；`getStaleConversations(groupId)` 返回待抽会话及上次提炼位置
- 现状：`electron/main/agents/agent-worker.ts:108-160 handleTask` 分发；runOnce 样例 `agent-worker.ts:400-550 handleGroupDigestTask`（输入组装 + 模型回退链 `payload.modelSelection → ai.xxxModelSelection → ai.defaultModelSelection` :411-413）；`pi/run-once.ts:57 runOnce`（maxTurns/revive）
- 输入读取：`session-history-reader.ts readSessionBranchEntries`（唯一合规入口，不得直接解析 JSONL）+ `transcript-adapter` 清洗
- 模型档位：`settings-types.ts:90-95` 现有五档，照抄 `categorizeModelSelection` 模式新增 `stateModelSelection`

## 计划改动
- [ ] `settings-types.ts`：加 `stateModelSelection` 档位 + 默认值接入设置 UI（设置页模型档位列表补一行）
- [ ] `task-types.ts`：加 `STATE_EXTRACT` TaskType
- [ ] `agent-worker.ts`：新 handler `handleStateExtractTask(payload {workspaceId, groupId, conversationIds})`：
  - 逐会话（通常 1-2 个）循环：readSessionBranchEntries 读上次位置之后的 entry → transcript-adapter 清洗 → 组装 prompt（新增逐字稿 + 该会话已产出旧条目列表 + 输出 schema 说明）
  - 定义输出工具（ToolDef + zod）：`emit_state_increment` — `{topicChange?, completed[], inProgress[], decisions[], blockers[], nextSteps[], openQuestions[], resolved[]}`（resolved = 声明完成的旧条目 id，供条目迁移）
  - runOnce 跑便宜模型（maxTurns 小，如 5；revive 1 次即可）
  - `schema.parse` 校验 → `mergeIncrement` 合并 → 写状态卡（更新 sourcesSeen 到本次读到位置）
  - 单会话失败继续下一个，不整批失败
- [ ] prompt 要点（新文件 `electron/main/services/memory/state-extract-prompt.ts`，对齐 group-digest-prompt.ts 模式）：只抽取事实，"建议过/计划过"不等于 completed；用户原话才可触发 topicChange 并标注来源；每条带来源 entry uuid
- [ ] `bun run build:electron` + 手动验证：对已有测试组触发任务，检查状态卡条目产出与 sourcesSeen 更新

## 实施回填（做完后填）

### 实际改动
- 与计划差异：
- 改动文件清单：

### 给下一步的接力棒
- 关键签名 / 数据结构：
- 下个 step 该从哪里继续：
- 待办或已知限制：
