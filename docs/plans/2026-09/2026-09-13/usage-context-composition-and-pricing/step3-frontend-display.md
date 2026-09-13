---
step: 3
title: 前端构成与费用显示
status: pending
---

## 目标
弹窗显示上下文构成明细与 ¥ 费用，删工具次数块；用量页显示费用并标注换算口径。

## 依赖上下文（接力棒输入）
- 设计文档：`../../usage-context-composition-and-pricing-design.md` §2 §3
- Step1 产出：`piModels[].pricing` 类型 + `lookupPricing(modelId)`（`lib/pi-model-catalog.ts`）
- Step2 产出：CTX 快照 `categories: Array<{ name, tokens }>`（name 前缀 `提示词·`/`工具定义`/`消息·`），经 `usage.latestContext` 到前端
- 现状：`components/agent-chat/usage-badge/UsagePopoverContent.tsx`（会话累计块 / 当前轮 / 每轮明细 / UsageByTool）；`UsageSummaryHeader.tsx`（上下文 used/limit/pct）；`resolveContext`（`usage-utils.ts:32`）已透传 latestContext 但 ContextInfo 未带 categories；`app/data-center/usage-panel.tsx:246-248` 汇总行、`:283-289` 会话行
- settings 取价：`useSettingsStore`；会话模型：`conv.modelSelection` / entry.modelUsage 分桶

## 计划改动
- [ ] 新建 `components/agent-chat/usage-badge/pricing-utils.ts`：`lookupEntryPricing(settings, modelSelection)`（entry.pricing > 目录兜底）、`calcCost(tokens, pricing)`、`formatCost(v)`（≥100 整数 / ≥1 两位 / <1 三位小数，前缀 ¥）
- [ ] `usage-utils.ts` `ContextInfo` 加 `categories`，`resolveContext` 透传
- [ ] `UsageSummaryHeader.tsx` 下加构成明细块：主行「提示词 X · 工具定义 Y · 消息 Z」，次行按 `·` 后缀细分，尾部标注「估算」；categories 空/缺失整块不渲染
- [ ] `UsagePopoverContent.tsx`：会话累计块加费用行——聚合 `entries[].modelUsage` 按各模型 pricing 计算求和（无 pricing 模型不计），显示 `¥N`；删除 `UsageByTool` 组件及 import；删文件 `UsageByTool.tsx`
- [ ] `app/data-center/usage-panel.tsx`：rows/summary 已有 inputTokens/outputTokens/cacheReadTokens（本会话上一轮改动加的），按 `conv.modelSelection` pricing 计算：汇总行加 `≈¥N`、会话行合计旁小字 `¥N`；顶部说明补「费用按模型价格换算（API 口径，设置中可编辑）」
- [ ] 视觉自查：弹窗宽度 460px 内构成/费用行不溢出

## 实施回填（做完后填）

### 实际改动
- 与计划差异：
- 改动文件清单：

### 给下一步的接力棒
- 关键签名 / 数据结构：
- 下个 step 该从哪里继续：
- 待办或已知限制：
