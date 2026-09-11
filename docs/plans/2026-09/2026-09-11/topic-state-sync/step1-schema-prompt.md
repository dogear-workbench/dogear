---
step: 1
title: schema 与提示词地基
status: done
---

## 目标
resolved 扩展跨类退休、增量 schema 加 initialTitle、抽取提示词加范围/退休/命名约束——数据与文本层地基，后续 step 全部依赖。

## 依赖上下文（接力棒输入）
- 设计决策：docs/plans/2026-09/2026-09-11/topic-state-sync-design.md「拍板决策」4/5/6 条
- 当前关键文件状态：`electron/main/services/memory/state-card.ts:73-95` StateIncrementSchema（六类 + resolved: string[]）；mergeIncrement 在 `:288` 附近（逐类 append + resolved 仅 inProgress→completed 迁移 + topicChange 分流）
- 关键决策回顾：退休落盘形态倾向「移入已完成区 + 文本后缀（已解决）」保留痕迹；initialTitle 仅在 group.title 为空时生效一次

## 计划改动
- [ ] `state-card.ts` StateIncrementSchema：加 `initialTitle: z.string().optional()`；resolved 语义注释更新（跨类）
- [ ] `state-card.ts` mergeIncrement：resolved 匹配范围从 inProgress 扩到全部六类；被解决条目移入 completed 区、text 加「（已解决）」后缀；处理 initialTitle（暂存到卡或由调用方消费，见接力棒）
- [ ] `state-extract-prompt.ts` DEFAULT_STATE_EXTRACT_PROMPT：加三处约束——a) 只抽本话题内事实，跨话题稳定信息（长期偏好/身份）不抽，那是记忆系统职责；b) 现有卡中被本次内容取代的条目，其 uuid 填入 resolved；c) 若组尚无标题且本次逐字稿足以概括话题，填 initialTitle（否则留空）
- [ ] 确认 agent-worker.ts STATE_EXTRACT handler 对新字段的透传路径（emit_state_increment 工具 schema 若单独定义需同步）

## 实施回填（做完后填）

### 实际改动
- 与计划差异：两处配套改动超出字面计划但在范围内——a) agent-worker.ts 保真校验 oldEntries 池从「inProgress ∪ 本会话旧条目」扩为全组六类（不做则新提示词的跨类 resolved 标记会被校验拒绝）；b) handler prompt「本次输入」段新增「当前组标题」行（不给标题信息模型无从判定 initialTitle 输出条件）。initialTitle 采用「调用方消费」方案不进卡，background.md 无 schema 迁移
- 改动文件清单：electron/main/services/memory/state-card.ts（StateIncrementSchema 加 initialTitle + resolved 跨类注释；mergeIncrement resolved 遍历六类 splice → 加「（已解决）」后缀（endsWith 幂等防御）→ push 进 completed）；electron/main/services/memory/state-extract-prompt.ts（范围约束/退休引导/initialTitle 三处约束 + 输出格式段同步）；electron/main/agents/agent-worker.ts（oldEntries 六类池 + 组标题行）
- 验收：lint 0 errors、build:electron 通过

### 给下一步的接力棒
- 关键签名 / 数据结构：`StateIncrement.initialTitle?: string`（z.string().min(1).optional()，不进卡）；mergeIncrement(card, increment, opts: { conversationId: string; ts?: string }): TopicStateCard，resolved 六类退休；退休后条目 text 加后缀 → id 重派生（sha1(text, source, ts)），旧 id 引用自然失效不会重复退休
- 下个 step 该从哪里继续：Step 4 命名联动在 mergeIncrementAndSave 调用侧或 handler 消费 increment.initialTitle（title 空 → updateGroup 生效一次，建议 trim 判断 + try/catch 不阻塞卡写入）；handler prompt「本次输入」段现为 groupId/conversationId/sessionId/当前组标题四行
- 待办或已知限制：本机 `.dogear/state-extract-prompt.md` 磁盘旧版优先于新 DEFAULT，新约束在本机实际抽取不生效——用户配置区文件未动，建议用户确认后删除重新播种或后续做提示词版本迁移
