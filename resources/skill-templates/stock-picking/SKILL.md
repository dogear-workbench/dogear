---
name: stock-picking
description: 用户提出"选股 / 圈股 / 挑几只 X 股 / 从 X 板块选几只 / 帮我在 X 里找 N 只"类需求时必须调用——特征是「有一个大致范围（行业/概念/主题）+ 想产出一小批候选（3-10 只）+ 需要理由」。不覆盖「查单只股票的行情/技术面/公告」（那是直接调工具）、也不覆盖「大盘怎么样 / 板块涨跌情况」（那是问答）。用户已经拿着一批代码问"这几只怎么样"也不触发（那是深挖不是圈选）。
---

# Stock Picking

把用户的模糊选股需求拆成"定条件 → 预热+评分 → 子会话深挖出报告"三步 SOP。**全流程基于 5 年长期视角**，全流程数据源分级兜底，缺数据必须留白。

## 新范式：长期视角预热 + 评分（v3 重构后）

历史上短期视角（当天 PE / 今日 KDJ / 近 30 天公告 / 近 7 天信号）本质是"截面噪音"，无法支撑"长期观察或投入"这类诉求。v3 完全替换成长期指标，工具收敛到两个：

- **一次 `dogear__PreheatLongTermPool`** 完成硬筛 + 可获取性预检 + 5 年年报聚合 + 周 K 长期趋势 + 年内位置计算，一次拉完并落地缓存（财报按 reportPeriod 永久缓存 / K 线 JSONL 增量缓存）
- **一次 `dogear__RankByLongTerm`** 按 4 维度长期指标（ROE 均值 / 增长 CAGR / 长期趋势 / 稳定性）分位数打分排序（**纯本地算，秒级**）
- 用户可以反复调 `dogear__RankByLongTerm` 换权重看不同视角，**不用重复预热**

工具在 `dogear-stock-picking` MCP server 下。**用户需要在设置页「工具包」里勾上「候选池预热」才能调用**——本 skill 触发时如果检测到 agent 没有这两个工具，先明确告诉用户"请去设置页开启候选池预热工具包再重试"，不要退回旧的手工串行姿势。

## 铁律（违反 = 报告作废）

1. **缺数据必须明确留白**——某段没拿到数据就直说"未获取"或空着，禁止用"该公司盈利能力尚可 / 基本面稳健"这类敷衍话填补。宁可段落是空的，不要看起来像模像样但内容是编的。
2. **`dogear__PreheatLongTermPool` 返回 `status.total = 0` 或 `status.afterPreflight = 0` 时明确停止**——前者说明行业硬筛后 0 只（通常是行业名拼错或范围太窄），直接问用户是否换行业/放宽卫生条件；后者说明预检全部失败（通常是数据源问题），直接告知用户"候选池全部预检失败，可能行业/数据源问题，稍后重试"。**禁止凭空造股票**。
3. **禁止用当天数据当选股依据的评分维度**——KDJ 金叉、当天涨跌幅、当天 PE、日 K 信号只能作为 Step 3 深挖阶段的**辅助信息**，不能作为选股/排序依据。评分维度就是长期 4 维度，不加短期项。

## 3 步 SOP

### Step 1：定条件（对话追问，不调工具）

问用户 2 组条件——**长期视角下硬条件很少，因为价格/PE/市值都不参与选股**：

- **硬条件（必问）**：
  - 行业/领域（**证监会 CSRC 分类名**，如 `C39计算机、通信和其他电子设备制造业`）——**不确定名字时先调 `dogear__ListIndustries` 关键词过滤查真实值域**（用户说"科技"实际可能对应多个 CSRC 分类，需要逐一列出让用户选）。**多板块要分开多次调 `dogear__PreheatLongTermPool`，不要塞到一个 industries 数组里一次预热**（原因见 Step 2 说明）
  - 是否排除 ST（默认 true）
  - 是否排除亏损股（默认 true，长期视角下亏损股 ROE 会被拖垮）
- **软条件（选问）——不做硬筛，交给 dogear__RankByLongTerm 权重体现**：
  - 长期评分偏好（对应 4 键权重）：
    - **质量为王** → 加大 `roeMean`
    - **成长为王** → 加大 `growth`
    - **趋势/位置敏感** → 加大 `trend`
    - **稳定性优先** → 加大 `stability`
    - **均衡**（默认）→ 各 0.25
  - 最终产出深挖数量（默认 3-5 只，最多 10 只）

**明确删除的条件**（用户如果主动提了要告知副作用）：

- 价格上限 → "长期视角不看单价，单价高低是历史股价产物"
- PE 上限 → "长期视角不看当天 PE，是截面噪音"
- 市值范围 → "数据源无股本数据，本来不生效"

追问模板参考：
> 帮你圈候选前先对齐几个条件：
> 1. 想在哪个板块/行业？（不确定我先查 CSRC 分类对应的名字）
> 2. 排除 ST 和亏损股吗？（默认都排除）
> 3. 长期评分更偏重哪块——ROE 质量 / 成长 CAGR / 长期趋势 / 稳定性？（默认均衡各 25%，也可以先跑均衡看看再调）
> 4. 最终想深挖几只？（默认 3-5 只）

**不要跳过 Step 1 直接跑工具**——用户没说清行业时预热出的候选池方向就错了。

### Step 2：预热 + 评分（分行业预热 + 秒级重排序）

新架构下这一步只有两个工具调用：

1. **`dogear__PreheatLongTermPool`** — 传硬条件（`industries` / `excludeNegativePe` / `excludeSt` / `limit=50`），拿到完整候选池数据（含 5 年财报聚合 + 周 K 长期指标 + 年内位置）。**单行业 limit=50 耗时约 3-5 分钟**（Python bridge 串行处理，无法并发压缩单次耗时）。
   - **多行业必须分开多次调用，不要塞进一个 industries 数组一次预热**：
     - 每个行业独立一次调用，产出独立的 `candidates` 数组
     - 主会话可以**串行调**（简单直观，但 N 个行业耗时 N × 3 分钟）
     - 主上下文压力大或行业数 ≥3 时**派子会话并行调**（每个行业一个子会话，交回自己的 candidates JSON，主会话合并）
     - 合并方式：把每次调用返回的 `candidates` 数组拼接，去重（按 `market-code` 键），再整体传给 `dogear__RankByLongTerm`
   - **工具返回的 markdown 表末尾有一个 ```json 代码块**，内容是 `{ "candidates": [...] }`。这个 JSON 数据要**原样保留在对话上下文里**，下一步 dogear__RankByLongTerm 会用到（agent 不需要显式复制，直接引用即可）。
   - **status 段透传给用户看**，重点几个字段：
     - `total`：硬筛后候选数（0 → 按铁律 2 停下）
     - `afterPreflight`：预检通过数（0 → 按铁律 2 停下）
     - `insufficientYears`：年报<3 年被剔除数（独立计数，与技术失败分开）
     - `klineFailed`：周 K 拉取失败被剔除数
     - `financialsFullYears / financialsPartialYears`：完整 5 年 vs 3-4 年财报数（若后者大于前者 → 提示用户"多数候选只有 3-4 年数据，长期评分可能不够扎实"）
     - `snapshotDate`：数据截止交易日（<17:30 调用会是前一交易日，透传即可）

2. **`dogear__RankByLongTerm`** — 把上一步的 `candidates` 数组 + weights（可选）传进来，返回按综合分排序的 Top 15（`top` 最大 50）。
   - 参数 `candidates`：从预热结果的 JSON 块里取 `.candidates` 原样传入
   - 参数 `weights`：如果 Step 1 用户说了偏好就传对应键，否则不传（默认各 0.25）
   - 参数 `top`：默认 15，够用
   - 输出是 markdown 表，列：`| 排名 | 代码 | 名称 | 综合分 | ROE分 | 增长分 | 趋势分 | 稳定性分 | ROE均值 | 净利CAGR | 趋势状态 |`
   - 表格下方有 `### 生效权重（weightsApplied）` JSON 块——**若某维度全池缺失被归零，`weightsApplied` 里该键会是 0，其他键按比例放大**，这是真实情况，透传给用户不用解释太多

**产出【长期综合评分简表】**（dogear__RankByLongTerm 输出的 markdown 表），然后停下问用户：
> 以上按当前权重排序。你想深挖哪 3-5 只？（也可以先换权重再看一版，比如"把 ROE 加到 40%"，我会秒级重排）

**关于换权重**：用户如果说"再看一版更看重成长"，只需要**再调一次 dogear__RankByLongTerm**（同一份 candidates 数据 + 新 weights），不要重新预热。这就是新架构的核心价值。

### Step 3：子会话并行深挖（每只 1 个子会话）

对用户挑中的 N 只（3-5 只），主会话用 `dogear__CreateSessionBatch` **一次派 N 个子会话**并行深挖。

**主会话职责**：

- 用 `dogear__CreateSessionBatch` 一次派 N 个子会话，每个 `outputPath` 用 `reports/<code>.md`
- 每个子会话 task 描述明确带上：**该股票的代码/名称、Step 2 简表里的关键数据（`roeMean5y` / `netProfitCAGR5y` / `revenueCAGR5y` / `trendState` / `yearPositionPct` / `netProfitDeclineYears` / `reportYearsAvailable`）、要求输出的报告结构（见下方模板）、交付路径**
- `dogear__WaitForMessage(fromSessionIds=[...])` 等所有子会话交付
- 读所有子会话产出的报告（用 `dogear__ListGroupFiles`），组装成最终交付：
  - 横向对比章节（长期基本面 / 长期技术面 / 长期催化剂 / 风险提示 四维度并排）
  - 【数据缺口】汇总表
  - 【最终推荐】1-2 只 + 理由（结合综合分和深挖后的判断）

**子会话职责**（每只独立执行，内部串行；本地缓存加持，无 API 压力）：

1. **长期基本面**（Step 1 缓存加持，秒回）：
   - `dogear__GetFinancials(periods=20)` → 拉完整 5 年财报（缓存命中不走 Python）
   - 逐年展示 ROE / 净利润 / 营收趋势；CAGR 分解；毛利率/净利率变化
   - `dogear__CompareIndustry` → 行业内相对估值参考（辅助）

2. **长期技术面**：
   - `dogear__GetKLineData(period='weekly', limit=250)` + `dogear__CalcIndicators(indicators=['MA'], params={MA:{N:[26,52]}})` → 周 K 均线态势
   - `dogear__GetKLineData(period='monthly', limit=60)` → 月 K（5 年月 K = 60 期）看更长周期趋势
   - **年内价格位置直接引用候选数据的 `yearPositionPct`**，不用重算

3. **长期催化剂**（Step 2 缓存加持）：
   - `dogear__ListAnnouncements(since='近 1 年', limit=20)` → 拿一年内的公告标题列表（**注意：长期视角是近 1 年不是近 30 天**）
   - 从中挑最重要 1-2 条调 `dogear__ReadAnnouncement` 读全文（PDF 首次拉后落 hash 缓存）

4. **风险提示**：
   - 近 5 年业绩下滑年份（引用候选数据的 `netProfitDeclineYears`）
   - 长期趋势拐点（周 K MA 关系变化）
   - 行业景气度相对表现（dogear__CompareIndustry 补充）

5. **辅助信息**（**可选，不作为选股依据**）：
   - 若用户明确问"最近日 K 有没有信号"，可以再调 `dogear__DetectSignals`（`lookback=7`）作为参考，但要在报告里明确标"辅助信息，非选股依据"
   - 当天 PE、日 K 涨跌幅同理，只作为参考不作为评分

6. **组装报告**写到 `shared/reports/<code>.md`（`dogear__SaveSharedNote`），格式见下方模板

**为什么可以并行**：数据源全部有本地缓存，子会话读缓存不撞任何上游 API。唯一并发瓶颈是 `dogear__ReadAnnouncement` 首次拉从未缓存过的 PDF（走巨潮 limiter 排队）。5 只子会话的量级完全 OK；超过 10 只就要评估是否分批。

**报告结构模板**（每只子会话产出）：

```markdown
### <代码> <名称>

**推 / 观望 / 不推**（三选一 + 一句话理由，结合综合分和深挖发现）

#### 长期基本面
- 5 年 ROE 趋势：X% → X% → X% → X% → X%（有几年就填几年）
- 净利 CAGR：X%（若为降级算法用 5 年净利同比均值，明确标注）
- 营收 CAGR：X%
- 稳定性：ROE 变异系数 X，近 5 年业绩下滑 X 年
- 毛利率/净利率变化、行业内对比
- 缺哪项留白

#### 长期技术面
- 周 K 状态：strong_bull / consolidation / pullback / bear / insufficient
- MA26 / MA52 相对关系 + MA26 斜率（up/flat/down）
- 年内价格位置：X%（0=年内最低 / 100=年内最高）
- 月 K 长期趋势观察

#### 长期催化剂
近 1 年重要公告要点（1-2 条，含发布日期）；无则写"近 1 年无重要公告"

#### 风险提示
近 5 年业绩下滑年份 / 长期趋势拐点 / 行业相对表现

#### 综合评分背景
（引用 Step 2 dogear__RankByLongTerm 结果里该股的综合分和 4 维度分，说明为什么排在这个位置）

---
```

**报告结尾必列【数据缺口】表**（哪只哪个维度没拿到 + 原因）：

```markdown
## 数据缺口

| 股票 | 缺失维度 | 原因 |
|---|---|---|
| 600XXX | 5 年财报 | 只有 3 年数据（次新股） |
| 002XXX | 近 1 年公告 | dogear__ListAnnouncements 空返回 |
```

无缺口时写"无"，不省略这段。

## 综合评分权重

`dogear__RankByLongTerm` 默认权重：

| 维度 | 权重 | 数据来源 |
|---|---|---|
| `roeMean` | 25% | 近 5 年 ROE 均值 → 候选池内分位数 |
| `growth` | 25% | 净利 CAGR 分位 × 0.6 + 营收 CAGR 分位 × 0.4；5 年前净利 ≤ 0 时净利 CAGR 降级为"5 年净利同比均值"分位 |
| `trend` | 25% | 周 K MA26/52 态势 (60%) + 年内价格位置 (40%) |
| `stability` | 25% | ROE 变异系数分位 (60%) + 业绩下滑年数分档 (40%) |

**关于分位数**：每个维度在候选池内部排序打 0-100 分，不是全市场绝对分。所以同一只股票在不同候选池里综合分可能不同——这是设计如此，选出的是"在这个池子里最优的一批"。

**关于维度归零**：某维度候选池内全部缺失（比如所有候选周 K 数据都不够 100 期），该维度权重会自动归零，其他维度按比例放大。工具输出的 `weightsApplied` JSON 会明确显示（0 权重的键）。

**常见预设组合参考**（可以在 Step 2 追问时给用户举例）：

| 预设 | roeMean | growth | trend | stability |
|---|---|---|---|---|
| 均衡（默认） | 0.25 | 0.25 | 0.25 | 0.25 |
| 质量为王 | 0.40 | 0.20 | 0.15 | 0.25 |
| 成长为王 | 0.20 | 0.40 | 0.20 | 0.20 |
| 稳健派 | 0.30 | 0.15 | 0.15 | 0.40 |
| 趋势敏感 | 0.20 | 0.20 | 0.40 | 0.20 |

权重不需要和为 1，工具内部自动归一化。

## 子会话并行边界（v3）

缓存架构在长期视角下依然有效，子会话并行不撞任何 API：

| 数据源 | 预热前 | 预热后（本 skill 场景） |
|---|---|---|
| baostock 全 A 快照 | ✅ 已缓存 | ✅ 本地读 |
| 同花顺财报 | ❌ 0.5s 单股限流 | ✅ Step 2 缓存命中（按 reportPeriod 永久 key） |
| 东财 K 线 | ⚠️ 令牌桶 | ✅ JSONL 增量命中（周 K 250 期已在预热时拉过） |
| 月 K（60 期） | ⚠️ 令牌桶 | ⚠️ 首次深挖时首次拉，之后命中 |
| 巨潮公告标题列表 | ⚠️ 令牌桶 | ⚠️ 长期视角改成近 1 年，第一次会拉 |
| 巨潮 PDF 全文 | ⚠️ 令牌桶 | ✅ hash 缓存（首次深挖时首次拉，之后永久命中） |

**唯一并发瓶颈**：子会话如果每只都要 `dogear__ReadAnnouncement` 拉从未缓存过的 PDF，会走巨潮 limiter 排队。5 只子会话的量级完全 OK；超过 10 只评估分批。

## 数据源分级兜底表

| 层级 | 场景 | 处理姿势 |
|---|---|---|
| A 中止 | `dogear__PreheatLongTermPool` 抛异常 / 返回 `isError: true` / `status.total = 0` / `status.afterPreflight = 0` | **直接中止 SOP**，按铁律 2 告诉用户，问是否放宽行业范围或稍后重试 |
| B 单只剔除 | `status.preflightFailed` / `insufficientYears` / `klineFailed` 里的股票 | 池子里不出现，透传剔除数量给用户 |
| C 单只单维度降级 | `growthDowngrade`（5 年前净利≤0，改用 5 年同比均值） / `trendState='insufficient'`（周 K <100 期） | 报告里明确"该维度是降级算的"，不隐瞒 |
| D 全池归零 | `dogear__RankByLongTerm` 返回 `weightsApplied` 里某维度为 0 | 明确告诉用户"XX 维度全池缺失已归零，其他维度按比例放大" |
| E 快照时效 | 调用 <17:30 拿到前一交易日快照 | 透传 `status.snapshotDate` 让用户知道数据截止日 |

## 边界与限制

- **5 年窗口 → 上市 <3 年的公司被剔除**：`insufficientYears` 会统计这类股票；用户想选"新兴科技股/次新股"要知道这个副作用，本 skill 覆盖不到，建议单独用 `dogear__GetFinancials` 逐只看。
- **周 K 250 期 → 新股不满 100 期会 `trend` 维度降级**：`trendState='insufficient'`，该维度用实际期数算或 0 分。
- **硬筛无价格/PE/市值**：用户想过滤"太贵"或"太小市值"的股票只能事后手动剔（比如在 Step 2 输出后跳过某几只），本 skill 不加短期硬筛。
- **候选池 limit 上限 100，默认 50**：过大会拖慢预热（limit=100 约 8-10 分钟）。用户没特殊要求用默认。
- **`industries` 必填 min 1，但一次只传一个**：多板块要分开多次调（或派子会话并行），不能塞进一个数组一次预热——Python bridge 是串行处理，塞多个只会让单次调用更长且没有并发收益。
- **单行业耗时 3-5 分钟 → agent 自主判断多行业时是串行还是派子会话**：
  - 1-2 个行业主会话串行调即可
  - ≥3 个行业或主上下文 >100k tokens → 派 N 个子会话并行调，每个子会话交回自己的 candidates JSON，主会话合并去重后传给 dogear__RankByLongTerm
- **观察 / 跟踪 SOP 暂未实现**：用户在 Step 3 后问"接下来每天怎么跟踪"，回答"跟踪工作流暂未实现，你可以把深挖过的股票加到自选股手动跟踪"。
- **单次全流程预算**：单行业预热 ~3 分钟 + 评分 <1s + 5 个子会话并行深挖 ~60-90s（有 PDF 首次拉时）。多行业按行业数 × 3 分钟串行，或派子会话并行则拉平到最慢那个行业的时间。

## 示例对话片段（供参考语气）

**用户**：帮我从科技板块选 3 只长期观察

**Agent（Step 1 追问）**：
> "科技板块"在证监会 CSRC 分类里对应多个细分，我先查下有哪些。
> [调 `dogear__ListIndustries` keyword="科技"]
> 找到相关分类：C39 计算机通信和其他电子设备制造业 / I65 软件和信息技术服务业 / C40 仪器仪表制造业 …你想聚焦哪个？多选的话我会分开预热每个板块（Python 端串行，塞一起没有并发收益）。
> 另外几个条件：
> - 排除 ST 和亏损股吗？（默认都排除）
> - 长期评分更偏重哪块——ROE 质量 / 成长 CAGR / 长期趋势 / 稳定性？（默认各 25%）
> - 最终想深挖几只？（默认 3 只）

**用户**：C39 和 I65 两个都要，都排除，偏重成长和 ROE，3 只

**Agent（Step 2）**：
> 两个行业，我派 2 个子会话并行预热（拉平到最慢那个的时间，~3-5 分钟）。
> [`dogear__CreateSessionBatch` 派 2 个子会话：session A 预热 C39、session B 预热 I65，outputPath 分别 preheat/C39.md 和 preheat/I65.md，task 里明确要求子会话调完 `dogear__PreheatLongTermPool` 后把 candidates JSON 交回]
> [`dogear__WaitForMessage` 等两个子会话交付]
> [合并两份 candidates 数组，按 market-code 键去重：C39 拿到 30 条 + I65 拿到 22 条，去重后共 50 条]
>
> 池子构成：C39 30 只 + I65 22 只 = 合并后 50 只（去重 2 只重叠），完整 5 年财报 38 只 / 3-4 年 9 只，已剔除 3 只年报 <3 年（次新股）+ 2 只周 K 拉不到（可能停牌）。
>
> [调 `dogear__RankByLongTerm` candidates=<预热结果.candidates> weights={roeMean: 0.35, growth: 0.35, trend: 0.15, stability: 0.15} top=15]
> [秒级返回 Top 15]
>
> 长期综合评分简表（当前权重：ROE 35% / 成长 35% / 趋势 15% / 稳定性 15%）：
>
> | 排名 | 代码 | 名称 | 综合分 | ROE分 | 增长分 | 趋势分 | 稳定性分 | ROE均值 | 净利CAGR | 趋势状态 |
> |---|---|---|---|---|---|---|---|---|---|---|
> | 1 | 002XXX | AA科技 | 82.3 | 92 | 88 | 75 | 68 | 22.5% | 18.4% | strong_bull |
> | 2 | 300XXX | BB软件 | 78.1 | 85 | 82 | 70 | 72 | 19.8% | 15.2% | consolidation |
> | ... |
>
> 你想深挖哪 3 只？（也可以换权重再看一版，比如"稳定性加到 30%"）

**用户**：002XXX、300XXX、688XXX

**Agent（Step 3）**：
> [用 `dogear__CreateSessionBatch` 一次派 3 个子会话，每个 outputPath=reports/<code>.md，task 里带上该股的 roeMean5y / netProfitCAGR5y / trendState / yearPositionPct / netProfitDeclineYears / reportYearsAvailable]
> [dogear__WaitForMessage 等 3 只交付完]
> [dogear__ListGroupFiles 读 3 份报告]
> [组装最终交付：横向对比 + 数据缺口汇总 + 最终推荐]
>
> ### 002XXX AA科技（综合分 82.3，Rank 1）
> **推**：5 年 ROE 均值 22.5% 稳中有升 + 净利 CAGR 18.4% 高于行业 + 周 K MA26 上穿 MA52 + 年内位置 42% 相对安全
> ...
