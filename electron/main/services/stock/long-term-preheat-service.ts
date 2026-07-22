import { pythonBridge } from './python-bridge.js';
import { stockService } from './stock-service.js';
import { computeWeeklyIndicators } from './long-term-kline-indicators.js';
import type {
  LongTermPreheatConditions,
  LongTermPreheatOptions,
  LongTermCandidateData,
  LongTermPreheatStatus,
  LongTermPreheatResult,
} from './long-term-types.js';

export type {
  LongTermPreheatConditions,
  LongTermPreheatOptions,
  LongTermCandidateData,
  LongTermAnnualReport,
  LongTermPreheatStatus,
  LongTermPreheatResult,
} from './long-term-types.js';

// ============================================================
// 常量
// ============================================================

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 100;
const SCREEN_LIMIT_PER_INDUSTRY = 200;
const SCREEN_TIMEOUT_MS = 600_000;
const PREFLIGHT_TIMEOUT_MS = 20_000;
const FINANCIALS_TIMEOUT_MS = 15_000;
const PREFLIGHT_BATCH_SIZE = 10;
const DEFAULT_BATCH_SIZE = 5;

// ============================================================
// Python 侧内部类型（snake_case）
// ============================================================

interface ScreenStockItem {
  code: string;
  name: string;
  market: number;
  pe?: number | null;
  industry?: string;
}

interface ScreenStocksResult {
  total_scanned: number;
  total_matched: number;
  returned: number;
  stocks: ScreenStockItem[];
}

interface LongTermFinancialsRaw {
  symbol: string;
  annual_reports: Array<{
    year: number;
    roe: number | null;
    net_profit: number | null;
    revenue: number | null;
    net_profit_yoy: number | null;
  }>;
  roe_mean_5y: number | null;
  net_profit_cagr_5y: number | null;
  revenue_cagr_5y: number | null;
  roe_cv_5y: number | null;
  net_profit_decline_years: number;
  report_years_available: number;
  growth_downgrade: boolean;
  error?: string;
  error_type?: string;
}

// ============================================================
// 工具函数
// ============================================================

function todayDateString(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function isStName(name: string): boolean {
  return name.startsWith('*ST') || name.startsWith('ST') || name.startsWith('SST') || name.startsWith('S*ST');
}

function toNumberOrNull(val: unknown): number | null {
  if (val === null || val === undefined) return null;
  const num = Number(val);
  return Number.isFinite(num) ? num : null;
}

async function processBatches<T>(
  items: T[],
  batchSize: number,
  worker: (item: T) => Promise<void>,
): Promise<void> {
  for (let i = 0; i < items.length; i += batchSize) {
    await Promise.all(items.slice(i, i + batchSize).map(worker));
  }
}

function stockKey(market: number, code: string): string {
  return `${market}-${code}`;
}

// ============================================================
// Step 1-3：硬筛 + 本地过滤 + 稳定排序 + 截断
// ============================================================

async function screenAllIndustries(conditions: LongTermPreheatConditions): Promise<ScreenStockItem[]> {
  const merged = new Map<string, ScreenStockItem>();

  for (const industry of conditions.industries) {
    const result = await pythonBridge.call<ScreenStocksResult>(
      'screen_stocks',
      {
        conditions: { industry, exclude_negative_pe: conditions.excludeNegativePe ?? true },
        limit: SCREEN_LIMIT_PER_INDUSTRY,
      },
      SCREEN_TIMEOUT_MS,
    );

    for (const stock of result.stocks) {
      merged.set(stockKey(stock.market, stock.code), stock);
    }
  }

  return Array.from(merged.values());
}

function applyLocalFilters(stocks: ScreenStockItem[], conditions: LongTermPreheatConditions): ScreenStockItem[] {
  const excludeSt = conditions.excludeSt ?? true;
  return stocks.filter((s) => !(excludeSt && isStName(s.name)));
}

function stableSort(stocks: ScreenStockItem[]): ScreenStockItem[] {
  return [...stocks].sort((a, b) => (a.market * 1e5 + Number(a.code)) - (b.market * 1e5 + Number(b.code)));
}

// ============================================================
// Step 4：可获取性预检（并发 10 只，只拉 1 期财报）
// ============================================================

async function runPreflight(
  pool: ScreenStockItem[],
  status: LongTermPreheatStatus,
): Promise<ScreenStockItem[]> {
  const passedKeys = new Set<string>();
  const failedKeys = new Set<string>();

  await processBatches(pool, PREFLIGHT_BATCH_SIZE, async (stock) => {
    try {
      const result = await pythonBridge.call<{ symbol: string; periods: unknown[]; error?: string }>(
        'get_financials',
        { symbol: stock.code, periods: 1 },
        PREFLIGHT_TIMEOUT_MS,
      );
      const key = stockKey(stock.market, stock.code);
      if (result.error || !result.periods || result.periods.length === 0) {
        failedKeys.add(key);
      } else {
        passedKeys.add(key);
      }
    } catch {
      failedKeys.add(stockKey(stock.market, stock.code));
    }
  });

  status.preflightFailed = failedKeys.size;
  const passed = pool.filter((s) => passedKeys.has(stockKey(s.market, s.code)));
  status.afterPreflight = passed.length;
  return passed;
}

// ============================================================
// Step 5：5 年财报拉取（每批 batchSize 只，Python 端串行）
// ============================================================

async function fetchAllFinancials(
  candidates: LongTermCandidateData[],
  status: LongTermPreheatStatus,
  batchSize: number,
): Promise<LongTermCandidateData[]> {
  const droppedKeys = new Set<string>();

  await processBatches(candidates, batchSize, async (candidate) => {
    const key = stockKey(candidate.market, candidate.code);
    try {
      const raw = await pythonBridge.call<LongTermFinancialsRaw>(
        'long_term_financials',
        { symbol: candidate.code },
        FINANCIALS_TIMEOUT_MS,
      );

      if (raw.error) {
        candidate.failures.push('financials');
        status.failuresByCategory['financials'] = (status.failuresByCategory['financials'] ?? 0) + 1;
        droppedKeys.add(key);
        return;
      }

      if (raw.report_years_available < 3) {
        status.insufficientYears += 1;
        droppedKeys.add(key);
        return;
      }

      candidate.annualReports = raw.annual_reports.map((r) => ({
        year: r.year,
        roe: toNumberOrNull(r.roe),
        netProfit: toNumberOrNull(r.net_profit),
        revenue: toNumberOrNull(r.revenue),
        netProfitYoY: toNumberOrNull(r.net_profit_yoy),
      }));
      candidate.roeMean5y = toNumberOrNull(raw.roe_mean_5y);
      candidate.netProfitCAGR5y = toNumberOrNull(raw.net_profit_cagr_5y);
      candidate.revenueCAGR5y = toNumberOrNull(raw.revenue_cagr_5y);
      candidate.roeCV5y = toNumberOrNull(raw.roe_cv_5y);
      candidate.netProfitDeclineYears = raw.net_profit_decline_years ?? 0;
      candidate.reportYearsAvailable = raw.report_years_available;
      candidate.growthDowngrade = raw.growth_downgrade ?? false;

      if (raw.report_years_available >= 5) {
        status.financialsFullYears += 1;
      } else {
        status.financialsPartialYears += 1;
      }
    } catch (err) {
      console.warn(`[LongTermPreheat] 财报失败 ${candidate.market}.${candidate.code}:`, err);
      candidate.failures.push('financials');
      status.failuresByCategory['financials'] = (status.failuresByCategory['financials'] ?? 0) + 1;
      droppedKeys.add(key);
    }
  });

  return candidates.filter((c) => !droppedKeys.has(stockKey(c.market, c.code)));
}

// ============================================================
// Step 6：周 K 拉取 + 派生指标（每批 batchSize 只，走 rate-limiter）
// ============================================================

async function fetchAllWeeklyKLines(
  candidates: LongTermCandidateData[],
  status: LongTermPreheatStatus,
  batchSize: number,
): Promise<LongTermCandidateData[]> {
  const droppedKeys = new Set<string>();

  await processBatches(candidates, batchSize, async (candidate) => {
    const key = stockKey(candidate.market, candidate.code);
    const secid = `${candidate.market}.${candidate.code}`;
    try {
      const klineData = await stockService.getKLine({ secid, period: 102, adjust: 1, limit: 250 });

      if (klineData.length === 0) {
        status.klineFailed += 1;
        status.failuresByCategory['kline'] = (status.failuresByCategory['kline'] ?? 0) + 1;
        droppedKeys.add(key);
        return;
      }

      const ind = computeWeeklyIndicators(klineData);
      candidate.weeklyMA26 = ind.weeklyMA26;
      candidate.weeklyMA52 = ind.weeklyMA52;
      candidate.ma26Slope = ind.ma26Slope;
      candidate.trendState = ind.trendState;
      candidate.klinePeriodsAvailable = ind.klinePeriodsAvailable;
      candidate.currentPrice = ind.currentPrice;
      candidate.yearHigh = ind.yearHigh;
      candidate.yearLow = ind.yearLow;
      candidate.yearPositionPct = ind.yearPositionPct;
      status.klineSuccess += 1;
    } catch (err) {
      console.warn(`[LongTermPreheat] 周K失败 ${secid}:`, err);
      status.klineFailed += 1;
      status.failuresByCategory['kline'] = (status.failuresByCategory['kline'] ?? 0) + 1;
      droppedKeys.add(key);
    }
  });

  return candidates.filter((c) => !droppedKeys.has(stockKey(c.market, c.code)));
}

// ============================================================
// Step 7：数据完整性检查（4 维度 ≥3 个 null → 剔除）
// ============================================================

function checkIntegrity(candidates: LongTermCandidateData[]): LongTermCandidateData[] {
  return candidates.filter((c) => {
    const nullCount = [
      c.roeMean5y === null,
      c.netProfitCAGR5y === null,
      c.trendState === 'insufficient',
      c.roeCV5y === null,
    ].filter(Boolean).length;
    return nullCount < 3;
  });
}

// ============================================================
// 主入口
// ============================================================

export async function preheatLongTermPool(
  conditions: LongTermPreheatConditions,
  options: LongTermPreheatOptions = {},
): Promise<LongTermPreheatResult> {
  if (!conditions.industries || conditions.industries.length === 0) {
    return { ok: false, error: 'industries 不能为空，至少指定一个 CSRC 行业分类名' };
  }

  const startedAt = Date.now();
  const limit = Math.min(Math.max(options.limit ?? DEFAULT_LIMIT, 1), MAX_LIMIT);
  const batchSize = options.wantBatchSize ?? DEFAULT_BATCH_SIZE;

  const status: LongTermPreheatStatus = {
    total: 0, afterPreflight: 0, preflightFailed: 0,
    insufficientYears: 0, klineFailed: 0,
    financialsFullYears: 0, financialsPartialYears: 0,
    klineSuccess: 0, snapshotDate: todayDateString(), failuresByCategory: {},
  };

  // Step 1-3
  let screened: ScreenStockItem[];
  try {
    screened = await screenAllIndustries(conditions);
  } catch (err) {
    return { ok: false, error: `硬筛失败（Python Bridge 异常）: ${err instanceof Error ? err.message : String(err)}` };
  }

  const pool = stableSort(applyLocalFilters(screened, conditions)).slice(0, limit);
  if (pool.length === 0) {
    return { ok: false, error: '硬筛后 0 只候选，请检查 industries 行业名是否正确（CSRC 分类名需精确匹配）' };
  }
  status.total = pool.length;

  // Step 4
  const preflightPassed = await runPreflight(pool, status);
  if (preflightPassed.length === 0) {
    return { ok: false, error: `候选池 ${pool.length} 只全部预检失败，无可参评标的` };
  }

  // 构建 candidate 对象
  const candidates: LongTermCandidateData[] = preflightPassed.map((stock) => ({
    market: stock.market, code: stock.code, name: stock.name, industry: stock.industry ?? '',
    annualReports: [], roeMean5y: null, netProfitCAGR5y: null, revenueCAGR5y: null,
    roeCV5y: null, netProfitDeclineYears: 0, reportYearsAvailable: 0, growthDowngrade: false,
    weeklyMA26: null, weeklyMA52: null, ma26Slope: 'flat' as const, trendState: 'insufficient' as const,
    klinePeriodsAvailable: 0, currentPrice: 0, yearHigh: 0, yearLow: 0, yearPositionPct: 0, failures: [],
  }));

  // Step 5
  const financialsPassed = await fetchAllFinancials(candidates, status, batchSize);
  if (financialsPassed.length === 0) {
    return { ok: false, error: '所有候选财报数据年份不足（<3 年），无可参评标的' };
  }

  // Step 6
  const klinePassed = await fetchAllWeeklyKLines(financialsPassed, status, batchSize);

  // Step 7
  return {
    ok: true,
    candidates: checkIntegrity(klinePassed),
    status,
    elapsedMs: Date.now() - startedAt,
  };
}
