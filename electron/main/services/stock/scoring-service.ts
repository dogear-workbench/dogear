/**
 * 综合评分服务
 *
 * 纯函数：输入 PreheatCandidatePool 产出的候选池 + 权重，输出按综合分排序的完整列表。
 * 不做任何 IO；不复用/依赖任何异步服务，可被 RankCandidates 工具直接调用，也方便 agent
 * 用不同权重反复重跑试算。
 */
import type { CandidateData } from './preheat-service.js';

// ============================================================
// 类型定义
// ============================================================

export interface ScoringWeights {
  /** 默认 0.25 */
  roe: number;
  /** 默认 0.25，净利增速 */
  growth: number;
  /** 默认 0.20，PE 倒数 */
  valuation: number;
  /** 默认 0.15，信号强度 */
  signal: number;
  /** 默认 0.10，公告催化剂 */
  catalyst: number;
  /** 默认 0.05，业绩下滑惩罚（实际是负权重） */
  penalty: number;
}

export interface RankedCandidate extends CandidateData {
  /** 综合分，各维度加权求和后减去惩罚项，量级参考 0-100（非严格上下界） */
  score: number;
  /** 每维度原始得分（0-100），未乘权重，供展示每维度贡献 */
  scoreBreakdown: Record<keyof ScoringWeights, number>;
  /** 按 score 降序排列后的名次，从 1 开始 */
  rank: number;
}

const DIMENSION_KEYS: (keyof ScoringWeights)[] = ['roe', 'growth', 'valuation', 'signal', 'catalyst', 'penalty'];

export const DEFAULT_WEIGHTS: ScoringWeights = {
  roe: 0.25,
  growth: 0.25,
  valuation: 0.20,
  signal: 0.15,
  catalyst: 0.10,
  penalty: 0.05,
};

// ============================================================
// 信号强度打分
// ============================================================

/** 信号名（对应 python/core/signals.py SIGNAL_DEFINITIONS 的中文 name）→ 加减分 */
const SIGNAL_POINTS: Record<string, number> = {
  'MACD金叉': 30,
  'KDJ金叉': 15,
  '均线多头排列': 20,
  '突破布林上轨': 20,
  '成交量突破': 10,
  'RSI超卖': 10,
  'KDJ超卖': 5,
  'MACD死叉': -20,
  'KDJ超买': -10,
  'RSI超买': -10,
  '跌破布林下轨': -15,
};

/** 距今天数衰减权重：今日 1.0 线性插值到 7 天前 0.3，超过 7 天固定 0.3 */
function decayWeight(daysAgo: number): number {
  if (daysAgo <= 0) return 1.0;
  if (daysAgo >= 7) return 0.3;
  return 1.0 - (0.7 / 7) * daysAgo;
}

function daysBetween(dateStr: string, today: Date): number {
  const target = new Date(`${dateStr}T00:00:00`);
  if (Number.isNaN(target.getTime())) return 7; // 解析失败按最弱权重处理，不放大异常数据影响
  const diffMs = today.getTime() - target.getTime();
  return Math.max(0, Math.round(diffMs / (24 * 60 * 60 * 1000)));
}

function computeSignalScore(candidate: CandidateData, today: Date): number {
  let sum = 0;
  for (const sig of candidate.signals) {
    const base = SIGNAL_POINTS[sig.name];
    if (base === undefined) continue;
    sum += base * decayWeight(daysBetween(sig.date, today));
  }
  return Math.min(100, Math.max(0, sum));
}

// ============================================================
// 公告催化剂打分
// ============================================================

/** 标题关键词 → 加减分（中性关键词不列入表内，天然贡献 0） */
const ANNOUNCEMENT_KEYWORD_POINTS: Array<{ keyword: string; points: number }> = [
  { keyword: '业绩预告', points: 30 },
  { keyword: '中标', points: 30 },
  { keyword: '增发', points: 30 },
  { keyword: '收购', points: 30 },
  { keyword: '股权激励', points: 20 },
  { keyword: '回购', points: 20 },
  { keyword: '分红', points: 15 },
  { keyword: '权益分派', points: 15 },
  { keyword: '诉讼', points: -10 },
  { keyword: '减持', points: -10 },
];

function computeCatalystScore(candidate: CandidateData): number {
  let sum = 0;
  for (const ann of candidate.announcements) {
    for (const { keyword, points } of ANNOUNCEMENT_KEYWORD_POINTS) {
      if (ann.title.includes(keyword)) sum += points;
    }
  }
  return Math.min(100, Math.max(0, sum));
}

// ============================================================
// 业绩下滑惩罚
// ============================================================

/** 两期净利同比中较差（更负）的一个；均缺失时返回 null */
function worstDecline(candidate: CandidateData): number | null {
  const { netProfitYoY, netProfitYoYQuarter } = candidate;
  if (netProfitYoY === null && netProfitYoYQuarter === null) return null;
  if (netProfitYoY === null) return netProfitYoYQuarter;
  if (netProfitYoYQuarter === null) return netProfitYoY;
  return Math.min(netProfitYoY, netProfitYoYQuarter);
}

function computePenaltyScore(candidate: CandidateData): number {
  const annualHit = candidate.netProfitYoY !== null && candidate.netProfitYoY < -20;
  const quarterHit = candidate.netProfitYoYQuarter !== null && candidate.netProfitYoYQuarter < -30;
  if (annualHit || quarterHit) return 100;

  const decline = worstDecline(candidate);
  if (decline === null || decline >= 0) return 0;
  // 线性：0% -> 0 分，-50% -> 100 分
  return Math.min(100, Math.max(0, (Math.abs(decline) / 50) * 100));
}

// ============================================================
// 分位数打分
// ============================================================

/** 增速口径：两期净利同比取更大者（更能代表当前增速），均缺失返回 null */
function growthValue(candidate: CandidateData): number | null {
  const { netProfitYoY, netProfitYoYQuarter } = candidate;
  if (netProfitYoY === null && netProfitYoYQuarter === null) return null;
  if (netProfitYoY === null) return netProfitYoYQuarter;
  if (netProfitYoYQuarter === null) return netProfitYoY;
  return Math.max(netProfitYoY, netProfitYoYQuarter);
}

/** PE 倒数：PE 越低越好，倒数后按"越大越好"统一走升序分位数逻辑；PE 非正视为缺失 */
function valuationValue(candidate: CandidateData): number | null {
  if (candidate.pe === null || candidate.pe <= 0) return null;
  return 1 / candidate.pe;
}

/**
 * 分位数打分：数值越大排名越高，得分 0-100（0=池内最差，100=池内最优）。
 * null 值不参与排序，固定得 0 分（缺失即视为该维度最弱）。
 * 全池皆为 null 时返回全 0（该维度权重会在 computeEffectiveWeights 中被归零，此时分数无意义）。
 */
function percentileScores(values: Array<number | null>): number[] {
  const validIndices = values
    .map((v, i) => (v !== null ? i : -1))
    .filter((i) => i >= 0);

  const scores = new Array(values.length).fill(0);
  const n = validIndices.length;
  if (n === 0) return scores;
  if (n === 1) {
    scores[validIndices[0]] = 100;
    return scores;
  }

  const sortedIndices = [...validIndices].sort((a, b) => (values[a] as number) - (values[b] as number));
  sortedIndices.forEach((idx, rank) => {
    scores[idx] = (rank / (n - 1)) * 100;
  });
  return scores;
}

// ============================================================
// 权重归一化 + 全池缺失归零
// ============================================================

export interface EffectiveWeightsResult {
  weights: ScoringWeights;
  /** 因全池该维度数据缺失被归零的维度（roe/growth/valuation/penalty 才可能出现，signal/catalyst 恒不缺失） */
  zeroedDimensions: (keyof ScoringWeights)[];
}

function computeEffectiveWeights(
  candidates: CandidateData[],
  userWeights: Partial<ScoringWeights>,
): EffectiveWeightsResult {
  const merged: ScoringWeights = { ...DEFAULT_WEIGHTS, ...userWeights };

  const presence: Record<keyof ScoringWeights, boolean> = {
    roe: candidates.some((c) => c.roe !== null),
    growth: candidates.some((c) => growthValue(c) !== null),
    valuation: candidates.some((c) => valuationValue(c) !== null),
    signal: true,
    catalyst: true,
    penalty: candidates.some((c) => worstDecline(c) !== null),
  };

  const zeroedDimensions: (keyof ScoringWeights)[] = [];
  const effective: ScoringWeights = { ...merged };
  for (const key of DIMENSION_KEYS) {
    if (!presence[key] && effective[key] !== 0) {
      zeroedDimensions.push(key);
      effective[key] = 0;
    }
  }

  const sum = DIMENSION_KEYS.reduce((acc, key) => acc + effective[key], 0);
  if (sum <= 0) {
    return {
      weights: { roe: 0, growth: 0, valuation: 0, signal: 0, catalyst: 0, penalty: 0 },
      zeroedDimensions,
    };
  }

  const scale = 1 / sum;
  const normalized = DIMENSION_KEYS.reduce((acc, key) => {
    acc[key] = effective[key] * scale;
    return acc;
  }, {} as ScoringWeights);

  return { weights: normalized, zeroedDimensions };
}

// ============================================================
// 主入口
// ============================================================

export function scoreAndRank(
  candidates: CandidateData[],
  weights: Partial<ScoringWeights> = {},
): RankedCandidate[] {
  if (candidates.length === 0) return [];

  const { weights: w } = computeEffectiveWeights(candidates, weights);
  const today = new Date();

  const roePct = percentileScores(candidates.map((c) => c.roe));
  const growthPct = percentileScores(candidates.map((c) => growthValue(c)));
  const valuationPct = percentileScores(candidates.map((c) => valuationValue(c)));

  const ranked: RankedCandidate[] = candidates.map((candidate, i) => {
    const signalScore = computeSignalScore(candidate, today);
    const catalystScore = computeCatalystScore(candidate);
    const penaltyScore = computePenaltyScore(candidate);

    const scoreBreakdown: Record<keyof ScoringWeights, number> = {
      roe: roePct[i],
      growth: growthPct[i],
      valuation: valuationPct[i],
      signal: signalScore,
      catalyst: catalystScore,
      penalty: penaltyScore,
    };

    const score =
      w.roe * roePct[i] +
      w.growth * growthPct[i] +
      w.valuation * valuationPct[i] +
      w.signal * signalScore +
      w.catalyst * catalystScore -
      w.penalty * penaltyScore;

    return { ...candidate, score, scoreBreakdown, rank: 0 };
  });

  ranked.sort((a, b) => b.score - a.score);
  ranked.forEach((item, i) => { item.rank = i + 1; });

  return ranked;
}

/** 供 RankCandidates 工具展示"哪些维度权重被重分配"，与 scoreAndRank 内部逻辑保持一致 */
export function getEffectiveWeights(
  candidates: CandidateData[],
  weights: Partial<ScoringWeights> = {},
): EffectiveWeightsResult {
  return computeEffectiveWeights(candidates, weights);
}
