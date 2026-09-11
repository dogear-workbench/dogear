---
step: 3
title: 注入轻量化
status: done
---

## 目标
开局注入从「完整状态卡」改为统一轻量头（topic + 未提炼标题 + 强指引），移除 start() 上的触发调用，会话启动回归亚秒级。

## 依赖上下文（接力棒输入）
- 前置 step 产出：[step2-read-sync.md] ensureGroupFresh 已可用，ReadGroupBackground 已读时同步
- 当前关键文件状态：`electron/main/agents/group-context-builder.ts` — 现注入「### 话题状态」完整卡四段（topic/条目/未提炼列表/指引），裁剪逻辑每类 ≤8、状态段 ≤2400 字符；`electron/main/agents/pi-session/pi-session.ts:395-400` needGroupContext 分支 `await triggerStateExtractForSessionStart(...)`
- 关键决策回顾：统一轻量头（fresh 也走此形态，不再两态）；完整卡不进 systemPrompt；裁剪逻辑随完整卡注入一起退役

## 计划改动
- [ ] `pi-session.ts` start()：移除 triggerStateExtractForSessionStart 调用（含 import 清理）
- [ ] `group-context-builder.ts`：注入模板改轻量头 = 话题一句话（topic + 确立时间）+ 未提炼会话标题列表（保留现有零模型派生与条数上限）+ 强指引「本会话属于话题 X。开局第一轮先调 dogear__ReadGroupBackground 获取话题最新状态（存在未提炼会话时会自动同步，可能需等待）；深挖某会话可 dogear__ReadReferenceSession」
- [ ] 删除完整卡注入与裁剪函数（每类 ≤8 / 2400 字符等）；未提炼为空时指引弱化为「开局先调 ReadGroupBackground」即可
- [ ] 检查 `### 话题状态（尚未初始化）` 分支（无卡时）与新轻量头形态合并统一

## 实施回填（做完后填）

### 实际改动
- 与计划差异：①指引「本会话属于话题 X」落地为「本会话属于上方话题。」（topic 全文已在【话题背景】展示不复述；X 若指组 title 依赖 step4 机制）；②未提炼为空时指引弱化为省略 syncNote 括注，主体句保留；③无卡分支原 ListSiblingSessions 提示随合并统一移除（未提炼列表已内联）
- 改动文件清单：electron/main/agents/pi-session/pi-session.ts（删 start() 触发调用与 import，开局零触发零等待）；electron/main/agents/group-context-builder.ts（buildTopicStateSection 重写为统一轻量头：话题背景/未提炼会话/指引三段；删 MAX_ENTRIES_PER_CATEGORY/STATE_SECTION_MAX_CHARS/CATEGORY_ORDER/isEmptyCard/pickRecentEntries/entriesSectionText/applyBudget/withSource；CATEGORY_LABELS/fmtTs/sourceLabel/topicOriginLabel/deriveStaleList/staleListText 导出保留供 reference-tools 消费）；electron/main/services/memory/state-extract-trigger.ts（整删 triggerStateExtractForSessionStart + StateExtractTriggerOutcome/StateExtractTriggerResult，唯一导出剩 ensureGroupFresh）
- 验收：lint 0 errors、build:electron 通过；抽查三个文件 diff 均合格

### 给下一步的接力棒
- 关键签名 / 数据结构：buildTopicStateSection(wsId, groupId) 轻量头段结构「### 话题状态 →【话题背景】(可选)→【最近未提炼会话】(可选)→【指引】(恒有)」；轻量头只读 topicHistory，不读 entries/updatedAt；state-extract-trigger.ts 对外仅 ensureGroupFresh + EnsureGroupFreshResult
- 下个 step 该从哪里继续：step4 命名联动若想把指引升级为「本会话属于话题『{组title}』」，改动点在 buildTopicStateSection 的 topicRef 一行（注意组 title 可能仍为空的 fallback）；initialTitle 消费在 mergeIncrementAndSave 调用侧或 handler（step1 接力棒：trim 判断 + try/catch 不阻塞卡写入）
- 待办或已知限制：topic.text 全文进 systemPrompt 无截断（与旧注入一致）；无 GUI 轻量头渲染未经人眼确认；本机 .dogear/state-extract-prompt.md 旧版提示词 caveat 仍有效（step1 起）
