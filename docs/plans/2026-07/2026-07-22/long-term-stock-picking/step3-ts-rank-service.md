---
step: 3
title: TS 打分排序服务
status: done
---

## 目标

新建 `long-term-rank-service.ts`，实现 `rankByLongTerm(candidates, weights, top)`：4 维度分位数打分 → 权重归一化 → 全池归零重分配 → 加权综合分 → markdown 表 + ranked[] 返回。纯本地计算，无 IO。

## 依赖上下文（接力棒输入）

- **前置 step 产出**：Step 2 落地 `preheatLongTermPool()` 返回 `LongTermCandidateData[]`（含 `roeMean5y` / `netProfitCAGR5y` / `revenueCAGR5y` / `roeCV5y` / `netProfitDeclineYears` / `trendState` / `yearPositionPct` 等字段；null 出现规律以 Step 2 接力棒为准）
- **当前关键文件状态**：
  - `electron/main/services/stock/rank-service.ts`（旧短期视角实现）可参考"分位数打分 + 权重归一化 + 全池归零"的骨架，但**不复用它的维度和权重键**（完全不同）
- **关键决策回顾**：
  - 4 维度权重默认均衡各 0.25
  - 权重不需要和为 1，内部归一化
  - 分位数在候选池内部排序（不是全市场）
  - 全池某维度 null → 权重设 0，其他按比例放大，返回 `weightsApplied` 透传
  - 单只单维度 null → 该维度 0 分（不影响其他维度打分）
  - 稳定性维度融合了"业绩下滑年数"，不单独设 penalty 项

## 计划改动

### 新建 `electron/main/services/stock/long-term-rank-service.ts`

**入参**：
```typescript
interface LongTermWeights {
  roeMean?: number;    // 默认 0.25
  growth?: number;     // 默认 0.25
  trend?: number;      // 默认 0.25
  stability?: number;  // 默认 0.25
}

interface RankByLongTermInput {
  candidates: LongTermCandidateData[];   // 从 preheatLongTermPool 直接取
  weights?: LongTermWeights;
  top?: number;                          // 默认 15
}
```

**返回**：
```typescript
interface RankedCandidate {
  market: number;
  code: string;
  name: string;
  totalScore: number;              // 0-100 综合分
  roeMeanScore: number;            // 各维度 0-100 分
  growthScore: number;
  trendScore: number;
  stabilityScore: number;

  // 透传给上层展示
  roeMean5y: number | null;
  netProfitCAGR5y: number | null;
  revenueCAGR5y: number | null;
  roeCV5y: number | null;
  netProfitDeclineYears: number;
  trendState: string;
  yearPositionPct: number;
  reportYearsAvailable: number;
}

interface RankByLongTermResult {
  markdown: string;                          // 排序后的评分表 markdown
  ranked: RankedCandidate[];
  weightsApplied: Required<LongTermWeights>; // 实际用的权重（归零重分配后）
  notes: string[];                           // 提示信息（如"某维度全池缺失已重分配"）
}
```

**4 维度分位数打分公式**（对齐 design.md 段 3）：

**维度 1：roeMeanScore**
- 输入：`candidate.roeMean5y`
- 打分：对候选池内所有非 null roeMean5y 做分位数排序，rank/N * 100
- null → 0 分
- ROE 均值为负 → 0 分（约定 negative 视为最差）

**维度 2：growthScore**
- 输入：`candidate.netProfitCAGR5y` + `candidate.revenueCAGR5y`
- 子权重：净利 CAGR 分位 × 0.6 + 营收 CAGR 分位 × 0.4
- 若 `growthDowngrade=true`（Step 1 已把 CAGR 换成同比均值），照样对该值做分位数
- 两个都 null → 0 分

**维度 3：trendScore**
- 子权重：周 K 均线态势 × 0.6 + 年内位置 × 0.4
- 周 K 均线态势按 `trendState` 映射：
  - `strong_bull` → 100
  - `consolidation` → 70
  - `pullback` → 50
  - `bear` → 20
  - `insufficient` → 0
- 年内位置按 `yearPositionPct` 映射：
  - < 30 → 100
  - 30-70 → 60
  - > 70 → 20
- 两个都缺 → 0 分

**维度 4：stabilityScore**
- 子权重：ROE 变异系数 × 0.6 + 下滑年数 × 0.4
- ROE 变异系数（roeCV5y）：**倒数取分位**（越小越好），非 null 才参分位排序，null → 0 分
- 下滑年数（netProfitDeclineYears）按映射：
  - 0 → 100 / 1 → 75 / 2 → 50 / 3 → 25 / ≥4 → 0

**权重归一化 + 全池归零重分配**：
```typescript
function normalizeWeights(candidates, rawWeights): LongTermWeights {
  const zeroed = new Set<string>();
  // 检测某维度是不是全池 null（比如所有 roeMean5y 都是 null）
  if (candidates.every(c => c.roeMean5y === null)) zeroed.add('roeMean');
  // ... 其他 3 维同理
  const effective = { ...rawWeights };
  for (const key of zeroed) effective[key] = 0;
  const sum = Object.values(effective).reduce((a, b) => a + b, 0);
  if (sum === 0) throw new Error('全部维度归零无法打分');
  // 按比例放大到和为 1
  return Object.fromEntries(Object.entries(effective).map(([k, v]) => [k, v / sum]));
}
```

**综合分 = 4 维度加权求和**（权重归一化后直接乘）

**markdown 表格式**（对齐 design.md 段 6 示例）：

```
## 长期综合评分（前 15）

**权重**：ROE 均值 25% / 增长 CAGR 25% / 长期趋势 25% / 稳定性 25%

| 排名 | 代码 | 名称 | 综合分 | ROE 分 | 增长分 | 趋势分 | 稳定性分 | ROE均值 | 净利CAGR | 趋势状态 |
|---|---|---|---|---|---|---|---|---|---|---|
| 1 | XXXXXX | XXX | 82.4 | 88 | 75 | 90 | 80 | 22.5% | 18.2% | strong_bull |
| ... |

（若有维度归零则在权重行下面加一行说明）
```

### 复用工具函数

分位数计算可以写一个纯函数 helper：

```typescript
function percentileRank(values: (number | null)[], target: number | null): number {
  if (target === null) return 0;
  const valid = values.filter((v): v is number => v !== null);
  const belowOrEqual = valid.filter(v => v <= target).length;
  return (belowOrEqual / valid.length) * 100;
}
```

## 手工验证

Step 3 完成后写临时脚本 or tipc handler：

```typescript
const preheatResult = await preheatLongTermPool({ industries: ['C39...'] }, { limit: 20 });
if (preheatResult.ok) {
  const ranked = rankByLongTerm({
    candidates: preheatResult.candidates,
    weights: { roeMean: 0.25, growth: 0.25, trend: 0.25, stability: 0.25 },
    top: 10,
  });
  console.log(ranked.markdown);
}
```

期望：markdown 表能正常显示，`totalScore` 在 0-100 之间，4 维度分之和加权 = totalScore，`weightsApplied` 若无归零则严格等于输入权重（归一化到和为 1）。

## 实施回填

### 实际改动
- 完全按计划落地，4 维度打分与归一化重分配算法无偏差。
- ROE 负值不参与分位数排序但同样 0 分；CV=0 特判 100 分（完全稳定，避免除零）；growthDowngrade 用 `^` 标注 + 表格末尾脚注。
- trend 维度即使 `trendState='insufficient'`，yearPositionPct 仍能贡献 40% 子分，符合 Step 2 交付里的建议。
- 仅 roeMean / growth 两个维度可能全池归零（trend/stability 字段始终有值），notes[] 透传归零说明；理论上不会触发"全部归零"错误路径，保留防御性 throw。
- 数值量级确认：Python `long_term.py` 返回 roe_mean_5y 和 CAGR 都是百分比形式（29.46 表示 29.46%），markdown 直接 `toFixed(1)+"%"` 正确，无需缩放。
- 未做真实数据验证；`bun run build:electron` 通过。

### 改动文件清单
- 新增 `electron/main/services/stock/long-term-rank-service.ts` (~325 行) — `rankByLongTerm` 主入口 + `percentileRank` helper

### 给下一步的接力棒
- **导入**：
  ```ts
  import { rankByLongTerm } from '../services/stock/long-term-rank-service.js';
  import type { RankByLongTermInput, RankByLongTermResult, RankedCandidate, LongTermWeights } from '../services/stock/long-term-rank-service.js';
  ```
- **MCP 工具 `RankByLongTerm` 建议 Zod schema**：
  ```ts
  z.object({
    candidates: z.array(z.any()).describe('来自 PreheatLongTermPool 的 candidates 数组，原样传入'),
    weights: z.object({
      roeMean:   z.number().min(0).optional(),
      growth:    z.number().min(0).optional(),
      trend:     z.number().min(0).optional(),
      stability: z.number().min(0).optional(),
    }).optional(),
    top: z.number().int().min(1).max(50).default(15).optional(),
  })
  ```
- **返回字段说明**：`markdown` 直接给用户看；`ranked[]` 全排序（不截断）供 agent 二次筛选；`weightsApplied` 归一化后和为 1；`notes[]` 归零说明 agent 应透传给用户。
- **数值处理**：`RankByLongTermResult.markdown` 已格式化好，MCP 工具直接 `content: [{ type: 'text', text: result.markdown }]` 加上 JSON code block 里的 ranked/weightsApplied 即可。
- **遗留问题**：无。
