---
step: 3
title: 前端构成与费用显示
status: done
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
- [x] 新建 `components/agent-chat/usage-badge/pricing-utils.ts`：`lookupEntryPricing(settings, modelSelection)`（entry.pricing > 目录兜底）、`calcCost(tokens, pricing)`、`formatCost(v)`（≥100 整数 / ≥1 两位 / <1 三位小数，前缀 ¥）
- [x] `usage-utils.ts` `ContextInfo` 加 `categories`，`resolveContext` 透传
- [x] `UsageSummaryHeader.tsx` 下加构成明细块：主行「提示词 X · 工具定义 Y · 消息 Z」，次行按 `·` 后缀细分，尾部标注「估算」；categories 空/缺失整块不渲染
- [x] `UsagePopoverContent.tsx`：会话累计块加费用行——聚合 `entries[].modelUsage` 按各模型 pricing 计算求和（无 pricing 模型不计），显示 `¥N`；删除 `UsageByTool` 组件及 import；删文件 `UsageByTool.tsx`
- [x] `app/data-center/usage-panel.tsx`：rows/summary 已有 inputTokens/outputTokens/cacheReadTokens（本会话上一轮改动加的），按 `conv.modelSelection` pricing 计算：汇总行加 `≈¥N`、会话行合计旁小字 `¥N`；顶部说明补「费用按模型价格换算（API 口径，设置中可编辑）」
- [x] 视觉自查：弹窗宽度 460px 内构成/费用行不溢出

## 实施回填（做完后填）

### 实际改动
- 与计划差异：新增 `lookupModelPricing(settings, modelId)`（计划只列了 lookupEntryPricing/calcCost/formatCost 三个函数）——弹窗会话费用需按 modelUsage 桶的请求模型 id 查价且尊重手填价优先，若给 UsageBadge→UsagePopoverContent 传 modelSelection 需改 ChatInputArea/UsageBadge 两个越界文件，改为在 pricing-utils 内遍历 profiles 按 id 匹配手填价、目录兑底，零越界；其余完全按计划。
- 改动文件清单：
  - 新建 `components/agent-chat/usage-badge/pricing-utils.ts`：`lookupEntryPricing` / `lookupModelPricing` / `calcCost` / `sumSessionCost`（弹窗会话费用聚合）/ `formatCost`
  - `usage-utils.ts`：`ContextInfo` 加 `categories`，`resolveContext` 透传（`?? []` 兼容旧快照）
  - `UsageSummaryHeader.tsx`：占用行下加构成明细块（主行 join(' · ') + （估算）后缀，次行按主行分组缩进），`groupCategories` 按 `·` 前缀聚合、无 `·` 自成一主行，categories 空则整块不渲染
  - `UsagePopoverContent.tsx`：会话累计 meta 行尾追加 `· ¥N`（`sumSessionCost`，无任何可计价模型不显示）；删 UsageByTool import/使用，修正容器注释
  - 删除 `UsageByTool.tsx`
  - `usage-panel.tsx`：组件外 `rowCost()`（conv.modelSelection ?? defaultModelSelection → lookupEntryPricing → calcCost），rows 每行带 `cost`，汇总行加 `· ≈¥N`（各行求和），会话行合计下小字 `¥N`，顶部说明补「费用按模型价格换算（API 口径，设置中可编辑）」
- 验证：`bun run lint` 0 errors（84 warnings 均为既有）；`bun test components/agent-chat/usage-badge/` 7 pass；`tsc -p tsconfig.json --noEmit` 0 错误

### 给下一步的接力棒
- 关键签名 / 数据结构：
  - `lookupEntryPricing(settings, selection: ModelSelection)`：严格按 profileId→piModels.find(id===tier)，entry.pricing > lookupPricing
  - `lookupModelPricing(settings, modelId)`：任意 profile 手填价优先 → 目录价（供弹窗按 modelUsage key 查价）
  - `sumSessionCost(entries, settings): number | null`：null = 无任何可计价模型（UI 不显示）
  - `ContextInfo.categories: Array<{name, tokens}>`，空数组 = 旧快照
  - usage-panel rows 行带 `cost: number | null`，summary 带 `cost`（null = 全部无价）
- 下个 step 该从哪里继续：本计划共 3 步，此为末步，无后续 step；设置页价格编辑已在 step 1 完成
- 待办或已知限制：弹窗会话费用按手填价匹配时跨 profile 同 id 取首个手填（failover 跨 profile 且同 id 不同价的场景，实际罕见）；费用大数无千分位分隔（formatCost 直接取整）
