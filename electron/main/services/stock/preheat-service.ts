/**
 * 候选池预热服务
 *
 * 把"硬筛候选池 + 全池数据预热"编排成一次调用：baostock 硬筛一次，
 * 财报（主进程内串行，享受 Step 1 缓存）+ K线/信号（分批并发）+ 公告标题（分批并发）
 * 三条流水线并发跑完，产出完整的 CandidateData[] 供后续排序打分复用。
 *
 * 单只单维度失败只记入该只的 failures[]，不阻断整池；不重新实现 GetFinancials /
 * ListAnnouncements 已有的 fetch-or-cache 逻辑之外的新缓存策略，纯编排。
 */
import { stockService } from './stock-service.js';
import { stockDataService } from './stock-data-service.js';
import { pythonBridge } from './python-bridge.js';
import { readFinancialsCache, writeFinancialsCache } from './financials-cache-service.js';
import { listAnnouncements } from './announcement-service.js';

// ============================================================
// 类型定义
// ============================================================

export interface PreheatConditions {
  /** CSRC 行业分类名列表，逐个调用硬筛后合并去重；传空数组表示不限行业 */
  industries: string[];
  priceMax?: number;
  priceMin?: number;
  peMax?: number;
  peMin?: number;
  /** 单位：亿。当前快照数据源无股本数据，该条件多数情况下不生效（见 applyLocalFilters 注释） */
  marketCapMin?: number;
  marketCapMax?: number;
  /** 默认 true */
  excludeNegativePe?: boolean;
  /** 默认 true，按股票名称前缀（*ST/ST/SST/S*ST）过滤 */
  excludeSt?: boolean;
}

export interface PreheatOptions {
  /** 候选池上限，默认 50，最大 100 */
  limit?: number;
  /** 信号检测回看天数，默认 7 */
  wantSignalLookback?: number;
  /** 公告起始日期 YYYY-MM-DD，默认近 30 天 */
  wantAnnouncementSince?: string;
}

export interface CandidateSignal {
  date: string;
  name: string;
  description: string;
}

export interface CandidateAnnouncement {
  date: string;
  title: string;
  type: string;
  url: string;
}

/** 候选池单只数据（Step 3 输出、Step 4 输入，字段约定见 plan.md 全局决策） */
export interface CandidateData {
  market: number;
  code: string;
  name: string;
  price: number;
  changePercent: number;
  pe: number | null;
  pb: number | null;
  industry: string;
  /** 最近年报 ROE % */
  roe: number | null;
  /** 最近年报净利同比 % */
  netProfitYoY: number | null;
  /** 最近一期报告净利润单季同比 %；当前主数据源 baostock 恒不产出该字段（见文件末尾说明），多数情况下为 null */
  netProfitYoYQuarter: number | null;
  signals: CandidateSignal[];
  announcements: CandidateAnnouncement[];
  /** 哪些维度拉取失败了：'financials' | 'signals' | 'announcements' */
  failures: string[];
}

export interface PreheatStatus {
  /** 硬筛后进入预热流水线的候选池大小 */
  total: number;
  financialsHit: number;
  financialsFetched: number;
  signalsSuccess: number;
  announcementsSuccess: number;
  failuresByCategory: Record<string, number>;
}

export interface PreheatResult {
  candidates: CandidateData[];
  status: PreheatStatus;
  elapsedMs: number;
}

// ============================================================
// 常量
// ============================================================

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 100;
/** 每个行业硬筛调用的返回上限，多行业合并去重后再统一截断到 limit */
const SCREEN_LIMIT_PER_INDUSTRY = 100;
const SCREEN_TIMEOUT_MS = 120_000;
const FINANCIALS_TIMEOUT_MS = 30_000;
const SIGNAL_CALC_TIMEOUT_MS = 30_000;
/** 财报请求期数：覆盖近 1 年左右的报告，确保能找到最近一期年报 */
const FINANCIALS_WANT_PERIODS = 4;
/** K 线条数：预热只需覆盖信号计算所需的窗口，不追求指标计算的最大精度 */
const KLINE_LIMIT = 120;
const BATCH_SIZE = 5;
const DEFAULT_SIGNAL_LOOKBACK = 7;
const DEFAULT_ANNOUNCEMENT_SINCE_DAYS = 30;
const DEFAULT_ANNOUNCEMENT_LIMIT = 10;

// ============================================================
// 内部类型（python screen_stocks 原始返回结构）
// ============================================================

interface ScreenStockItem {
  code: string;
  name: string;
  market: number;
  price?: number;
  pe?: number | null;
  pb?: number | null;
  market_cap?: number | null;
  change_percent?: number;
  industry?: string;
}

interface ScreenStocksResult {
  total_scanned: number;
  total_matched: number;
  returned: number;
  stocks: ScreenStockItem[];
}

// ============================================================
// 工具函数
// ============================================================

function localDateKeyDaysAgo(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() - days);
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/** A 股 ST/*ST/SST/S*ST 一律是名称前缀，用前缀判断比子串匹配更准确 */
function isStName(name: string): boolean {
  return name.startsWith('*ST') || name.startsWith('ST') || name.startsWith('SST') || name.startsWith('S*ST');
}

async function processBatches<T>(
  items: T[],
  batchSize: number,
  worker: (item: T) => Promise<void>,
): Promise<void> {
  for (let i = 0; i < items.length; i += batchSize) {
    const batch = items.slice(i, i + batchSize);
    await Promise.all(batch.map(worker));
  }
}

function toNumberOrNull(val: unknown): number | null {
  if (val === null || val === undefined) return null;
  const num = Number(val);
  return Number.isFinite(num) ? num : null;
}

/**
 * 财报 fetch-or-cache：与 GetFinancials 工具（stock-analysis-tools.ts:411-438）逻辑一致，
 * 在本文件内独立实现以避免修改 Step 1 已交付的 financials-cache-service.ts 签名。
 */
async function fetchFinancialsWithCache(
  market: number,
  code: string,
  wantPeriods: number,
): Promise<{ periods: Array<Record<string, number | string | null>>; fromCache: boolean }> {
  const { hit, missingCount } = await readFinancialsCache(market, code, wantPeriods);

  let periods: Array<Record<string, number | string | null>>;
  let fromCache: boolean;

  if (missingCount === 0) {
    periods = hit.map((entry) => entry.data);
    fromCache = true;
  } else {
    const result = await pythonBridge.call<{
      symbol: string;
      periods: Array<Record<string, number | string | null>>;
      error?: string;
    }>('get_financials', { symbol: code, periods: wantPeriods }, FINANCIALS_TIMEOUT_MS);

    if (result.error) {
      throw new Error(result.error);
    }

    await writeFinancialsCache(market, code, result.periods);
    periods = result.periods;
    fromCache = false;
  }

  // 防御性排序：不依赖上游（缓存/Python）已经按 reportDate 降序返回
  const sorted = [...periods].sort((a, b) =>
    String(b.report_date ?? '').localeCompare(String(a.report_date ?? '')));

  return { periods: sorted, fromCache };
}

// ============================================================
// 步骤 1-4：硬筛 + 合并去重 + 本地过滤 + 排序截断
// ============================================================

async function screenAllIndustries(conditions: PreheatConditions): Promise<ScreenStockItem[]> {
  const industries = conditions.industries.length > 0 ? conditions.industries : [undefined];
  const merged = new Map<string, ScreenStockItem>();

  for (const industry of industries) {
    const screenConditions: Record<string, unknown> = {
      exclude_negative_pe: conditions.excludeNegativePe ?? true,
    };
    if (industry) screenConditions.industry = industry;
    if (conditions.priceMin !== undefined) screenConditions.price_min = conditions.priceMin;
    if (conditions.priceMax !== undefined) screenConditions.price_max = conditions.priceMax;
    if (conditions.peMin !== undefined) screenConditions.pe_min = conditions.peMin;
    if (conditions.peMax !== undefined) screenConditions.pe_max = conditions.peMax;
    if (conditions.marketCapMin !== undefined) screenConditions.market_cap_min = conditions.marketCapMin;
    if (conditions.marketCapMax !== undefined) screenConditions.market_cap_max = conditions.marketCapMax;

    const result = await pythonBridge.call<ScreenStocksResult>(
      'screen_stocks',
      { conditions: screenConditions, limit: SCREEN_LIMIT_PER_INDUSTRY },
      SCREEN_TIMEOUT_MS,
    );

    for (const stock of result.stocks) {
      merged.set(`${stock.market}-${stock.code}`, stock);
    }
  }

  return Array.from(merged.values());
}

/**
 * 本地二次过滤：price/pe 是防御性重复校验（服务端已过滤，多行业合并后再核对一次不会误伤）；
 * market_cap 是关键补丁——python screener 的市值字段当前恒为 null（快照无股本数据的 MVP 限制），
 * 服务端只是打日志跳过而不过滤，这里对有值的候选才应用阈值，避免全池被无意义清空。
 */
function applyLocalFilters(stocks: ScreenStockItem[], conditions: PreheatConditions): ScreenStockItem[] {
  const excludeSt = conditions.excludeSt ?? true;
  return stocks.filter((s) => {
    if (excludeSt && isStName(s.name)) return false;
    if (conditions.priceMin !== undefined && s.price !== undefined && s.price < conditions.priceMin) return false;
    if (conditions.priceMax !== undefined && s.price !== undefined && s.price > conditions.priceMax) return false;
    if (conditions.peMin !== undefined && s.pe != null && s.pe < conditions.peMin) return false;
    if (conditions.peMax !== undefined && s.pe != null && s.pe > conditions.peMax) return false;
    if (conditions.marketCapMin !== undefined && s.market_cap != null && s.market_cap < conditions.marketCapMin) return false;
    if (conditions.marketCapMax !== undefined && s.market_cap != null && s.market_cap > conditions.marketCapMax) return false;
    return true;
  });
}

/** 估值优先：PE 升序，null（含被服务端排除后残留的极端值）排到最后 */
function sortByPeAscending(stocks: ScreenStockItem[]): ScreenStockItem[] {
  return [...stocks].sort((a, b) => {
    const peA = a.pe ?? null;
    const peB = b.pe ?? null;
    if (peA === null && peB === null) return 0;
    if (peA === null) return 1;
    if (peB === null) return -1;
    return peA - peB;
  });
}

// ============================================================
// 步骤 5：三条预热流水线
// ============================================================

/** 财报流水线：主进程内 for-await 顺序调用，Step 1 缓存命中时接近零耗时 */
async function runFinancialsPipeline(candidates: CandidateData[], status: PreheatStatus): Promise<void> {
  for (const candidate of candidates) {
    try {
      const { periods, fromCache } = await fetchFinancialsWithCache(
        candidate.market, candidate.code, FINANCIALS_WANT_PERIODS,
      );
      if (fromCache) status.financialsHit += 1;
      else status.financialsFetched += 1;

      if (periods.length === 0) {
        candidate.failures.push('financials');
        continue;
      }

      // periods[0] 是最近一期报告（可能是年报也可能是季报），取其净利同比作为"最近一期"口径
      candidate.netProfitYoYQuarter = toNumberOrNull(periods[0].net_profit_single_yoy);

      const latestAnnual = periods.find((p) => String(p.report_date ?? '').endsWith('-12-31'));
      if (latestAnnual) {
        candidate.roe = toNumberOrNull(latestAnnual.roe);
        candidate.netProfitYoY = toNumberOrNull(latestAnnual.net_profit_yoy);
      }
    } catch (err) {
      console.warn(`[Preheat] 财报拉取失败 ${candidate.market}.${candidate.code}:`, err);
      candidate.failures.push('financials');
    }
  }
}

/** K线 + 信号流水线：每批 5 只并发，批内 Promise.all 批间串行 */
async function runSignalsPipeline(
  candidates: CandidateData[],
  status: PreheatStatus,
  lookback: number,
): Promise<void> {
  await processBatches(candidates, BATCH_SIZE, async (candidate) => {
    try {
      const secid = `${candidate.market}.${candidate.code}`;
      const klineData = await stockService.getKLine({
        secid,
        period: 101,
        adjust: 1,
        limit: KLINE_LIMIT,
      });

      if (klineData.length === 0) {
        candidate.failures.push('signals');
        return;
      }

      stockDataService.appendKLine(candidate.market, candidate.code, klineData)
        .catch((err: unknown) => console.warn(`[Preheat] K线存储失败 ${secid}:`, err));

      const result = await pythonBridge.call<{
        detected: Array<{ signal_id: string; name: string; description: string; date: string; details: string }>;
      }>('detect_signals', { kline: klineData, signals: null, lookback }, SIGNAL_CALC_TIMEOUT_MS);

      candidate.signals = result.detected.map((s) => ({ date: s.date, name: s.name, description: s.description }));
      status.signalsSuccess += 1;
    } catch (err) {
      console.warn(`[Preheat] 信号检测失败 ${candidate.market}.${candidate.code}:`, err);
      candidate.failures.push('signals');
    }
  });
}

/** 公告标题流水线：每批 5 只并发；不传 market，交给 listAnnouncements 按代码前缀自动推断 */
async function runAnnouncementsPipeline(
  candidates: CandidateData[],
  status: PreheatStatus,
  since: string,
): Promise<void> {
  await processBatches(candidates, BATCH_SIZE, async (candidate) => {
    try {
      const result = await listAnnouncements(candidate.code, undefined, {
        since,
        limit: DEFAULT_ANNOUNCEMENT_LIMIT,
      });

      if (!result.ok) {
        candidate.failures.push('announcements');
        return;
      }

      candidate.announcements = result.data.map((a) => ({ date: a.date, title: a.title, type: a.type, url: a.url }));
      status.announcementsSuccess += 1;
    } catch (err) {
      console.warn(`[Preheat] 公告拉取失败 ${candidate.code}:`, err);
      candidate.failures.push('announcements');
    }
  });
}

// ============================================================
// 主入口
// ============================================================

export async function preheatCandidatePool(
  conditions: PreheatConditions,
  options: PreheatOptions = {},
): Promise<PreheatResult> {
  const startedAt = Date.now();
  const limit = Math.min(Math.max(options.limit ?? DEFAULT_LIMIT, 1), MAX_LIMIT);
  const lookback = options.wantSignalLookback ?? DEFAULT_SIGNAL_LOOKBACK;
  const since = options.wantAnnouncementSince ?? localDateKeyDaysAgo(DEFAULT_ANNOUNCEMENT_SINCE_DAYS);

  // 1-4. 硬筛（多行业合并去重）+ 本地过滤 + PE 升序排序 + 截断到 limit
  const screened = await screenAllIndustries(conditions);
  const filtered = applyLocalFilters(screened, conditions);
  const sorted = sortByPeAscending(filtered);
  const pool = sorted.slice(0, limit);

  const candidates: CandidateData[] = pool.map((stock) => ({
    market: stock.market,
    code: stock.code,
    name: stock.name,
    price: stock.price ?? 0,
    changePercent: stock.change_percent ?? 0,
    pe: stock.pe ?? null,
    pb: stock.pb ?? null,
    industry: stock.industry ?? '',
    roe: null,
    netProfitYoY: null,
    netProfitYoYQuarter: null,
    signals: [],
    announcements: [],
    failures: [],
  }));

  const status: PreheatStatus = {
    total: candidates.length,
    financialsHit: 0,
    financialsFetched: 0,
    signalsSuccess: 0,
    announcementsSuccess: 0,
    failuresByCategory: {},
  };

  // 5. 三条流水线并发执行（各自内部并发策略不同，见各函数注释）
  await Promise.all([
    runFinancialsPipeline(candidates, status),
    runSignalsPipeline(candidates, status, lookback),
    runAnnouncementsPipeline(candidates, status, since),
  ]);

  // 6-7. 汇总 failuresByCategory + elapsedMs
  for (const candidate of candidates) {
    for (const failure of candidate.failures) {
      status.failuresByCategory[failure] = (status.failuresByCategory[failure] ?? 0) + 1;
    }
  }

  return {
    candidates,
    status,
    elapsedMs: Date.now() - startedAt,
  };
}
