// 长期选股预热服务 — 公共类型定义
// 由 long-term-preheat-service.ts 和 long-term-rank-service.ts 共同引用

export interface LongTermPreheatConditions {
  industries: string[];
  excludeNegativePe?: boolean;
  excludeSt?: boolean;
}

export interface LongTermPreheatOptions {
  limit?: number;
  wantBatchSize?: number;
}

export interface LongTermAnnualReport {
  year: number;
  roe: number | null;
  netProfit: number | null;
  revenue: number | null;
  netProfitYoY: number | null;
}

export interface LongTermCandidateData {
  market: number;
  code: string;
  name: string;
  industry: string;

  // 5 年财报聚合（Python long_term_financials 返回，snake_case → camelCase）
  annualReports: LongTermAnnualReport[];
  roeMean5y: number | null;
  netProfitCAGR5y: number | null;
  revenueCAGR5y: number | null;
  roeCV5y: number | null;
  netProfitDeclineYears: number;
  reportYearsAvailable: number;
  growthDowngrade: boolean;

  // 周 K 聚合（TS 端算）
  weeklyMA26: number | null;
  weeklyMA52: number | null;
  ma26Slope: 'up' | 'flat' | 'down';
  trendState: 'strong_bull' | 'consolidation' | 'pullback' | 'bear' | 'insufficient';
  klinePeriodsAvailable: number;

  // 年内位置（来自周 K 数据）
  currentPrice: number;
  yearHigh: number;
  yearLow: number;
  yearPositionPct: number;

  failures: Array<'financials' | 'kline'>;
}

export interface LongTermPreheatStatus {
  total: number;
  afterPreflight: number;
  preflightFailed: number;
  insufficientYears: number;
  klineFailed: number;
  financialsFullYears: number;
  financialsPartialYears: number;
  klineSuccess: number;
  snapshotDate: string;
  failuresByCategory: Record<string, number>;
}

export type LongTermPreheatResult =
  | { ok: true; candidates: LongTermCandidateData[]; status: LongTermPreheatStatus; elapsedMs: number }
  | { ok: false; error: string };
