# 用量徽章改造：上下文构成 + 按价目表计费 设计

**背景**：输入框用量弹窗目前显示工具调用次数（用户认为无用）；pi 侧 `provider.ts` 模型 cost 全填 0，`totalCostUsd` 是假数据，费用从未真实显示。用户希望看到上下文构成（提示词/工具定义/消息各占多少 token）和按人民币价目表换算的费用。

**目标**：
1. 弹窗头部显示上下文构成明细（估算 + 按真实 totalTokens 校准）
2. 弹窗会话累计、数据中心用量页显示按价目表换算的费用（¥，前端现算不落盘）
3. 删除 UsageByTool 工具次数块

## 架构

### 1. 上下文构成（主进程估算，落盘 `ContextSnapshot.categories`）

pi harness 不记构成（jsonl 只有消息原文），LLM usage 只有总数 → 唯一路径是估算：

- **提示词**：`pi-session.ts` start() 拼装时各段独立，直接按段估 token（一次计算，会话期不变）
  - 细分：agent.md（项目+用户合并）、skill 索引、人格与纪律（coreProfile + groupContext + 各 APPEND）
- **工具定义**：tools 数组 schema JSON.stringify 后估算（启动时一次）
- **消息**：CTX 快照时点 `session.buildContext()` 取 AgentMessage[]，按 user / assistant / tool_result 分桶估算（每次快照算）
- **估算器**：CJK 字符 ×1 + 其他字符 ×0.25 的启发式
- **校准**：Σ估算按真实 `totalTokens`（input + cacheRead + cacheWrite）等比缩放，构成合计恒等于显示的上下文占用；占比可信，绝对值误差 ±20% 内

`categories` 扁平存 `Array<{ name, tokens }>`，name 用前缀分组：
`提示词·agent.md` / `提示词·skill 索引` / `提示词·人格纪律` / `工具定义` / `消息·用户` / `消息·助手` / `消息·工具结果`

### 2. 价目表（挂 `ModelProfile.piModels` 条目，目录查表兜底）

```ts
pricing?: { input: number; output: number; cacheRead: number }  // 元/百万 tokens
```

- **费用公式**：`(inputTokens×input + outputTokens×output + cacheReadTokens×cacheRead) / 1_000_000`
- **缓存写存储费不算**（GLM 限时免费、DS 未报价）；缓存命中计价（用户拍板 A）
- **前端现算不落盘**：改价后所有历史显示自动重算；GLM 走 Coding Plan，费用纯参考
- **预填**：模型目录（`pi-model-catalog`）给已知模型默认 pricing，`entry.pricing ??` 目录价；设置 UI 可覆盖
  - GLM-5.3：8 / 28 / 2；GLM-5.3-Flash：0.8 / 2.8 / 0.23
  - deepseek-flash：1 / 4 / 0.02；deepseek-v4-pro：4.5 / 13.5 / 0.15（DS 高峰 ×2 不做，取空闲档）
- **计算口径**：
  - 弹窗会话累计：聚合 `entries[].modelUsage` 分桶，按各模型 pricing 计算后求和（准）
  - 用量页会话行：`conv.modelSelection` 对应 pricing 单价 × 会话汇总 token（近似，中途切模型不区分）；汇总行 = 各行求和
  - 无 pricing 的模型不计入费用（显示「—」或不显示）

### 3. UI

**弹窗**（UsagePopoverContent）：
- UsageSummaryHeader 下方加构成明细：主行 `提示词 12k · 工具定义 8k · 消息 148k`，次行细分（agent.md/skill 索引/人格纪律；用户/助手/工具结果），标注「估算」
- 会话累计块加一行费用 `¥0.42`（tabular-nums）
- 删除 `UsageByTool` 组件及引用

**用量页**（usage-panel.tsx）：
- 汇总行：`合计 X tokens · 输入… · 输出… · 缓存读… · ≈¥Y · N 个会话`
- 会话行右侧合计下方（或旁边）小字 `¥Y`；页面说明文案补「费用按模型价格换算（API 口径，可编辑）」
- 小字提示「按 API 价格换算」

**设置页**（pi-model-row.tsx）：
- PiModelRow 加价格编辑（三个小输入框：输入/输出/缓存命中，元/百万）；空 = 用目录默认

## 模块边界

| 模块 | 文件 |
|------|------|
| 类型 | `types/settings.ts`、`app/settings/pi-model-row.tsx`（PiModelEntry 同步）、`types/usage.ts`（categories 已有） |
| 模型目录 | `lib/pi-model-catalog.ts`（前端）、`electron/main/agents/pi/model-catalog.ts`（主进程，如需） |
| 构成估算 | `electron/main/agents/pi-session/pi-session.ts`（段落/tools 采集）、`usage-extractor.ts`（快照时算消息分桶+校准+写 categories） |
| 费用计算 | 前端 util（usage-utils 或新建 `pricing-utils.ts`），输入 settings + token 数 |
| 弹窗 | `components/agent-chat/usage-badge/`：UsagePopoverContent / UsageSummaryHeader / 删 UsageByTool |
| 用量页 | `app/data-center/usage-panel.tsx` |

## 数据流

构成：PiSession.start()（段字符数 + tools schema）→ 实例缓存 → 854 行快照时 buildContext 分桶 → extractPiContextSnapshot 接收构成参数写入 categories → JSONL CTX 行 → usage-service latestContext → 前端 resolveContext → 弹窗。

费用：settings（piModels.pricing + 目录兜底）→ 前端组件按 usage token 现乘 → 弹窗/用量页显示。

## 错误处理 / 边界

- 旧 CTX 快照 categories 为空 → 前端判空不渲染构成块
- buildContext 失败/消息为空 → 该次快照 categories 留空，不影响 totalTokens
- 模型无 pricing（目录不识别且未手填）→ 费用显示「—」
- 估算器对图片等二进制内容按文本兜底（取 text 部分字符数）
- PiModelRow 价格输入非法（非数字/负数）→ 不写入（保留原值）

## 未决问题

- 模型 id 精确匹配规则实施时对齐目录现有条目（如 glm-5.3 大小写、deepseek-flash 别名 v4.1-flash）
