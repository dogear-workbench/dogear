---
step: 1
title: 工具描述治理
status: done
---

## 目标

精简全部 61 个工具描述，删除越界的行为约束/工作流/使用场景/禁止事项，只保留「工具是什么 + 输入输出说明 + 工具行为限制」。

## 依赖上下文（接力棒输入）

- 设计文档：`docs/plans/2026-08/2026-08-07/settings-ability-layout/settings-ability-layout-design.md` → 「工具描述治理」节
- 审计报告：共享区 `tool-description-audit.md`（每个工具的越界分析和建议精简描述）
- 工具文件目录：`electron/main/agents/tools/*-tools.ts`（14 个文件）

## 计划改动

### 记忆系统（5 个工具）

- [x] `memory-tools.ts` — RecallMemory：删「使用时机」「请优化关键词再调」，保留匹配规则说明
- [x] `memory-tools.ts` — SaveMemory（交互模式）：删「仅在用户明确表达…时调用」
- [x] `memory-tools.ts` — SaveMemory（autonomous 模式）：删「判断标准以调用方提示词为准」+「保真契约…宁可不写也不瞎造」
- [x] `memory-tools.ts` — ForgetMemory：删「仅在用户明确要求'忘记 XX'时使用」
- [x] `memory-tools.ts` — GetCoreProfile：删「任何 UpdateCoreProfile 调用前都必须先调本工具」+「空是正常状态…」
- [x] `memory-tools.ts` — UpdateCoreProfile：删「触发门槛极苛刻…大多数复盘不该调用本工具」整段

### Agent 协作（delegation 4 个 + reference 3 个 + group 3 个）

- [x] `delegation-tools.ts` — CreateSession：删第三句「创建后必须 WaitForMessage…」整句
- [x] `delegation-tools.ts` — WaitForMessage：删「常见用法：…」
- [x] `delegation-tools.ts` — StopSession：删「需要停止…请改用 SendMessage 表达意图」
- [x] `delegation-tools.ts` — SendMessage：删「普通往来消息不要设 delivery」
- [x] `reference-tools.ts` — ReadReferenceSession：删「原样交回给主 agent，不要臆断」
- [x] `reference-tools.ts` — ListSiblingSessions：删「拿到 sessionId 后可以配合…」
- [x] `reference-tools.ts` — ReadGroupBackground：删「此时可以退回 ReadGroupDigest…」
- [x] `group-tools.ts` — ListGroupFiles / ReadGroupFile / WriteGroupFile：加「共享区」作用域限定，避免与基础工具混淆

### 股票分析（stock-analysis 8 个 + stock 5 个 + announcement 2 个 + picking 1 个）

- [x] `stock-analysis-tools.ts` — CalcIndicators：删「使用场景」+「建议: 组合使用…不要只看单一指标」
- [x] `stock-analysis-tools.ts` — ScreenStocks：删「先用基本面…再技术条件精选」+「使用场景」，保留「候选超过 100 只自动截断」
- [x] `stock-analysis-tools.ts` — ListIndustries：删「必须先查询映射，不要直接猜」+「使用场景」，保留命名差异事实
- [x] `stock-analysis-tools.ts` — CompareIndustry：删「行业内有极端值时请以中位数为准」+「使用场景」
- [x] `stock-analysis-tools.ts` — GetFinancials / DetectSignals / EvalFormula / SimpleBacktest / GetFundFlow：各删「使用场景」句
- [x] `stock-tools.ts` — SearchStock / GetStockQuote / GetKLineData / GetTimeline / GetWatchlist：各删「使用场景」句
- [x] `stock-tools.ts` — ModifyWatchlist：删「⚠️ 此工具会修改用户数据，需要用户确认」+「使用场景」
- [x] `stock-announcement-tools.ts` — ListAnnouncements：删「调用 ReadAnnouncement 时必须把 url 原样复制…不要自己拼接」，保留域名安全限制
- [x] `stock-announcement-tools.ts` — ReadAnnouncement：删「请根据实际长度自行判断…不要不假思索地…」
- [x] `stock-picking-tools.ts` — PreheatLongTermPool：删「一次只传一个行业，多板块请分开多次调用」

### 文章（article 2 个）

- [x] `article-tools.ts` — ReadArticle：删「当用户引用了某篇文章时…以便分析、总结或回答问题」
- [x] `article-tools.ts` — ListArticles：删「需要读取具体内容时请使用 ReadArticle 工具」

### 后台任务工具（review / category / group-digest）

- [x] `review-tools.ts` — WriteReport：描述精简为「覆盖写入首页报告（updatedAt 由工具自动生成）。」
- [x] `review-tools.ts` — ListDigests：删「用它和报告的 updatedAt 对比…」
- [x] `review-tools.ts` — TraceSource：删「拿不准某条含义时用它查证；找不到则不要据此条臆断」
- [x] `review-tools.ts` — ReadReport：删「据此走全量分支」
- [x] `category-tools.ts` — ListCategories：删「决策前必须调一次」
- [x] `category-tools.ts` — SaveCategoryNew：删「总数达上限会被拒绝…先调 SaveCategoryMerge 腾位置」
- [x] `group-digest-tools.ts` — SaveGroupBackground：删「写这个之前一定要先写 SaveGroupDigest」

### 不改动（article-parse 5 个轻微越界 + 19 个纯描述）

- article-parse 的 ReadRawHtml / ReadCurrentContent / ReadParserRules / SaveParsedArticle / UpdatePlatformScript：低频使用，维持现状
- 19 个纯描述工具：不动

## 实施回填（做完后填）

### 实际改动

已全部完成，涉及 11 个工具文件、共 41 处描述精简（详见共享区 `step1-delivery.md`）。编译通过。

### 给下一步的接力棒

- 工具描述已精简为「是什么 + 怎么调 + 行为限制」，越界的行为约束/工作流/使用场景/禁止事项全部删除
- 被删除的约束（如「SaveMemory 仅用户明确要求时调用」「GetCoreProfile 调用前必须先调」「WriteReport 四段结构」等）需要在 Step 2+ 的提示词治理中迁移到对应 agent 的提示词里
- article-parse 5 个工具维持现状，如后续需要可单独处理
