/**
 * 东方财富 API 服务 — StockService
 *
 * 封装所有东方财富行情接口，所有请求经由 RateLimiter 保护（限流 + 缓存 + 熔断）。
 *
 * API 列表：
 *   - batchQuotes   批量实时行情
 *   - getQuote      单股实时行情
 *   - getKLine      K 线历史数据
 *   - getTimeline   当日分时数据
 *   - getMoneyFlow  资金流向（日 K 级）
 *   - search        股票搜索
 */

import { rateLimiter, type RateLimiterStatus } from './rate-limiter';

// ============================================================
// 常量
// ============================================================

/** 行情缓存 10s */
const QUOTE_CACHE_TTL = 10_000;
/** K线缓存 60s */
const KLINE_CACHE_TTL = 60_000;
/** 搜索缓存 5min */
const SEARCH_CACHE_TTL = 300_000;

/** 行情接口所有字段（push2 ulist / stock/get） */
const ALL_FIELDS =
  'f1,f2,f3,f4,f5,f6,f7,f8,f9,f10,f11,f12,f13,f14,f15,f16,f17,f18,f20,f21,f22,f23,f24,f25,f62,f115,f128,f136,f152';

/** K 线字段 1（请求参数 fields1） */
const KLINE_FIELDS1 = 'f1,f2,f3,f4,f5,f6';
/** K 线字段 2（请求参数 fields2） */
const KLINE_FIELDS2 = 'f51,f52,f53,f54,f55,f56,f57,f58,f59,f60,f61';

// ============================================================
// 类型定义（在文件内定义，避免 rootDir 限制）
// ============================================================

/** 完整行情快照 */
export interface StockQuote {
  /** 市场代码（1=沪 0=深） */
  market: number;
  /** 股票代码 */
  code: string;
  /** 股票名称 */
  name: string;
  /** 最新价 */
  price: number;
  /** 涨跌幅 (%) */
  changePercent: number;
  /** 涨跌额 */
  changeAmount: number;
  /** 成交量（手） */
  volume: number;
  /** 成交额（元） */
  turnover: number;
  /** 振幅 (%) */
  amplitude: number;
  /** 换手率 (%) */
  turnoverRate: number;
  /** 市盈率（动态） */
  pe: number;
  /** 量比 */
  volumeRatio: number;
  /** 最高价 */
  high: number;
  /** 最低价 */
  low: number;
  /** 今开 */
  open: number;
  /** 昨收 */
  prevClose: number;
  /** 总市值 */
  totalMarketCap: number;
  /** 流通市值 */
  circulatingMarketCap: number;
  /** 涨速 (%) */
  speedPercent: number;
  /** 市净率 */
  pb: number;
  /** 60日涨跌幅 (%) */
  change60d: number;
  /** 年初至今涨跌幅 (%) */
  changeYtd: number;
  /** 主力净流入 */
  mainNetInflow: number;
  /** 市盈率（TTM） */
  peTtm: number;
}

/** K 线周期：1/5/15/30/60 分钟，101=日 102=周 103=月 */
export type KLinePeriod = 1 | 5 | 15 | 30 | 60 | 101 | 102 | 103;

/** 复权类型：0=不复权 1=前复权 2=后复权 */
export type AdjustType = 0 | 1 | 2;

/** K 线请求参数 */
export interface KLineRequest {
  /** 证券 ID（如 "1.600519"） */
  secid: string;
  /** K 线周期 */
  period: KLinePeriod;
  /** 复权类型 */
  adjust: AdjustType;
  /** 返回数据条数 */
  limit: number;
}

/** 单条 K 线数据 */
export interface KLineDataPoint {
  /** 日期（"2024-01-15" 或 "2024-01-15 10:30"） */
  date: string;
  /** 开盘价 */
  open: number;
  /** 收盘价 */
  close: number;
  /** 最高价 */
  high: number;
  /** 最低价 */
  low: number;
  /** 成交量（手） */
  volume: number;
  /** 成交额（元） */
  turnover: number;
  /** 振幅 (%) */
  amplitude: number;
  /** 涨跌幅 (%) */
  changePercent: number;
  /** 涨跌额 */
  changeAmount: number;
  /** 换手率 (%) */
  turnoverRate: number;
}

/** 分时数据点 */
export interface TimelinePoint {
  /** 时间（"09:30", "10:15" 等） */
  time: string;
  /** 当前价格 */
  price: number;
  /** 均价 */
  avgPrice: number;
  /** 成交量（手） */
  volume: number;
  /** 成交额（元） */
  turnover: number;
  /** 涨跌幅 (%) */
  changePercent: number;
}

/** 资金流向数据点（日级） */
export interface MoneyFlowPoint {
  /** 日期 */
  date: string;
  /** 主力流入 */
  mainInflow: number;
  /** 主力流出 */
  mainOutflow: number;
  /** 主力净流入 */
  mainNetInflow: number;
  /** 散户流入 */
  retailInflow: number;
  /** 散户流出 */
  retailOutflow: number;
  /** 散户净流入 */
  retailNetInflow: number;
}

/** 股票搜索结果 */
export interface StockSearchResult {
  /** 股票代码 */
  code: string;
  /** 股票名称 */
  name: string;
  /** 市场代码（1=沪 0=深） */
  market: number;
  /** 证券类型（如 "stock"） */
  type: string;
}

// ============================================================
// 工具函数
// ============================================================

/**
 * 构造东方财富的证券 ID。
 * @param market 市场代码（1=沪 0=深）
 * @param code   股票代码（如 "600519"）
 * @returns 如 "1.600519"
 */
function toSecid(market: number, code: string): string {
  return `${market}.${code}`;
}

/**
 * 带超时控制的 fetch。
 * @param url       请求地址
 * @param timeoutMs 超时毫秒数（默认 10s）
 */
async function fetchWithTimeout(url: string, timeoutMs: number = 10_000): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, { signal: controller.signal });
    return response;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * 解析东方财富原始行情数据（f 字段 map）为 StockQuote。
 *
 * 字段映射参考（东方财富 push2 协议）：
 *   f1=市场 f2=最新价 f3=涨跌幅 f4=涨跌额 f5=成交量 f6=成交额
 *   f7=振幅 f8=换手率 f9=市盈率(动) f10=量比 f11=涨速
 *   f12=代码 f13=市场 f14=名称 f15=最高 f16=最低 f17=今开 f18=昨收
 *   f20=总市值 f21=流通市值 f22=涨速 f23=市净率
 *   f24=60日涨跌幅 f25=年初至今涨跌幅 f62=主力净流入
 *   f115=市盈率(TTM)
 */
function parseQuote(raw: Record<string, unknown>): StockQuote {
  return {
    market: Number(raw.f13) || 0,
    code: String(raw.f12 ?? ''),
    name: String(raw.f14 ?? ''),
    price: Number(raw.f2) || 0,
    changePercent: Number(raw.f3) || 0,
    changeAmount: Number(raw.f4) || 0,
    volume: Number(raw.f5) || 0,
    turnover: Number(raw.f6) || 0,
    amplitude: Number(raw.f7) || 0,
    turnoverRate: Number(raw.f8) || 0,
    pe: Number(raw.f9) || 0,
    volumeRatio: Number(raw.f10) || 0,
    high: Number(raw.f15) || 0,
    low: Number(raw.f16) || 0,
    open: Number(raw.f17) || 0,
    prevClose: Number(raw.f18) || 0,
    totalMarketCap: Number(raw.f20) || 0,
    circulatingMarketCap: Number(raw.f21) || 0,
    speedPercent: Number(raw.f22) || 0,
    pb: Number(raw.f23) || 0,
    change60d: Number(raw.f24) || 0,
    changeYtd: Number(raw.f25) || 0,
    mainNetInflow: Number(raw.f62) || 0,
    peTtm: Number(raw.f115) || 0,
  };
}

/**
 * 解析 K 线数据。
 * 东方财富返回格式为逗号分隔字符串：
 *   "日期,开,收,高,低,成交量,成交额,振幅,涨跌幅,涨跌额,换手率"
 */
function parseKLine(raw: string): KLineDataPoint {
  const parts = raw.split(',');
  return {
    date: parts[0] || '',
    open: Number(parts[1]) || 0,
    close: Number(parts[2]) || 0,
    high: Number(parts[3]) || 0,
    low: Number(parts[4]) || 0,
    volume: Number(parts[5]) || 0,
    turnover: Number(parts[6]) || 0,
    amplitude: Number(parts[7]) || 0,
    changePercent: Number(parts[8]) || 0,
    changeAmount: Number(parts[9]) || 0,
    turnoverRate: Number(parts[10]) || 0,
  };
}

/**
 * 解析分时数据。
 * 东方财富返回格式为逗号分隔字符串：
 *   "时间,当前价,均价,成交量,成交额,..."
 *
 * @param raw       逗号分隔的原始字符串
 * @param prevClose 昨收价，用于计算涨跌幅
 */
function parseTimeline(raw: string, prevClose: number): TimelinePoint {
  const parts = raw.split(',');
  const price = Number(parts[1]) || 0;
  // 涨跌幅 = (当前价 - 昨收) / 昨收 * 100
  const changePercent = prevClose > 0 ? ((price - prevClose) / prevClose) * 100 : 0;

  return {
    time: parts[0] || '',
    price,
    avgPrice: Number(parts[2]) || 0,
    volume: Number(parts[3]) || 0,
    turnover: Number(parts[4]) || 0,
    changePercent: Math.round(changePercent * 100) / 100, // 保留两位小数
  };
}

// ============================================================
// StockService 类
// ============================================================

class StockService {
  /**
   * 批量获取实时行情。
   *
   * @param stocks 股票列表，每项包含 market 和 code
   * @returns StockQuote 数组
   */
  async batchQuotes(stocks: Array<{ market: number; code: string }>): Promise<StockQuote[]> {
    if (stocks.length === 0) return [];

    const secids = stocks.map((s) => toSecid(s.market, s.code)).join(',');
    const cacheKey = `batch:${secids}`;

    const url =
      `https://push2.eastmoney.com/api/qt/ulist.np/get` +
      `?secids=${secids}` +
      `&fields=${ALL_FIELDS}` +
      `&ut=fa5fd1943c7b386f172d6893dbbd1688`;

    return rateLimiter.execute<StockQuote[]>(
      async () => {
        const resp = await fetchWithTimeout(url);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const json: any = await resp.json();

        // 东方财富返回格式：{ data: { diff: [ {...}, {...} ] } }
        const diff = json?.data?.diff;
        if (!Array.isArray(diff)) return [];

        return diff.map((item: Record<string, unknown>) => parseQuote(item));
      },
      { key: cacheKey, cacheTtlMs: QUOTE_CACHE_TTL }
    );
  }

  /**
   * 获取单只股票的实时行情。
   *
   * @param market 市场代码
   * @param code   股票代码
   */
  async getQuote(market: number, code: string): Promise<StockQuote | null> {
    const secid = toSecid(market, code);
    const cacheKey = `quote:${secid}`;

    const url =
      `https://push2.eastmoney.com/api/qt/stock/get` +
      `?secid=${secid}` +
      `&fields=${ALL_FIELDS}` +
      `&ut=fa5fd1943c7b386f172d6893dbbd1688`;

    return rateLimiter.execute<StockQuote | null>(
      async () => {
        const resp = await fetchWithTimeout(url);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const json: any = await resp.json();

        const data = json?.data;
        if (!data) return null;

        return parseQuote(data as Record<string, unknown>);
      },
      { key: cacheKey, cacheTtlMs: QUOTE_CACHE_TTL }
    );
  }

  /**
   * 获取 K 线历史数据。
   *
   * @param req K 线请求参数（secid / period / adjust / limit）
   */
  async getKLine(req: KLineRequest): Promise<KLineDataPoint[]> {
    const { secid, period, adjust, limit } = req;
    const cacheKey = `kline:${secid}:${period}:${adjust}:${limit}`;

    const url =
      `https://push2his.eastmoney.com/api/qt/stock/kline/get` +
      `?secid=${secid}` +
      `&klt=${period}` +
      `&fqt=${adjust}` +
      `&lmt=${limit}` +
      `&end=20500101` +
      `&fields1=${KLINE_FIELDS1}` +
      `&fields2=${KLINE_FIELDS2}` +
      `&ut=fa5fd1943c7b386f172d6893dbbd1688`;

    return rateLimiter.execute<KLineDataPoint[]>(
      async () => {
        const resp = await fetchWithTimeout(url);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const json: any = await resp.json();

        // 返回格式：{ data: { klines: ["日期,开,收,高,低,...", ...] } }
        const klines = json?.data?.klines;
        if (!Array.isArray(klines)) return [];

        return klines.map((line: string) => parseKLine(line));
      },
      { key: cacheKey, cacheTtlMs: KLINE_CACHE_TTL }
    );
  }

  /**
   * 获取当日分时数据。
   *
   * @param market 市场代码
   * @param code   股票代码
   */
  async getTimeline(market: number, code: string): Promise<TimelinePoint[]> {
    const secid = toSecid(market, code);
    const cacheKey = `timeline:${secid}`;

    const url =
      `https://push2.eastmoney.com/api/qt/stock/trends2/get` +
      `?secid=${secid}` +
      `&fields1=f1,f2,f3,f4,f5,f6,f7,f8,f9,f10,f11,f12,f13` +
      `&fields2=f51,f52,f53,f54,f55,f56,f57,f58` +
      `&ut=fa5fd1943c7b386f172d6893dbbd1688`;

    return rateLimiter.execute<TimelinePoint[]>(
      async () => {
        const resp = await fetchWithTimeout(url);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const json: any = await resp.json();

        // 返回格式：{ data: { preClose: 123.45, trends: ["时间,价,均价,...", ...] } }
        const data = json?.data;
        if (!data) return [];

        const prevClose = Number(data.preClose) || 0;
        const trends = data.trends;
        if (!Array.isArray(trends)) return [];

        return trends.map((line: string) => parseTimeline(line, prevClose));
      },
      { key: cacheKey, cacheTtlMs: QUOTE_CACHE_TTL }
    );
  }

  /**
   * 获取资金流向数据（日 K 级别）。
   *
   * @param market 市场代码
   * @param code   股票代码
   */
  async getMoneyFlow(market: number, code: string): Promise<MoneyFlowPoint[]> {
    const secid = toSecid(market, code);
    const cacheKey = `moneyflow:${secid}`;

    const url =
      `https://push2.eastmoney.com/api/qt/stock/fflow/daykline/get` +
      `?secid=${secid}` +
      `&lmt=0` +
      `&klt=101` +
      `&fields1=f1,f2,f3,f7` +
      `&fields2=f51,f52,f53,f54,f55,f56,f57,f58,f59,f60,f61,f62,f63,f64,f65` +
      `&ut=fa5fd1943c7b386f172d6893dbbd1688`;

    return rateLimiter.execute<MoneyFlowPoint[]>(
      async () => {
        const resp = await fetchWithTimeout(url);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const json: any = await resp.json();

        // 返回格式：{ data: { klines: ["日期,主力流入,主力流出,主力净,散户流入,散户流出,散户净,...", ...] } }
        const klines = json?.data?.klines;
        if (!Array.isArray(klines)) return [];

        return klines.map((line: string) => {
          const parts = line.split(',');
          return {
            date: parts[0] || '',
            mainInflow: Number(parts[1]) || 0,
            mainOutflow: Number(parts[2]) || 0,
            mainNetInflow: Number(parts[3]) || 0,
            retailInflow: Number(parts[4]) || 0,
            retailOutflow: Number(parts[5]) || 0,
            retailNetInflow: Number(parts[6]) || 0,
          };
        });
      },
      { key: cacheKey, cacheTtlMs: KLINE_CACHE_TTL }
    );
  }

  /**
   * 搜索股票（模糊匹配代码或名称）。
   *
   * @param keyword 搜索关键词（代码 / 名称 / 拼音首字母）
   */
  async search(keyword: string): Promise<StockSearchResult[]> {
    if (!keyword.trim()) return [];

    const cacheKey = `search:${keyword}`;
    const encodedKeyword = encodeURIComponent(keyword);

    const url =
      `https://searchapi.eastmoney.com/api/suggest/get` +
      `?input=${encodedKeyword}` +
      `&type=14` +
      `&token=D43BF722C8E33BDC906FB84D85E326E8`;

    return rateLimiter.execute<StockSearchResult[]>(
      async () => {
        const resp = await fetchWithTimeout(url);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const json: any = await resp.json();

        // 返回格式：{ QuotationCodeTable: { Data: [ { Code, Name, MktNum, SecurityTypeName, ... } ] } }
        const data = json?.QuotationCodeTable?.Data;
        if (!Array.isArray(data)) return [];

        return data.map((item: Record<string, unknown>) => ({
          code: String(item.Code ?? ''),
          name: String(item.Name ?? ''),
          market: Number(item.MktNum) || 0,
          type: String(item.SecurityTypeName ?? ''),
        }));
      },
      { key: cacheKey, cacheTtlMs: SEARCH_CACHE_TTL }
    );
  }

  /**
   * 获取 RateLimiter 当前运行状态。
   */
  getStatus(): RateLimiterStatus {
    return rateLimiter.getStatus();
  }
}

// ============================================================
// 导出单例
// ============================================================

/** 全局 StockService 单例 */
export const stockService = new StockService();
