# 长期视角选股 SOP 重构 设计

## 背景

当前 `stock-picking` skill 的候选池评分基于「当天截面数据」——包括当天 PE、今日 KDJ 金叉、近 30 天公告、近 7 天信号。这类短期数据本质是"随机截面噪音"，无法支撑"长期观察或投入"这类用户诉求。用户在实际使用中发现：

1. baostock 快照数据是"最近一个已入库交易日"的切片，`peTTM` 本身波动大，且盘中调用拿到的是前一交易日数据
2. 综合评分排序被单期财报覆盖率影响严重（一次实际预热 13 只只有 4 只拿到 ROE / 增速数据）
3. 短期信号（KDJ 金叉 / RSI 超卖）跟"长期价值"关联度低
4. 硬筛条件里的"当天价格上限"、"当天 PE 上限"本质是历史股价 / 单日估值切片的产物，对长期投资参考意义不大

## 目标

完全替换 `PreheatCandidatePool + RankCandidates` 的现有实现，改为基于 5 年长期数据的价值评估工具，让选股 SOP 真正贯彻"长期观察"的诉求。旧的短期视角短期内不保留（用户明确"完全替换，先走顺一个"）。

## 架构

### 工具重命名 + 完全替换

- 新增 `PreheatLongTermPool`（替代 `PreheatCandidatePool`）
- 新增 `RankByLongTerm`（替代 `RankCandidates`）
- 旧工具从 tool-registry 删除，**不并存**
- skill 文档同步重写

**已排除方案**：
- ~~加 `wantLongTerm` 参数开关~~：单工具承担双职责，长期维护复杂度高
- ~~新增长期工具并保留短期工具~~：概念混乱，用户不清楚该用哪个
- ~~只改 skill 文档不改代码~~：agent 手工串行拉 20-40 次数据慢且不稳

### 硬筛策略（放宽 + 减少条件）

只保留"卫生条件"，不再用当天参数做筛选：

| 条件 | 保留？ | 说明 |
|---|---|---|
| `industries` (min 1) | ✅ 必填 | CSRC 分类名，不限行业会得到全 A 5000+ 只跑不动 |
| `excludeSt` (默认 true) | ✅ 可覆盖 | 长期视角下 ST 基本没意义 |
| `excludeNegativePe` (默认 true) | ✅ 可覆盖 | 长期 ROE 会被亏损拖垮 |
| 价格上限 | ❌ 移除 | 单价高低是历史股价产物，不体现长期价值 |
| PE 上限 | ❌ 移除 | 当天 PE 是截面噪音 |
| 市值上限/下限 | ❌ 移除 | 数据源无股本数据，本来不生效 |

**排序**：按 `market × 10^5 + code` 数值稳定排序（不再 PE 升序）。保证同条件重跑成分一致，方便对比不同权重。

**上限**：100（工具封顶）

### 可获取性预检

硬筛后先并发试拉 1 期财报，拉不到的直接从池子剔除。

**宽松策略**：至少 3 年年报才参评（次新股包容好，池子尽量不被搞小）。

### 4 个长期指标（均衡权重各 25%）

#### 维度 1：5 年 ROE 均值 (25%)
- **数据**：近 5 年年报 ROE
- **打分**：候选池内分位数排序 → 0-100
- **兜底**：不足 3 年数据 → 剔除（不参评）；3-4 年按实际算

#### 维度 2：5 年增长 CAGR (25%)
- **数据**：近 5 年净利润 CAGR + 近 5 年营收 CAGR
- **算法**：`CAGR = (最新期 / 5年前期) ^ (1/5) - 1`
- **子权重**：净利润 CAGR 分位 × 0.6 + 营收 CAGR 分位 × 0.4
- **陷阱处理**：5 年前净利润 ≤ 0 → CAGR 公式失效，降级为"5 年净利同比均值"分位

#### 维度 3：长期趋势 (25%)
两个子指标 = 60/40 加权：

- **周 K 均线态势 (60%)**：拉近 250 期周 K，算 MA26 (半年) + MA52 (一年)
  - 收盘 > MA26 > MA52 且 MA26 上升：100 分（强势多头）
  - 收盘 > MA26，MA26/MA52 缠绕：70 分
  - 收盘 < MA26 但 MA52 仍上升：50 分（回调中的长牛）
  - MA26 < MA52 下降：20 分（长期空头）
- **年内价格位置 (40%)**：`(当前价 - 250日min) / (250日max - 250日min)`
  - < 30% → 100 分（低位安全）
  - 30-70% → 60 分
  - \> 70% → 20 分（高位追涨风险）

#### 维度 4：稳定性 (25%)
两个子指标 = 60/40 加权：

- **ROE 变异系数 (60%)**：`std(5年ROE) / mean(5年ROE)`，变异系数越小越稳，倒数取分位数
- **业绩下滑年数 (40%)**：近 5 年净利同比 < 0 的年数
  - 0 年 → 100 / 1 → 75 / 2 → 50 / 3 → 25 / ≥4 → 0

**综合分 = 4 维度分位加权（各 25%）**

**已排除**：单独设 penalty 项——把"业绩下滑惩罚"融进稳定性维度更简洁

## 模块边界

### 新增

- `python/core/long_term.py` — 5 年财报聚合 + 周 K 长期指标 + CAGR/CV 计算
- `python/main.py` — 新增 `long_term_metrics` JSON-RPC 方法
- `electron/main/services/stock/long-term-preheat-service.ts` — 编排硬筛 + 预检 + 财报/周 K 拉取
- `electron/main/services/stock/long-term-rank-service.ts` — 纯本地打分排序

### 修改

- `electron/main/agents/tools/stock-picking-tools.ts` — 替换 MCP 工具定义（`PreheatLongTermPool` + `RankByLongTerm`），删除旧 `PreheatCandidatePool` + `RankCandidates`
- `electron/main/agents/tools/tool-registry.ts` — 删掉旧工具注册，加新工具
- `C:/dogear/.claude/skills/stock-picking/SKILL.md` — 完全重写

### 删除

- `electron/main/services/stock/preheat-service.ts` — 直接删（用户明确"完全替换"）
- `electron/main/services/stock/rank-service.ts` — 直接删

### 不需要动

- 财报接口 `python/core/financials.py` 保持不变（长期视角复用现有 baostock + 同花顺双源接口）
- baostock 快照 `python/core/snapshot.py` 保持不变（快照仍是硬筛数据源）
- `stock/rate-limiter.ts` 保持不变（长期视角复用现有限流）

## 数据流

```
用户 → AI Agent → PreheatLongTermPool 工具
                    ↓
                硬筛（baostock 当日快照，industries + excludeSt + excludeNegativePe）
                    ↓
                稳定排序（market * 1e5 + code）+ 截断到 limit
                    ↓
                可获取性预检（并发试拉 1 期财报）
                    ↓
                5 年财报拉取（每批 5 并发，Python 端串行；get_financials periods=20）
                    ↓
                周 K 拉取（每批 5 并发，走 rate-limiter；GetKLineData period=weekly limit=250）
                    ↓
                长期指标聚合（CAGR / CV / MA26 / MA52 / 年内位置 / 下滑年数）
                    ↓
                CandidateData[] + status（total / afterPreflight / financialsFullYears 等）
                    ↓
                Agent → RankByLongTerm 工具
                    ↓
                4 维度分位数打分 → 加权综合分
                    ↓
                markdown 表 + ranked JSON
                    ↓
                Agent 呈现给用户 → 用户挑 3-5 只
                    ↓
                Agent → CreateSessionBatch 派 N 个子会话深挖
                    ↓
                子会话读候选数据 + 拉更多细节（月 K / 近 1 年公告 / 行业对比）→ 交付报告
                    ↓
                Agent 组装最终报告
```

### 关键接口

**`PreheatLongTermPool` 入参**：
```
{
  industries: string[],           // 必填，min 1，CSRC 分类名
  excludeNegativePe?: boolean,    // 默认 true
  excludeSt?: boolean,            // 默认 true
  limit?: number,                 // 默认 50，最大 100
  wantBatchSize?: number,         // 默认 5，agent 可传更小值保守
}
```

**`PreheatLongTermPool` 返回**：每只 candidate 含 5 类字段：
- **基础**：market / code / name / industry
- **5 年财报聚合**：`annualReports[]` (year/roe/netProfit/revenue) + `roeMean5y` + `netProfitCAGR5y` + `revenueCAGR5y` + `roeCV5y` + `netProfitDeclineYears`
- **周 K 聚合**：`weeklyMA26` + `weeklyMA52` + `ma26Slope` + `trendState` (strong_bull/consolidation/pullback/bear)
- **年内位置**：`currentPrice` + `yearHigh` + `yearLow` + `yearPositionPct`
- **数据完整性**：`reportYearsAvailable` (3-5) + `klinePeriodsAvailable` + `failures[]`

`status`：`total / afterPreflight / financialsFullYears / financialsPartialYears / klineSuccess / failuresByCategory / snapshotDate`

**`RankByLongTerm` 入参**：
```
{
  candidates: [...],       // 从 PreheatLongTermPool 直接取
  weights?: {              // 默认均衡各 0.25
    roeMean, growth, trend, stability
  },
  top?: number,            // 默认 15
}
```

## 错误处理 / 边界情况

### A. 中止级（返回 error）
- `industries` 拼错 / CSRC 名不存在 → `{ error: "无候选，请检查行业名" }`
- 硬筛后 0 只 → 同上
- 预检后 0 只 → `{ error: "候选池 X 只全部预检失败，无可参评标的" }`
- Python bridge 崩溃 → `{ error: "底层数据源不可用" }`

### B. 单只剔除级
- 预检失败（1 期财报都拉不到）→ 记入 `status.preflightFailed`
- 5 年财报实际拿到 <3 年 → 记入 `status.insufficientYears`
- 周 K 拉不到（停牌 / 退市 / 新股不满 250 期）→ 记入 `status.klineFailed`
- 4 维度算完至少 3 个是 null → 保留标准不达

### C. 单只单维度扣分/降级
- 5 年前净利 ≤ 0 → growth 降级为"5 年净利同比均值"分位
- 周 K < 250 期但 ≥ 100 期 → trend 用实际期数算
- 某年年报缺净利/营收 → 该年跳过（前提至少 3 年可用）
- ROE 5 年均值为负 → roeMean 0 分

### D. 全池归零级
- 某维度全池 null → 权重设 0 + 其他维度按比例重分配
- `RankByLongTerm` 返回 `weightsApplied` 透传实际权重

### E. 快照时效
- 调用 < 17:30 → 快照是前一交易日，透传不处理
- 返回 `status.snapshotDate` 让 agent/用户知道数据截止日

### F. 限流保护
- 复用 `stock/rate-limiter.ts` 令牌桶 + 断路器
- 断路器打开 → 数据源暂停 60s 再试
- 整体降级：若整个预热周期内断路器一直打开 → status 里明确告知

## Skill 文档新 SOP 结构（`.claude/skills/stock-picking/SKILL.md`）

### Step 1：定条件
- **硬条件（必问）**：行业/领域（CSRC 分类名）/ 是否排除 ST / 是否排除亏损
- **软条件（选问）**：长期评分权重偏好（质量/成长/趋势/均衡，默认均衡）/ 最终产出数量（默认 3-5 只）
- **删掉**：价格上限 / PE 上限 / 市值范围

### Step 2：预热 + 评分
- `PreheatLongTermPool` 一次拉完（3-5 分钟）
- `RankByLongTerm` 秒级排序 → 综合评分简表
- **status 段透传给用户**（total / afterPreflight / financialsFullYears）

### Step 3：子会话并行深挖
- 沿用现有 `CreateSessionBatch` 架构
- 报告结构对齐长期视角：
  - **长期基本面**：5 年 ROE 趋势 + CAGR 分解 + 稳定性
  - **长期技术面**：周 K MA26/52 + 年内位置 + 月 K 走势（可选）
  - **催化剂**：改成"近 1 年重要公告"（不看近 30 天）
  - **风险提示**：业绩下滑年份 + 长期趋势拐点

### 新铁律
1. 缺数据必须留白（不变）
2. `status.total = 0` 或 `afterPreflight = 0` → 明确停止
3. **禁止用当天数据当选股依据**——KDJ 金叉、当天涨跌幅、当天 PE 不作为评分维度（但可作为深挖阶段的辅助信息）

### 边界与限制
- 5 年窗口 → 上市 <3 年的公司被剔除，用户想选新兴科技股要知道副作用
- 周 K 250 期 → 新股不满会 trend 维度降级
- 耗时 3-5 分钟 → agent 自主判断要不要派子会话（>10 分钟或主上下文 >100k tokens 建议派）
- 单次运行硬筛后 >100 只 → 提示"XX 只超上限 100，按稳定序取前 100"

## 未决问题

1. **第三方财报源**：本次不加，跑一段时间后如果发现"每次预检砍掉一半"影响体验，再评估加东财/新浪/Tushare Pro
2. **短期视角的替代**：如果用户以后想选波段/热点，当前无工具支持——留待未来讨论
3. **权重预设扩展**：目前只准备"均衡"，"质量为王"、"成长为王"等预设留待迭代
4. **stock-picking-tools.ts 是否新建**：现在的 tool-registry 里 `PreheatCandidatePool` 挂在哪个文件？实施时确认，可能是 `stock-analysis-tools.ts` 或独立文件
