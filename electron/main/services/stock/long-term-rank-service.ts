import type { LongTermCandidateData } from './long-term-types.js';

// ============================================================
// 类型定义
// ============================================================

export interface LongTermWeights {
  roeMean?: number;   // 默认 0.25
  growth?: number;    // 默认 0.25
  trend?: number;     // 默认 0.25
  stability?: number; // 默认 0.25
}

export interface RankedCandidate {
  market: number;
  code: string;
  name: string;
  totalScore: number;
  roeMeanScore: number;
  growthScore: number;
  trendScore: number;
  stabilityScore: number;

  roeMean5y: number | null;
  netProfitCAGR5y: number | null;
  revenueCAGR5y: number | null;
  roeCV5y: number | null;
  netProfitDeclineYears: number;
  trendState: string;
  yearPositionPct: number;
  reportYearsAvailable: number;
  growthDowngrade: boolean;
}

export interface RankByLongTermInput {
  candidates: LongTermCandidateData[];
  weights?: LongTermWeights;
  top?: number;
}

export interface RankByLongTermResult {
  markdown: string;
  ranked: RankedCandidate[];
  weightsApplied: Required<LongTermWeights>;
  notes: string[];
}

// ============================================================
// 常量
// ============================================================

const DEFAULT_WEIGHTS: Required<LongTermWeights> = {
  roeMean: 0.25,
  growth: 0.25,
  trend: 0.25,
  stability: 0.25,
};

const TREND_STATE_SCORE: Record<string, number> = {
  strong_bull: 100,
  consolidation: 70,
  pullback: 50,
  bear: 20,
  insufficient: 0,
};

const DECLINE_YEAR_SCORE: Record<number, number> = {
  0: 100,
  1: 75,
  2: 50,
  3: 25,
};

// ============================================================
// 纯函数 helper
// ============================================================

/**
 * 升序分位数打分：数值越大得分越高，0-100。
 * values 是整个候选池的值（含 target），null 值不参与排序。
 * target 为 null 返回 0。
 */
export function percentileRank(values: (number | null)[], target: number | null): number {
  if (target === null) return 0;
  const valid = values.filter((v): v is number => v !== null);
  if (valid.length === 0) return 0;
  const belowOrEqual = valid.filter((v) => v <= target).length;
  return (belowOrEqual / valid.length) * 100;
}

function yearPositionScore(pct: number): number {
  if (pct < 30) return 100;
  if (pct <= 70) return 60;
  return 20;
}

function declineYearsScore(years: number): number {
  return DECLINE_YEAR_SCORE[years] ?? 0;
}

// ============================================================
// 4 维度打分
// ============================================================

function scoreRoeMean(candidates: LongTermCandidateData[], i: number): number {
  const target = candidates[i].roeMean5y;
  // ROE 均值为负视为最差，得 0 分
  if (target === null || target < 0) return 0;
  // 只有非 null 且非负的值才参与分位数排序
  const values = candidates.map((c) => (c.roeMean5y !== null && c.roeMean5y >= 0 ? c.roeMean5y : null));
  return percentileRank(values, target);
}

function scoreGrowth(candidates: LongTermCandidateData[], i: number): number {
  const c = candidates[i];
  if (c.netProfitCAGR5y === null && c.revenueCAGR5y === null) return 0;

  const netProfitValues = candidates.map((c) => c.netProfitCAGR5y);
  const revenueValues = candidates.map((c) => c.revenueCAGR5y);

  const netScore = percentileRank(netProfitValues, c.netProfitCAGR5y);
  const revScore = percentileRank(revenueValues, c.revenueCAGR5y);

  // 一个为 null 时其对应子权重部分贡献 0 分（不做子权重重分配）
  return netScore * 0.6 + revScore * 0.4;
}

function scoreTrend(candidate: LongTermCandidateData): number {
  const stateScore = TREND_STATE_SCORE[candidate.trendState] ?? 0;
  const posScore = yearPositionScore(candidate.yearPositionPct);
  return stateScore * 0.6 + posScore * 0.4;
}

function scoreStability(candidates: LongTermCandidateData[], i: number): number {
  const c = candidates[i];

  let cvScore: number;
  if (c.roeCV5y === null) {
    cvScore = 0;
  } else if (c.roeCV5y === 0) {
    // 零变异系数 = 完全稳定，给最高分
    cvScore = 100;
  } else {
    // 倒数取分位：CV 越小越好，取 1/CV 后做升序分位数
    const inverseValues = candidates.map((c) =>
      c.roeCV5y !== null && c.roeCV5y > 0 ? 1 / c.roeCV5y : null,
    );
    cvScore = percentileRank(inverseValues, 1 / c.roeCV5y);
  }

  const declScore = declineYearsScore(c.netProfitDeclineYears);
  return cvScore * 0.6 + declScore * 0.4;
}

// ============================================================
// 权重归一化 + 全池归零重分配
// ============================================================

interface NormalizeResult {
  weights: Required<LongTermWeights>;
  notes: string[];
}

function normalizeWeights(candidates: LongTermCandidateData[], raw: Required<LongTermWeights>): NormalizeResult {
  const notes: string[] = [];
  const effective = { ...raw };

  // 全池 roeMean5y 均为 null → 该维度归零（负值不属于"数据缺失"，不触发归零）
  if (candidates.every((c) => c.roeMean5y === null)) {
    notes.push('roeMean 维度全池数据缺失（roeMean5y 全为 null），已归零并按比例重分配至其他维度');
    effective.roeMean = 0;
  }

  // 全池两个增长指标均为 null → growth 归零
  if (candidates.every((c) => c.netProfitCAGR5y === null && c.revenueCAGR5y === null)) {
    notes.push('growth 维度全池数据缺失（netProfitCAGR5y 与 revenueCAGR5y 全为 null），已归零并按比例重分配至其他维度');
    effective.growth = 0;
  }

  // trend 和 stability 维度始终有数据（trendState/yearPositionPct/netProfitDeclineYears 从不为 null）

  const sum = effective.roeMean + effective.growth + effective.trend + effective.stability;
  if (sum <= 0) {
    throw new Error('所有 4 个评分维度均归零，无法对候选池进行打分');
  }

  return {
    weights: {
      roeMean: effective.roeMean / sum,
      growth: effective.growth / sum,
      trend: effective.trend / sum,
      stability: effective.stability / sum,
    },
    notes,
  };
}

// ============================================================
// Markdown 生成
// ============================================================

function fmtScore(val: number): string {
  return val.toFixed(1);
}

function fmtDimScore(val: number): string {
  return Math.round(val).toString();
}

function fmtMetric(val: number | null, downgrade?: boolean): string {
  if (val === null) return '-';
  const str = `${val.toFixed(1)}%`;
  return downgrade ? `${str}^` : str;
}

function fmtWeightPct(w: number): string {
  return `${Math.round(w * 100)}%`;
}

function buildMarkdown(
  ranked: RankedCandidate[],
  top: number,
  weightsApplied: Required<LongTermWeights>,
  notes: string[],
): string {
  const shown = ranked.slice(0, top);
  const hasDowngrade = shown.some((r) => r.growthDowngrade);

  const lines: string[] = [
    `## 长期综合评分（前 ${shown.length}）`,
    '',
    `**权重**：ROE 均值 ${fmtWeightPct(weightsApplied.roeMean)} / 增长 CAGR ${fmtWeightPct(weightsApplied.growth)} / 长期趋势 ${fmtWeightPct(weightsApplied.trend)} / 稳定性 ${fmtWeightPct(weightsApplied.stability)}`,
  ];

  if (notes.length > 0) {
    for (const note of notes) {
      lines.push(`> ⚠ ${note}`);
    }
  }

  lines.push('');
  lines.push('| 排名 | 代码 | 名称 | 综合分 | ROE 分 | 增长分 | 趋势分 | 稳定性分 | ROE均值 | 净利CAGR | 趋势状态 |');
  lines.push('|---|---|---|---|---|---|---|---|---|---|---|');

  for (let i = 0; i < shown.length; i++) {
    const r = shown[i];
    const cagrStr = fmtMetric(r.netProfitCAGR5y, r.growthDowngrade);
    lines.push(
      `| ${i + 1} | ${r.code} | ${r.name} | ${fmtScore(r.totalScore)} | ${fmtDimScore(r.roeMeanScore)} | ${fmtDimScore(r.growthScore)} | ${fmtDimScore(r.trendScore)} | ${fmtDimScore(r.stabilityScore)} | ${fmtMetric(r.roeMean5y)} | ${cagrStr} | ${r.trendState} |`,
    );
  }

  if (hasDowngrade) {
    lines.push('');
    lines.push('^ 净利数据不足 5 年 CAGR，已降级为 5 年净利同比均值');
  }

  return lines.join('\n');
}

// ============================================================
// 主入口
// ============================================================

export function rankByLongTerm(input: RankByLongTermInput): RankByLongTermResult {
  const { candidates, weights = {}, top = 15 } = input;

  if (candidates.length === 0) {
    return {
      markdown: '## 长期综合评分\n\n候选池为空，无法打分。',
      ranked: [],
      weightsApplied: { ...DEFAULT_WEIGHTS },
      notes: [],
    };
  }

  const rawWeights: Required<LongTermWeights> = {
    roeMean: weights.roeMean ?? DEFAULT_WEIGHTS.roeMean,
    growth: weights.growth ?? DEFAULT_WEIGHTS.growth,
    trend: weights.trend ?? DEFAULT_WEIGHTS.trend,
    stability: weights.stability ?? DEFAULT_WEIGHTS.stability,
  };

  const { weights: w, notes } = normalizeWeights(candidates, rawWeights);

  const scored: RankedCandidate[] = candidates.map((c, i) => {
    const roeMeanScore = scoreRoeMean(candidates, i);
    const growthScore = scoreGrowth(candidates, i);
    const trendScore = scoreTrend(c);
    const stabilityScore = scoreStability(candidates, i);

    const totalScore =
      w.roeMean * roeMeanScore +
      w.growth * growthScore +
      w.trend * trendScore +
      w.stability * stabilityScore;

    return {
      market: c.market,
      code: c.code,
      name: c.name,
      totalScore,
      roeMeanScore,
      growthScore,
      trendScore,
      stabilityScore,
      roeMean5y: c.roeMean5y,
      netProfitCAGR5y: c.netProfitCAGR5y,
      revenueCAGR5y: c.revenueCAGR5y,
      roeCV5y: c.roeCV5y,
      netProfitDeclineYears: c.netProfitDeclineYears,
      trendState: c.trendState,
      yearPositionPct: c.yearPositionPct,
      reportYearsAvailable: c.reportYearsAvailable,
      growthDowngrade: c.growthDowngrade,
    };
  });

  scored.sort((a, b) => b.totalScore - a.totalScore);

  const markdown = buildMarkdown(scored, top, w, notes);

  return { markdown, ranked: scored, weightsApplied: w, notes };
}
