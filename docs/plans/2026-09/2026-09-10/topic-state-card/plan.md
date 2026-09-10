# 话题状态卡 实施计划

**目标**：新会话开局通过 systemPrompt 直接注入条目化的话题状态卡（背景+当前状态+staleness 标注），替代现状"靠 agent 自觉调工具"的失忆体验。

**架构思路**：改造 background.md 为条目化状态卡（topic 版本链 + 增量条目区 + sourcesSeen），唯一触发点在开启会话时（轻度滞后同步抽、重度标注后异步抽），逐会话 runOnce 便宜模型抽取 zod 增量、纯代码合并。排除：活动流水文件、会话结束 hook 预热、轮次级同步、闲置判定（理由见设计文档「排除的选项」）。

**设计文档**：`docs/plans/2026-09/2026-09-10/topic-state-card-design.md`
**调研依据**：会话组共享区 `research/session-group-architecture.md`、`research/pi-ai-capabilities.md`

**涉及模块**：
- `electron/main/services/memory/background-store.ts`（状态卡存储）
- `electron/main/services/memory/group-context-builder.ts`（注入）
- `electron/main/agents/agent-worker.ts` + `task-types.ts`（抽取任务）
- `electron/main/services/settings-types.ts`（模型档位）
- `electron/main/agents/tools/reference-tools.ts`（ReadGroupBackground）
- `components/TopicPanel.tsx`、`components/agent-chat/ChatInputArea.tsx`（前端）

## 步骤索引

- [x] [Step 1: 状态卡数据模型与存储层](./step1-store.md) — background-store 重构：条目 schema、topic 版本链、sourcesSeen、代码合并
- [x] [Step 2: 增量抽取任务](./step2-extract.md) — 新 TaskType + 便宜模型档位 + 逐会话 runOnce 抽取 handler
- [x] [Step 3: 开启会话触发与注入](./step3-inject.md) — start 链 staleness 判定 + 同步/异步抽取 + systemPrompt 模板
- [ ] [Step 4: 工具适配与前端状态卡渲染](./step4-ui.md) — ReadGroupBackground 适配 + TopicPanel 条目渲染 + topicChange 待确认
- [ ] [Step 5: 用户快捷按钮](./step5-buttons.md) — ChatInputArea「记一笔/这事做完了」→ user 条目

## 全局决策

- **状态卡沿用 background.md 文件名**，schema 升级；旧格式（4 字段）读取时自动转换：progress/keyDecisions/openQuestions → 初始条目（source 标 `legacy`），topic 保留进版本链首条。
- **条目结构**：`{id, text, source, ts}`；source = `convId#entryUuid`（会话抽取）| `user`（按钮/手动）| `legacy`（旧格式迁移）。
- **条目类别**：`completed / inProgress / decisions / blockers / nextSteps / openQuestions`（六类，openQuestions 与 uncertainties 合并为前者）。
- **topic 版本链**：`{text, source, ts}[]`，末位为当前生效；用户原话来源直接生效，模型推断来源进 `pendingTopicChanges` 待确认。
- **新 TaskType**：`STATE_EXTRACT`；模型档位键名 `stateModelSelection`（照抄 categorize 模式 + 三级回退）。
- **抽取输出走 tool call + zod parse 校验**，不做 constrainedSampling 透传（后补项）。
- **错误处理**：抽取失败/超时保持旧卡 + 滞后标注，不阻塞会话开启；conversations.json 写路径一律走 `withConversationTransaction`。
- **广播**：状态卡所有写入后调 `broadcastGroupDataChanged`（现有通路，TopicPanel 自动刷新）。
- 不写单测；主进程改动需 `bun run build:electron`。
