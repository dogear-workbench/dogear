---
step: 4
title: 综合评分服务 + RankCandidates MCP 工具
status: done
---

## 目标

纯本地评分排序：agent 把 PreheatCandidatePool 输出的候选池数据 + 权重传进来，工具返回按综合分排序的完整列表 + 每项评分明细。支持权重可调，agent 秒级重跑试算不同策略。

## 依赖上下文

**前置 step 产出**（Step 3 完成后回填）：
- CandidateData 的最终字段（尤其是 signals/announcements 的 shape）
- Step 3 输出 markdown 里 JSON 块的位置约定（是不是 ```json ... ``` 代码块）

**评分设计要点**：
- 用**分位数打分**（每个维度算候选池内 percentile，避免绝对值失衡）
- 惩罚项独立处理（不参与分位数）
- 缺失值处理：某只某维度 null → 该维度得 0 分，权重按比例摊到其他维度
- 全池某维度全 null → 该维度权重归零，其他维度按比例放大

## 计划改动

### 新建 `electron/main/services/stock/scoring-service.ts`

导出：

```ts
import type { CandidateData, ScoringWeights, RankedCandidate } from './types';

export const DEFAULT_WEIGHTS: ScoringWeights = {
  roe: 0.25,
  growth: 0.25,
  valuation: 0.20,
  signal: 0.15,
  catalyst: 0.10,
  penalty: 0.05,
};

/** 纯函数：输入候选池 + 权重，返回按 score 降序的排序结果 */
export function scoreAndRank(
  candidates: CandidateData[],
  weights: Partial<ScoringWeights> = {}
): RankedCandidate[]
```

**评分算法**：

1. **合并权重**：`const w = { ...DEFAULT_WEIGHTS, ...userWeights }`；归一化到和 = 1
2. **计算各维度候选池分位数**（每个维度独立）：
   - ROE：候选池内所有 roe 排序，每只算 percentile（0-100）
   - Growth：用 max(netProfitYoY, netProfitYoYQuarter) 作为口径（哪个更能代表增速），排序算 percentile
   - Valuation：PE 倒数排序算 percentile（越低越好）
   - Signal：信号强度打分（下面细说）
   - Catalyst：公告催化剂打分（下面细说）
3. **信号强度打分**（0-100）：
   - 每种正向信号 +分数：MACD 金叉 +30 / KDJ 金叉 +15 / 均线多头 +20 / 突破布林上轨 +20 / 成交量突破 +10 / RSI 超卖 +10 / KDJ 超卖 +5
   - 每种负向信号 -分数：MACD 死叉 -20 / KDJ 超买 -10 / RSI 超买 -10 / 跌破布林下轨 -15
   - 距离今天越近权重越高（今日 ×1.0 / 1 天前 ×0.8 / ... / 7 天前 ×0.3）
   - 最终 clamp 到 [0, 100]
4. **公告催化剂打分**（0-100）：
   - 近 30 天公告标题里含关键词加分：业绩预告/中标/增发/收购 +30；股权激励/回购 +20；分红/权益分派 +15；担保/质押/法人变更 0（中性）；诉讼/减持 -10（负面）
   - 计算每只的总分 clamp 到 [0, 100]
5. **业绩下滑惩罚**（作为 penalty 项，负分）：
   - 若 netProfitYoY < -20% 或 netProfitYoYQuarter < -30% → penalty 得 100（满惩罚）
   - 线性：0% 时 0 分，-50% 时 100 分
6. **综合分**：
   ```
   score = w.roe × roePct + w.growth × growthPct + w.valuation × valPct 
         + w.signal × signalScore + w.catalyst × catalystScore
         - w.penalty × penaltyScore
   ```
7. **返回**：按 score 降序排列，加 rank 序号（从 1 开始）；保留 scoreBreakdown 便于用户看每维度贡献

**边界**：
- 候选池为空 → 返回 []
- 全池某维度全 null → 该维度不参与，其他维度权重按比例放大

### 新建 MCP 工具 `RankCandidates`（在 Step 3 建的 `stock-picking-tools.ts` 里）

```ts
tool(
  'RankCandidates',
  '对 PreheatCandidatePool 的候选池按综合权重打分并排序...',
  {
    candidates: z.array(z.any()).describe('候选池数据数组，直接从 PreheatCandidatePool 结果里的 JSON 块复制'),
    weights: z.object({
      roe: z.number().optional(),
      growth: z.number().optional(),
      valuation: z.number().optional(),
      signal: z.number().optional(),
      catalyst: z.number().optional(),
      penalty: z.number().optional(),
    }).optional().describe('权重覆盖，缺省用默认权重（ROE 0.25 / 增速 0.25 / 估值 0.20 / 信号 0.15 / 催化剂 0.10 / 惩罚 0.05）'),
    top: z.number().default(15).describe('返回前 N 只，默认 15'),
  },
  async (args) => {
    const ranked = scoreAndRank(args.candidates, args.weights);
    return { content: [{ type: 'text', text: formatRankedOutput(ranked.slice(0, args.top), args.weights) }] };
  }
)
```

**输出格式**：

```markdown
## 综合评分排序（前 15，共 50 只）

**权重**：ROE 25% / 增速 25% / 估值 20% / 信号 15% / 催化剂 10% / 惩罚 5%（默认）

| 排名 | 代码 | 名称 | 综合分 | ROE分 | 增速分 | 估值分 | 信号分 | 催化剂分 | 惩罚 |
|---|---|---|---|---|---|---|---|---|---|
| 1 | 300773 | 拉卡拉 | 87.4 | 100 | 100 | 100 | 68 | 45 | 0 |
| ... |
```

### 手动验证

- 用 Step 3 的输出直接喂 RankCandidates → 排序合理，拉卡拉这种全维度顶尖的应该在 Top 3
- 改权重 { roe: 0.5, valuation: 0.3, growth: 0.2, signal: 0, catalyst: 0, penalty: 0 } → 应该看到 ROE 高的排到前面
- candidates=[] → 返回空表不崩
- 传入 null 的字段（模拟数据缺口）→ 该维度不算，其他维度按比例算

## 实施回填

详细交付内容见共享区 `step4-delivery.md`。摘要：

### 实际改动

- **改动文件清单**：
  - 新增 `electron/main/services/stock/scoring-service.ts`（293 行，纯函数评分）
  - 修改 `electron/main/agents/tools/stock-picking-tools.ts`（同 server 追加 RankCandidates 工具 + registerTools 元数据 + formatRankedOutput 辅助）
- **与计划差异**：
  1. CandidateData 直接从 `preheat-service.ts` import，不建 `./types` 文件；ScoringWeights/RankedCandidate 定义在 scoring-service.ts 内。
  2. 新增导出 `getEffectiveWeights(candidates, weights)` — 让工具展示层与评分函数共用同一份归一化逻辑，避免两处重复。
  3. **signal / catalyst 维度不参与"全池缺失归零"** — 空数组视为合法结果（"没有信号触发"是真实信息），非数据缺失。仅数值维度（roe/growth/valuation/penalty）参与归零。
  4. 信号时间衰减采用 "0-7 天线性插值 1.0→0.3" 公式（`1.0 - (0.7/7) × daysAgo`），未采用计划文档示例里的 "1 天前 ×0.8"（两者数值本就矛盾）。

### 给下一步的接力棒

- **DEFAULT_WEIGHTS**：`{ roe: 0.25, growth: 0.25, valuation: 0.20, signal: 0.15, catalyst: 0.10, penalty: 0.05 }`（与计划一致）
- **信号打分表**（与计划一致）：MACD金叉 +30 / KDJ金叉 +15 / 均线多头 +20 / 突破布林上轨 +20 / 成交量突破 +10 / RSI超卖 +10 / KDJ超卖 +5 / MACD死叉 -20 / KDJ超买 -10 / RSI超买 -10 / 跌破布林下轨 -15。信号名字符串已与 `python/core/signals.py` 的 SIGNAL_DEFINITIONS.name 完全对齐。
- **公告催化剂打分表**（与计划一致）：加分 业绩预告/中标/增发/收购 +30 / 股权激励/回购 +20 / 分红/权益分派 +15；减分 诉讼/减持 -10。判定：`title.includes(keyword)`，同标题多命中累加，一只股票所有公告累加后 clamp [0, 100]。
- **RankCandidates 输出 markdown 表格列**（Step 5 skill 文档要引用）：
  - 表头：`| 排名 | 代码 | 名称 | 综合分 | ROE分 | 增速分 | 估值分 | 信号分 | 催化剂分 | 惩罚 |`
  - 表格上方有一行 `**权重**：ROE X% / 增速 X% / 估值 X% / 信号 X% / 催化剂 X% / 惩罚 X%（默认）`（展示归一化后的实际权重，非默认时不带"（默认）"后缀）
  - 若维度被归零，下方多一行 `> XX、YY 维度全池缺失，权重已重分配`
  - 顶部 `## 综合评分排序（前 N，共 M 只）`
- **已知边界**：
  - `netProfitYoYQuarter` 目前 baostock 主源恒 null（Step 3 遗留），growth 维度实际等价于纯用 `netProfitYoY`；惩罚的"季报 -30%"分支目前不生效，等主数据源补上季报后自动生效。
  - 用户显式传负权重不会拦截（信任 agent 上游）。
  - 综合 score 未强制 clamp [0, 100]，默认权重下惩罚最多拉低 5 分，实际不会出现负数。
