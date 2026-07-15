---
step: 3
title: SKILL.md + 端到端验证
status: pending
---

## 目标

编写 `.claude/skills/stock-picking/SKILL.md`，让 agent 遇到"选股/圈股/科技板块选几只"类需求自动进 3 步 SOP。写完后手动跑一次完整流程，验证 agent 能按 SOP 走、能在降级时如实告知、能出结构化报告。

## 依赖上下文（接力棒输入）

从 Step 1/2 接过来的关键契约（**执行本 step 时先读这两个 step 的「给下一步的接力棒」段**）：
- `DataSourceExhaustedError` 的文案格式（Step 2 回填）
- `ScreenStocks` 工具在降级场景的 markdown banner 模板（Step 2 回填）
- Python 层 `_source` 值域（`'eastmoney' / 'sina' / 'ths'`，Step 1 回填最终确认）

**其他相关工具（本 step 只用不改）**：
- `stock-analysis-tools`: `CalcIndicators` / `DetectSignals` / `GetFinancials` / `CompareIndustry` / `ScreenStocks` / `ListIndustries`
- `stock-tools`: `SearchStock` / `GetStockQuote` / `GetKLineData` / `GetTimeline`
- `stock-announcement-tools`: `ListAnnouncements` / `ReadAnnouncement`

## 计划改动

### `.claude/skills/stock-picking/SKILL.md`（新增）

文件结构参考同 repo 已有 skill（比如 `.claude/skills/systematic-debugging/SKILL.md`），frontmatter + 分段正文。

**必须覆盖的段**：

1. **触发条件**（frontmatter description）：识别"选股 / 圈股 / X 板块选几只 / 找几只 X 类股票 / 帮我从 X 里挑"类请求
2. **3 步 SOP 骨架**（照抄设计文档 `../stock-picking-skill-design.md` 的 SOP 段）
3. **每步的工具调用清单**：
   - Step 1：只对话追问，不调工具；追问硬条件+软条件（列出候选提问模板）
   - Step 2：调 `ScreenStocks`（硬条件） → 遍历 `GetFinancials`（应用软条件） → 遍历 `DetectSignals` + `ListAnnouncements`（简表）
   - Step 3：对每只挑中的调 `GetKLineData` + `CalcIndicators` + `GetFinancials` + `ReadAnnouncement` 前 1-2 条 + `CompareIndustry`
4. **失败降级规则**（照抄设计文档三级失败表 + Step 2 回填的具体错误信号）：
   - 一级：看到 `_source: sina` banner → 报告里如实说明字段缺失
   - 一级：看到 `isError: true DATA_SOURCE_EXHAUSTED` → 直接告诉用户"数据源当前不可用，稍后重试"，**不给逃生舱、不装模作样**
   - 二级：`GetFinancials` 失败 → 跳过软条件筛，简表标注"未按 ROE 筛"
   - 三级：单只单维度失败 → 报告结尾列【数据缺口】表
5. **两条铁律**（写清楚 + 给反例）：
   - 缺数据必须留白，禁止敷衍话（反例："该公司盈利能力尚可"）
   - Step 2 逐股财报补拉必须**串行**（用完 `GetFinancials` 后等返回再调下一次，绝不并行；理由：`feedback-stock-api-rate-limit`）
6. **报告结构模板**（三段 + 数据缺口表）
7. **示例对话片段**（1-2 个短示例，展示 Step 1 追问 → Step 2 输出 → Step 3 报告）

### 端到端验证

- [ ] `bun run dev` 起来 dogear
- [ ] 在 agent-chat 里发起需求："帮我从科技板块选几只有近期利好的股票"
- [ ] 观察 agent 是否：
  - 走 Step 1 追问硬条件+软条件（不是直接跑工具）
  - 走 Step 2 输出增强简表（含 PE / ROE / 信号 / 公告标题）
  - 停下等用户挑重点
  - 走 Step 3 出结构化报告（三段 + 缺口表）
- [ ] 手动触发一次降级场景（临时把 `get_all_a_stocks` 主源 raise），观察 agent 是否：
  - 报告顶部提到"数据源走了新浪备源"
  - 明确说"未按 PE 筛"（缺 PE 字段）
  - 不瞎猜 PE 数据
- [ ] 手动触发一次全挂场景，观察 agent 是否：
  - 直接告诉用户"数据源不可用稍后重试"
  - 不给假逃生舱

## 边界情况 / 已知限制

- **候选池上限 15-25 只**（设计文档未决问题）：SKILL.md 先按这个感觉值写，跑完一次后如果发现太少或太多再调
- **用户不指定行业时**（设计文档未决问题）：SKILL.md 里明确要求 agent 追问行业，不默认全市场（全市场跑不完，且缺少聚焦意义）
- **观察 SOP 是姊妹 skill，不在本次范围**——如果 agent 走完 Step 3 后用户问"接下来每天怎么跟踪"，agent 应回答"观察工作流暂未实现，本次报告的股票代码你可以自己加到自选股手动跟踪"
- **skill 触发精度**：如果本 skill 描述写太宽（比如"股票"就触发），会污染其他股票问答；写太窄又漏触发。参考同 repo 已有 skill 的 description 写法，控制在"明确的选股/圈股意图"

## 实施回填（做完后填）

### 实际改动

（SKILL.md 最终结构、跑端到端时发现的问题）

### 端到端验证结果

- 正常路径：（agent 是否按 SOP 走 / 报告质量 / 耗时）
- 降级路径：（agent 是否如实告知 / 有没有瞎造数据）
- 全挂路径：（agent 是否干净中止 / 有没有给假逃生舱）

### 后续 TODO

- 未解决的未决问题（对齐 design 文档的 4 个未决问题清单）
- 用完一次发现的迭代方向（哪些参数需要调、哪些描述需要改）
