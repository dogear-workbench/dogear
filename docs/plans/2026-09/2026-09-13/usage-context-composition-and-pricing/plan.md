# 用量徽章改造：上下文构成 + 按价目表计费 实施计划

**目标**：弹窗显示上下文构成明细（估算+校准）、弹窗与用量页显示按价目表换算的 ¥ 费用、删工具次数块。

**架构思路**：构成由主进程在 CTX 快照时点估算（提示词段/tools schema 启动时算一次，消息分桶每快照算，按真实 totalTokens 等比校准）写入 `ContextSnapshot.categories` 复用现有管道；费用由前端按 `piModels[].pricing`（元/百万，目录查表兜底）现算不落盘；pi harness 不记构成、provider cost 恒 0，估算是唯一路径。设计详见 `../usage-context-composition-and-pricing-design.md`。

**涉及模块**：`types/settings.ts`、`app/settings/pi-model-row.tsx`、`lib/pi-model-catalog.ts`、`electron/main/agents/pi-session/{pi-session,usage-extractor}.ts`、`components/agent-chat/usage-badge/*`、`app/data-center/usage-panel.tsx`

## 步骤索引

- [x] [Step 1: 价目表类型 + 设置 UI](./step1-pricing-settings.md) — piModels 条目加 pricing、目录默认价、PiModelRow 编辑框
- [x] [Step 2: 主进程构成估算](./step2-context-categories.md) — 提示词段/tools/消息分桶估算写入 categories
- [ ] [Step 3: 前端构成与费用显示](./step3-frontend-display.md) — 弹窗构成明细+费用、删 UsageByTool、用量页费用

## 全局决策

- **pricing 单位**：元/百万 tokens，字段 `{ input, output, cacheRead }`；缓存写存储费不算
- **费用公式**：`(in×input + out×output + cacheRead×cacheRead价) / 1_000_000`；无 pricing 不显示
- **查价优先级**：`entry.pricing`（手填）> 模型目录默认价（GLM-5.3: 8/28/2；GLM-5.3-Flash: 0.8/2.8/0.23；deepseek-flash: 1/4/0.02；deepseek-v4-pro: 4.5/13.5/0.15，DS 取空闲档）
- **categories name 规范**：`提示词·agent.md`、`提示词·skill 索引`、`提示词·人格纪律`、`工具定义`、`消息·用户`、`消息·助手`、`消息·工具结果`（UI 按 `·` 前缀分组）
- **估算公式**：CJK 字符 ×1 + 其他字符 ×0.25；Σ估算按真实 totalTokens 等比校准
- **费用格式**：`formatCost`——≥100 取整、≥1 两位小数、<1 三位小数，前缀 ¥
- **旧数据兼容**：categories 为空的 CTX 快照不渲染构成块；无 pricing 显示「—」或不显示
