# 用量徽章改造：上下文构成 + 按价目表计费 实施计划

**目标**：弹窗显示上下文构成明细（估算+校准）、弹窗与用量页显示按价目表换算的 ¥ 费用、删工具次数块。

**架构思路**：构成由主进程在 CTX 快照时点估算（提示词段/tools schema 启动时算一次，消息分桶每快照算，按真实 totalTokens 等比校准）写入 `ContextSnapshot.categories` 复用现有管道；费用由前端按 `piModels[].pricing`（元/百万，目录查表兜底）现算不落盘；pi harness 不记构成、provider cost 恒 0，估算是唯一路径。设计详见 `../usage-context-composition-and-pricing-design.md`。

**涉及模块**：`types/settings.ts`、`app/settings/pi-model-row.tsx`、`lib/pi-model-catalog.ts`、`electron/main/agents/pi-session/{pi-session,usage-extractor}.ts`、`components/agent-chat/usage-badge/*`、`app/data-center/usage-panel.tsx`

## 步骤索引

- [x] [Step 1: 价目表类型 + 设置 UI](./step1-pricing-settings.md) — piModels 条目加 pricing、目录默认价、PiModelRow 编辑框
- [x] [Step 2: 主进程构成估算](./step2-context-categories.md) — 提示词段/tools/消息分桶估算写入 categories
- [x] [Step 3: 前端构成与费用显示](./step3-frontend-display.md) — 弹窗构成明细+费用、删 UsageByTool、用量页费用

## 全局决策

- **pricing 单位**：元/百万 tokens，字段 `{ input, output, cacheRead }`；缓存写存储费不算
- **费用公式**：`(in×input + out×output + cacheRead×cacheRead价) / 1_000_000`；无 pricing 不显示
- **查价优先级**：`entry.pricing`（手填）> 模型目录默认价（GLM-5.3: 8/28/2；GLM-5.3-Flash: 0.8/2.8/0.23；deepseek-flash: 1/4/0.02；deepseek-v4-pro: 4.5/13.5/0.15，DS 取空闲档）
- **categories name 规范**：`提示词·agent.md`、`提示词·skill 索引`、`提示词·人格纪律`、`工具定义`、`消息·用户`、`消息·助手`、`消息·工具结果`（UI 按 `·` 前缀分组）
- **估算公式**：CJK 字符 ×1 + 其他字符 ×0.25；Σ估算按真实 totalTokens 等比校准
- **费用格式**：`formatCost`——≥100 取整、≥1 两位小数、<1 三位小数，前缀 ¥
- **旧数据兼容**：categories 为空的 CTX 快照不渲染构成块；无 pricing 显示「—」或不显示

## 完成总结

三个 step 全部实施完毕（2026-09-13）：

1. **价目表**：`piModels` 条目支持 `pricing`（元/百万 tokens），目录内置 GLM/DS 默认价（别名+变体后缀匹配），设置页价格徽标展开三框编辑覆盖；主进程 normalize 白名单同步保留（commit eb6eb0c2）
2. **构成估算**：CTX 快照写入 `categories`（提示词三分桶/工具定义/消息三分桶，CJK×1+其他×0.25 估算后按真实 totalTokens 等比校准，合计恒等），随现有 JSONL → latestContext 管道透传（commit 72774115）
3. **前端显示**：弹窗构成明细块（主行+细分行+「估算」标注）、会话累计与用量页 ¥ 费用（分桶精确/单模型近似两档口径）、删 UsageByTool

实施中与计划的主要偏差：① lookupPricing 未照搬纯精确匹配（目录无用户实际 id，改为归一化+别名+剥变体后缀）；② step1 越界同步主进程 settings 三文件（normalize 白名单否则保存即丢）；③ step2 快照点拆同步记账+异步构成估算两段（时序修正）；③ step3 新增 lookupModelPricing 供弹窗按模型 id 查价（避免改 ChatInputArea/UsageBadge 越界）。

已知限制：工具定义估算未按 activeToolNames 过滤；快照含刚生成未进请求的 assistant 输出（<3% 失真，校准吸收）；弹窗跨 profile 同 id 取首个手填价；费用大数无千分位。
