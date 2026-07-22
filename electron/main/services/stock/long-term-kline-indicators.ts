import type { KLineDataPoint } from './stock-service.js';

export interface WeeklyKLineResult {
  weeklyMA26: number | null;
  weeklyMA52: number | null;
  ma26Slope: 'up' | 'flat' | 'down';
  trendState: 'strong_bull' | 'consolidation' | 'pullback' | 'bear' | 'insufficient';
  klinePeriodsAvailable: number;
  currentPrice: number;
  yearHigh: number;
  yearLow: number;
  yearPositionPct: number;
}

function calcMA(closes: number[], period: number, index: number): number | null {
  if (index < period - 1) return null;
  const slice = closes.slice(index - period + 1, index + 1);
  return slice.reduce((sum, v) => sum + v, 0) / period;
}

function deriveSlopeDirection(
  closes: number[],
  period: number,
  latestIdx: number,
  lookback: number,
): 'up' | 'flat' | 'down' {
  if (latestIdx < lookback) return 'flat';
  const maLatest = calcMA(closes, period, latestIdx);
  const maPrev = calcMA(closes, period, latestIdx - lookback);
  if (maLatest === null || maPrev === null || maPrev <= 0) return 'flat';
  if (maLatest > maPrev * 1.005) return 'up';
  if (maLatest < maPrev * 0.995) return 'down';
  return 'flat';
}

/**
 * 从 250 期周 K 数据派生长期趋势指标。
 *
 * trendState 判定规则（对齐 design.md）：
 *   strong_bull : close > MA26 > MA52 且 MA26 近 4 周上升
 *   consolidation: close > MA26，MA26/MA52 相差 < 2%（缠绕）
 *   pullback    : close < MA26 但 MA52 近 4 周仍在上升
 *   bear        : 其余（MA26 < MA52 或双线下降）
 *   insufficient: 数据不足 100 期，无法可靠判断
 *
 * yearPositionPct = (close - min(low)) / (max(high) - min(low)) × 100
 * MA26Slope 判定：最新 MA26 vs 4 周前 MA26，涨 > 0.5% → up，跌 > 0.5% → down
 */
export function computeWeeklyIndicators(klineData: KLineDataPoint[]): WeeklyKLineResult {
  const n = klineData.length;

  if (n === 0) {
    return {
      weeklyMA26: null, weeklyMA52: null, ma26Slope: 'flat',
      trendState: 'insufficient', klinePeriodsAvailable: 0,
      currentPrice: 0, yearHigh: 0, yearLow: 0, yearPositionPct: 0,
    };
  }

  const closes = klineData.map((k) => k.close);
  const highs = klineData.map((k) => k.high);
  const lows = klineData.map((k) => k.low);
  const lastIdx = n - 1;
  const currentPrice = closes[lastIdx];

  const yearHigh = Math.max(...highs);
  const yearLow = Math.min(...lows);
  const range = yearHigh - yearLow;
  const yearPositionPct = range > 0
    ? Math.round(((currentPrice - yearLow) / range) * 10000) / 100
    : 50;

  if (n < 100) {
    return {
      weeklyMA26: null, weeklyMA52: null, ma26Slope: 'flat',
      trendState: 'insufficient', klinePeriodsAvailable: n,
      currentPrice, yearHigh, yearLow, yearPositionPct,
    };
  }

  // n >= 100 保证 MA26 和 MA52 均可计算（52 <= 100 <= n）
  const ma26 = calcMA(closes, 26, lastIdx) as number;
  const ma52 = calcMA(closes, 52, lastIdx) as number;
  const ma26Slope = deriveSlopeDirection(closes, 26, lastIdx, 4);
  const ma52Slope = deriveSlopeDirection(closes, 52, lastIdx, 4);

  let trendState: WeeklyKLineResult['trendState'];
  if (currentPrice > ma26 && ma26 > ma52 && ma26Slope === 'up') {
    trendState = 'strong_bull';
  } else if (currentPrice > ma26 && ma52 > 0 && Math.abs(ma26 - ma52) / ma52 < 0.02) {
    trendState = 'consolidation';
  } else if (currentPrice < ma26 && ma52Slope === 'up') {
    trendState = 'pullback';
  } else {
    trendState = 'bear';
  }

  return {
    weeklyMA26: ma26, weeklyMA52: ma52, ma26Slope,
    trendState, klinePeriodsAvailable: n,
    currentPrice, yearHigh, yearLow, yearPositionPct,
  };
}
