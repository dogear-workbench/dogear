---
step: 3
title: SKILL.md + 端到端验证
status: done
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

## 实施回填

### 实际改动

- 新增 `.claude/skills/stock-picking/SKILL.md`，结构：
  - `frontmatter description`——精准触发"选股 / 圈股 / 从 X 板块选几只"意图，明确排除"查单只 / 深挖已知代码 / 大盘问答"
  - **3 条铁律**：缺数据留白 / 财报串行调 `GetFinancials` / `ScreenStocks` 全挂时直接中止不给假逃生舱
  - **3 步 SOP**：追问硬软条件 → 一次跑完轻量圈选（ScreenStocks + 串行 GetFinancials + DetectSignals + ListAnnouncements）→ 用户挑重点后深挖出报告
  - **数据源分级兜底表**（4 行）：对应 plan.md 里的三级失败处理
  - **报告结构模板**：每只按「推/观望/不推 + 技术面 + 基本面 + 催化剂」，结尾必列【数据缺口】表
  - **1 个示例对话**：科技板块 → 软件开发 → 3 只候选 → 报告，展示 3 步节奏

### 与计划的差异 / 现场决策

- **`ListIndustries` 备源信号缺失（Step 2 review 遗留观察点）**：SKILL.md 里让 agent「不确定行业名先调 `ListIndustries` 关键词过滤」，字段全 null 的兜底靠 SKILL 里的"简表顶部透传 banner + 数据缺口表"覆盖。**未改代码**（对齐 Step 2 收尾时选的 A 方向）。
- **候选池上限**：设计文档未决问题里的"15-25 只"直接落成 SKILL.md 里的 `limit=25`，用完一次再调。
- **用户不指定行业**：SKILL.md 明写"必须追问，不默认全市场跑"，对齐 plan.md 决策。

### 端到端验证结果

**由用户手动执行**（主会话跑不了 GUI 交互）。checklist（step3.md 计划改动段列出）：
- [ ] `bun run dev` 起 dogear
- [ ] agent-chat 发起「从 X 板块选几只有近期利好的股票」，观察 3 步 SOP 是否走通、中间是否在 Step 1 / Step 2 两处停下等用户
- [ ] 临时把 `python/utils/akshare_client.py:get_all_a_stocks` 主源 lambda 改成 raise，观察 agent 是否透传 sina banner、如实说"未按 PE 筛"、不瞎猜 PE 数值
- [ ] 再 patch 备源也 raise，观察 agent 是否直接中止告诉用户"数据源不可用稍后重试"、不给假逃生舱
- [ ] 验证完把临时 raise 改回来

跑完发现问题（触发 / 报告结构 / 降级文案）→ 回本文档补写迭代记录，或直接改 SKILL.md 再 commit。

### 后续 TODO

- **未决问题遗留**（跟 design 文档对齐）：
  - 候选池 15-25 只的上限值，用完一次后按体感调
  - 雪球 xq_a_token 过期问题（`stock_individual_basic_info_xq` / `stock_individual_spot_xq`），跟本 skill 无关，另开任务处理
  - `stock_board_industry_cons_ths` 在当前 akshare 版本被移除——本次不涉及，走同花顺备源要拿行业成分股时再处理
- **观察 / 跟踪 SOP 是姊妹 skill**，SKILL.md 里已明说本次不实现，用户问时按"跟踪工作流暂未实现"回答；等圈选 SOP 跑通几轮后单独规划
