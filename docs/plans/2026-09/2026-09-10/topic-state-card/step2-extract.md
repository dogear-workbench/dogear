---
step: 2
title: 增量抽取任务
status: done
---

## 目标
新增 STATE_EXTRACT 后台任务：逐会话 runOnce 便宜模型，输入新增 entry + 该会话旧条目，输出 zod 增量，调 Step 1 的合并函数写回状态卡。

## 依赖上下文（接力棒输入）
- 前置 step 产出：[step1-store.md] 合并函数 `mergeIncrement(card, increment)` 与增量 zod schema；`getStaleConversations(groupId)` 返回待抽会话及上次提炼位置
- 现状：`electron/main/agents/agent-worker.ts:108-160 handleTask` 分发；runOnce 样例 `agent-worker.ts:400-550 handleGroupDigestTask`（输入组装 + 模型回退链 `payload.modelSelection → ai.xxxModelSelection → ai.defaultModelSelection` :411-413）；`pi/run-once.ts:57 runOnce`（maxTurns/revive）
- 输入读取：`session-history-reader.ts readSessionBranchEntries`（唯一合规入口，不得直接解析 JSONL）+ `transcript-adapter` 清洗
- 模型档位：`settings-types.ts:90-95` 现有五档，照抄 `categorizeModelSelection` 模式新增 `stateModelSelection`

## 计划改动
- [x] `settings-types.ts`：加 `stateModelSelection` 档位 + 默认值接入设置 UI（设置页模型档位列表补一行）
- [x] `task-types.ts`：加 `STATE_EXTRACT` TaskType
- [x] `agent-worker.ts`：新 handler `handleStateExtractTask(payload {workspaceId, groupId, conversationIds})`：
  - 逐会话（通常 1-2 个）循环：readSessionBranchEntries 读上次位置之后的 entry → transcript-adapter 清洗 → 组装 prompt（新增逐字稿 + 该会话已产出旧条目列表 + 输出 schema 说明）
  - 定义输出工具（ToolDef + zod）：`emit_state_increment` — `{topicChange?, completed[], inProgress[], decisions[], blockers[], nextSteps[], openQuestions[], resolved[]}`（resolved = 声明完成的旧条目 id，供条目迁移）
  - runOnce 跑便宜模型（maxTurns 小，如 5；revive 1 次即可）
  - `schema.parse` 校验 → `mergeIncrement` 合并 → 写状态卡（更新 sourcesSeen 到本次读到位置）
  - 单会话失败继续下一个，不整批失败
- [x] prompt 要点（新文件 `electron/main/services/memory/state-extract-prompt.ts`，对齐 group-digest-prompt.ts 模式）：只抽取事实，"建议过/计划过"不等于 completed；用户原话才可触发 topicChange 并标注来源；每条带来源 entry uuid
- [x] `bun run build:electron` + 手动验证：对已有测试组触发任务，检查状态卡条目产出与 sourcesSeen 更新

## 实施回填（做完后填）

### 实际改动
- 与计划差异：
  1. payload 用 `conversations: {conversationId, sessionId, mtime}[]` 而非纯 `conversationIds`：mergeIncrementAndSave 的 dirtySources 与读逐字稿都需要 sessionId+mtime，调用方（Step 3）本就从 getStaleConversations 拿到该结构，直接传更简单。
  2. resolved 候选池扩展为「本组 inProgress 条目 ∪ 本会话旧条目」而非仅本会话条目：mergeIncrement 的 resolved 迁移是在全卡 inProgress 里查 id，池子与迁移语义对齐后跨会话声明完成才能生效。
  3. emit_state_increment 工具 handler 内加了轻量保真校验（uuid ∈ 本次输入消息集合；resolved id ∈ 候选池），不合法返回 isError 让模型重试；计划只要求 zod parse（由 toPiTools 层完成）。
  4. 无新增可抽消息时会话不跳过而是用空增量走 mergeIncrementAndSave（只推 sourcesSeen），避免此类会话每轮重复进入 stale 名单白跑。
  5. state-extract-prompt.ts 只导出 DEFAULT + loadStateExtractPrompt（播种式读取）；save 未导出——当前无提示词编辑 UI 消费方，不留死代码，Step 4+ 接入时再补（categorize-prompt.ts 可照抄）。
- 改动文件清单：
  - `electron/main/services/settings-types.ts`：ai 新增 `stateModelSelection: ModelSelection | null` 档位 + DEFAULT_SETTINGS 默认 null
  - `types/settings.ts`：前端镜像同步
  - `electron/main/services/settings-service.ts`：migratePiProfiles 的 ModelSelection 字段列表加 stateModelSelection（旧 tier 迁移覆盖）
  - `app/settings/page.tsx`：基础设置 tab 新增「话题状态提炼模型」行（照 parseModelSelection 模式）+ deleteProfileById 的 clearIfMatch 覆盖新档位
  - `electron/main/agents/task-types.ts`：TaskType.STATE_EXTRACT + StateExtractPayload
  - `electron/main/services/memory/state-extract-prompt.ts`：新增（DEFAULT_STATE_EXTRACT_PROMPT + loadStateExtractPrompt 播种式读取）
  - `electron/main/agents/agent-worker.ts`：switch 加 STATE_EXTRACT 分支 + handleStateExtractTask

### 给下一步的接力棒
- 关键签名 / 数据结构：
  - `StateExtractPayload { workspaceId, groupId, conversations: {conversationId, sessionId, mtime}[], modelSelection? }`（task-types.ts）
  - handler 返回：`{ groupId, processed, skipped, failed, failures: [{conversationId, error}], tier?, profileName?, cancelled?, error? }`（模型解析失败时 processed=0/failed=conversations.length/error）
  - 任务提交即拿 getStaleConversations 输出原样填 conversations；单会话失败不影响其他会话已落盘产出，失败会话不推进 sourcesSeen（下次仍判 stale，合并去重保证重抽幂等）
  - emit_state_increment = defineTool('emit_state_increment', …, StateIncrementSchema, handler)，handler 闭包捕获 increment；revive(1 次) 在未捕获时提醒重试；maxTurns=5
- 下个 step 该从哪里继续：Step 3 在 pi-session.ts start() 的 needGroupContext 分支用 submitTask(STATE_EXTRACT) + 同步等待（Promise.race 封顶 10s）+ in-flight 按组去重；group-context-builder 读侧用 readTopicStateCard
- 待办或已知限制：
  - emit_state_increment 未注册 tool-registry（内部工具，不进主会话动态工具列表，符合预期）
  - STATE_EXTRACT 未接入 scheduler 内置任务（模型档位在设置页配置，不走 BuiltinTaskDetailSection）
  - 单会话 prompt 无长度裁剪：全量新增逐字稿直接拼入，超长会话依赖模型上下文窗口；如遇极端长会话可在组装层加尾 N 条截断（合并去重使截断无害）
  - 保真校验只查 uuid 存在性，不校验 uuid 对应消息的角色/内容相关性（模型张冠李戴时无法机检）
