/**
 * 股票行情服务 — StockService
 *
 * 数据源：
 *   - 腾讯财经（qt.gtimg.cn）— 实时行情、分时数据、搜索
 *   - 东方财富（push2his.eastmoney.com）— K线历史数据（字段最全，含换手率）
 *   - 新浪财经（quotes.sina.cn）— K线 fallback（东方财富失败时备用）
 *
 * 东方财富实时行情接口（push2.eastmoney.com）频繁触发 IP 封禁，已弃用。
 * 历史 K 线接口（push2his.eastmoney.com）稳定可用。
 */

import { rateLimiter, type RateLimiterStatus } from './rate-limiter.js';
import { pythonBridge } from './python-bridge.js';

// ============================================================
// 常量
// ============================================================

/** 行情缓存 10s */
const QUOTE_CACHE_TTL = 10_000;
/** K线缓存 60s */
const KLINE_CACHE_TTL = 60_000;
/** 搜索缓存 5min */
const SEARCH_CACHE_TTL = 300_000;

/** 东方财富 K 线字段 1（请求参数 fields1） */
const KLINE_FIELDS1 = 'f1,f2,f3,f4,f5,f6';
/** 东方财富 K 线字段 2（请求参数 fields2） */
const KLINE_FIELDS2 = 'f51,f52,f53,f54,f55,f56,f57,f58,f59,f60,f61';

// ============================================================
// 类型定义（在文件内定义，避免 rootDir 限制）
// ============================================================

/** 完整行情快照（字段名与 types/stock.ts 前端类型一致） */
export interface StockQuote {
  market: number;
  code: string;
  name: string;
  price: number;
  changePercent: number;
  changeAmount: number;
  volume: number;
  turnover: number;
  amplitude: number;
  turnoverRate: number;
  peRatio: number;
  volumeRatio: number;
  fiveMinChange: number;
  high: number;
  low: number;
  open: number;
  prevClose: number;
  totalMarketCap: number;
  floatMarketCap: number;
  speedPercent: number;
  pbRatio: number;
  changePercent60d: number;
  changePercentYTD: number;
  mainNetInflow: number;
  peRatioTTM: number;
  outerVolume: number;
  innerVolume: number;
  limitUp: number;
  limitDown: number;
  orderDiff: number;
  avgPrice: number;
  high52w: number;
  low52w: number;
  floatShares: number;
  totalShares: number;
  tradeDate: string;
  timestamp: number;
}

/** K 线周期：1/5/15/30/60 分钟，101=日 102=周 103=月 */
export type KLinePeriod = 1 | 5 | 15 | 30 | 60 | 101 | 102 | 103;

/** 复权类型：0=不复权 1=前复权 2=后复权 */
export type AdjustType = 0 | 1 | 2;

/** K 线请求参数 */
export interface KLineRequest {
  secid: string;
  period: KLinePeriod;
  adjust: AdjustType;
  limit: number;
}

/** 单条 K 线数据 */
export interface KLineDataPoint {
  date: string;
  open: number;
  close: number;
  high: number;
  low: number;
  volume: number;
  turnover: number;
  amplitude: number;
  changePercent: number;
  changeAmount: number;
  turnoverRate: number;
}

/** 分时数据点 */
export interface TimelinePoint {
  time: string;
  price: number;
  avgPrice: number;
  volume: number;
  turnover: number;
  changePercent: number;
}

/** 资金流向数据点（日级） */
export interface MoneyFlowPoint {
  date: string;
  mainInflow: number;
  mainOutflow: number;
  mainNetInflow: number;
  retailInflow: number;
  retailOutflow: number;
  retailNetInflow: number;
}

/** 股票搜索结果 */
export interface StockSearchResult {
  code: string;
  name: string;
  market: number;
  type: string;
}

// ============================================================
// 工具函数
// ============================================================

/** market+code 转腾讯/新浪格式：sh600519（沪）、sz300303（深） */
function toStockCode(market: number, code: string): string {
  return market === 1 ? `sh${code}` : `sz${code}`;
}

/** 带超时控制的 fetch */
async function fetchWithTimeout(
  url: string,
  timeoutMs: number = 10_000,
  options?: RequestInit,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

/** 从 GBK 响应中读取文本 */
async function readGBK(resp: Response): Promise<string> {
  const buf = await resp.arrayBuffer();
  return new TextDecoder('gbk').decode(buf);
}

// ============================================================
// 腾讯财经 — 实时行情
// ============================================================

/**
 * 解析腾讯行情数据（qt.gtimg.cn）。
 * 字段用 ~ 分隔，88 个字段，关键索引：
 *   1=名称 2=代码 3=当前价 4=昨收 5=今开 6=成交量(手)
 *   7=外盘(手) 8=内盘(手)
 *   30=日期时间(YYYYMMDDHHMMSS) 31=涨跌额 32=涨跌幅
 *   33=最高 34=最低 37=成交额(万) 38=换手率 39=市盈率
 *   43=振幅 44=流通市值(亿) 45=总市值(亿) 46=市净率
 *   47=涨停价 48=跌停价 49=量比 50=委差(手) 51=均价
 *   62=60日涨跌幅 63=年初至今涨跌幅
 *   67=52周最高 68=52周最低
 *   72=流通股本(股) 73=总股本(股)
 */
function parseTencentQuote(
  p: string[],
  stockInfo?: { market: number; code: string },
): StockQuote | null {
  if (p.length < 50) return null;

  const market = p[0] === '1' ? 1 : 0;
  const code = p[2] || '';

  // 从索引 30 提取交易日期：YYYYMMDDHHMMSS → YYYY-MM-DD
  const rawDate = p[30] || '';
  const tradeDate = rawDate.length >= 8
    ? `${rawDate.slice(0, 4)}-${rawDate.slice(4, 6)}-${rawDate.slice(6, 8)}`
    : '';

  return {
    market: stockInfo?.market ?? market,
    code,
    name: p[1] || '',
    price: Number(p[3]) || 0,
    prevClose: Number(p[4]) || 0,
    open: Number(p[5]) || 0,
    volume: Number(p[6]) || 0,
    outerVolume: Number(p[7]) || 0,
    innerVolume: Number(p[8]) || 0,
    changeAmount: Number(p[31]) || 0,
    changePercent: Number(p[32]) || 0,
    high: Number(p[33]) || 0,
    low: Number(p[34]) || 0,
    turnover: (Number(p[37]) || 0) * 10000, // 万→元
    turnoverRate: Number(p[38]) || 0,
    peRatio: Number(p[39]) || 0,
    amplitude: Number(p[43]) || 0,
    floatMarketCap: (Number(p[44]) || 0) * 1e8, // 亿→元
    totalMarketCap: (Number(p[45]) || 0) * 1e8,
    pbRatio: Number(p[46]) || 0,
    limitUp: Number(p[47]) || 0,
    limitDown: Number(p[48]) || 0,
    volumeRatio: Number(p[49]) || 0,
    orderDiff: Number(p[50]) || 0,
    avgPrice: Number(p[51]) || 0,
    changePercent60d: Number(p[62]) || 0,
    changePercentYTD: Number(p[63]) || 0,
    high52w: Number(p[67]) || 0,
    low52w: Number(p[68]) || 0,
    floatShares: Number(p[72]) || 0,
    totalShares: Number(p[73]) || 0,
    peRatioTTM: Number(p[39]) || 0,
    fiveMinChange: 0,
    speedPercent: 0,
    mainNetInflow: 0,
    tradeDate,
    timestamp: Date.now(),
  };
}

// ============================================================
// 新浪财经 — K线历史数据
// ============================================================

/**
 * 将 KLinePeriod 转换为新浪 scale 参数。
 * 新浪用 scale 统一控制周期：1/5/15/30/60 分钟，240=日K
 * 周K和月K新浪不直接支持，用日K数据或保留东方财富 fallback
 */
function periodToSinaScale(period: KLinePeriod): number {
  switch (period) {
    case 1: return 1;
    case 5: return 5;
    case 15: return 15;
    case 30: return 30;
    case 60: return 60;
    case 101: return 240;  // 日K
    case 102: return 1680; // 周K（240*7）
    case 103: return 7200; // 月K（240*30）
    default: return 240;
  }
}

// ============================================================
// 腾讯财经 — 分时数据
// ============================================================

/**
 * 解析腾讯分时数据。
 * 腾讯格式：空格分隔 "HHMM 价格 累计成交量 累计成交额"
 * 需要将累计量转为单笔量（当前 - 前一条）
 */
function parseTencentTimeline(
  rawData: string[],
  date: string,
  prevClose: number,
): TimelinePoint[] {
  const results: TimelinePoint[] = [];
  let lastVolume = 0;
  let lastTurnover = 0;

  for (const raw of rawData) {
    const parts = raw.split(' ');
    if (parts.length < 4) continue;

    const hhmm = parts[0];
    const time = `${date.slice(0, 4)}-${date.slice(4, 6)}-${date.slice(6, 8)} ${hhmm.slice(0, 2)}:${hhmm.slice(2, 4)}`;
    const price = Number(parts[1]) || 0;
    const totalVolume = Number(parts[2]) || 0;
    const totalTurnover = Number(parts[3]) || 0;

    // 单笔成交量 = 当前累计 - 上一条累计
    const volume = totalVolume - lastVolume;
    const turnover = totalTurnover - lastTurnover;
    lastVolume = totalVolume;
    lastTurnover = totalTurnover;

    // 均价 = 累计成交额 / 累计成交量
    const avgPrice = totalVolume > 0 ? totalTurnover / totalVolume : price;

    const changePercent = prevClose > 0
      ? Math.round(((price - prevClose) / prevClose) * 10000) / 100
      : 0;

    results.push({ time, price, avgPrice, volume, turnover, changePercent });
  }

  return results;
}

// ============================================================
// StockService 类
// ============================================================

class StockService {
  /**
   * 批量获取实时行情（腾讯财经）。
   */
  async batchQuotes(stocks: Array<{ market: number; code: string }>): Promise<StockQuote[]> {
    if (stocks.length === 0) return [];

    const codes = stocks.map((s) => toStockCode(s.market, s.code)).join(',');
    const cacheKey = `batch:${codes}`;

    return rateLimiter.execute<StockQuote[]>(
      async () => {
        const resp = await fetchWithTimeout(`https://qt.gtimg.cn/q=${codes}`);
        const text = await readGBK(resp);

        const results: StockQuote[] = [];
        const entries = text.trim().split(';').filter((s) => s.trim());

        for (const entry of entries) {
          const match = entry.match(/v_\w+="(.*)"/);
          if (!match) continue;

          const data = match[1];
          if (!data) continue;

          const p = data.split('~');
          const code = p[2] || '';
          const stockInfo = stocks.find((s) => s.code === code);
          const quote = parseTencentQuote(p, stockInfo);
          if (quote) results.push(quote);
        }

        return results;
      },
      { key: cacheKey, cacheTtlMs: QUOTE_CACHE_TTL },
    );
  }

  /**
   * 获取单只股票的实时行情。
   */
  async getQuote(market: number, code: string): Promise<StockQuote | null> {
    const quotes = await this.batchQuotes([{ market, code }]);
    return quotes.length > 0 ? quotes[0] : null;
  }

  /**
   * 获取 K 线历史数据。
   * 优先东方财富（push2his，字段全，含换手率），失败时 fallback 到新浪。
   */
  async getKLine(req: KLineRequest): Promise<KLineDataPoint[]> {
    const { secid, period, adjust, limit } = req;
    const cacheKey = `kline:${secid}:${period}:${adjust}:${limit}`;

    return rateLimiter.execute<KLineDataPoint[]>(
      async () => {
        // 优先尝试东方财富历史 K 线接口
        try {
          const result = await this._getKLineEastMoney(secid, period, adjust, limit);
          if (result.length > 0) return result;
        } catch (err) {
          console.warn('[StockService] 东方财富K线失败，切换新浪:', err);
        }

        // fallback: 新浪财经
        return this._getKLineSina(secid, period, limit);
      },
      { key: cacheKey, cacheTtlMs: KLINE_CACHE_TTL },
    );
  }

  /**
   * 东方财富 K 线（push2his.eastmoney.com）。
   * 返回格式：逗号分隔字符串 "日期,开,收,高,低,成交量,成交额,振幅,涨跌幅,涨跌额,换手率"
   */
  private async _getKLineEastMoney(
    secid: string, period: KLinePeriod, adjust: AdjustType, limit: number,
  ): Promise<KLineDataPoint[]> {
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

    const resp = await fetchWithTimeout(url);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const json: any = await resp.json();

    const klines = json?.data?.klines;
    if (!Array.isArray(klines)) return [];

    return klines.map((line: string) => {
      const p = line.split(',');
      return {
        date: p[0] || '',
        open: Number(p[1]) || 0,
        close: Number(p[2]) || 0,
        high: Number(p[3]) || 0,
        low: Number(p[4]) || 0,
        volume: Number(p[5]) || 0,
        turnover: Number(p[6]) || 0,
        amplitude: Number(p[7]) || 0,
        changePercent: Number(p[8]) || 0,
        changeAmount: Number(p[9]) || 0,
        turnoverRate: Number(p[10]) || 0,
      };
    });
  }

  /**
   * 新浪财经 K 线（fallback）。
   * scale 参数统一控制周期：1/5/15/30/60/240(日)。
   * 注意：新浪不提供换手率和复权参数。
   */
  private async _getKLineSina(
    secid: string, period: KLinePeriod, limit: number,
  ): Promise<KLineDataPoint[]> {
    const [mkt, code] = secid.split('.');
    const sinaCode = toStockCode(Number(mkt), code);
    const scale = periodToSinaScale(period);

    const url =
      `https://quotes.sina.cn/cn/api/jsonp_v2.php/var=/CN_MarketDataService.getKLineData` +
      `?symbol=${sinaCode}&scale=${scale}&ma=no&datalen=${limit}`;

    const resp = await fetchWithTimeout(url, 10_000, {
      headers: { Referer: 'https://finance.sina.com.cn' },
    });
    const text = await resp.text();

    const jsonMatch = text.match(/\((\[[\s\S]*\])\)/);
    if (!jsonMatch) return [];

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const data: any[] = JSON.parse(jsonMatch[1]);
    if (!Array.isArray(data)) return [];

    let prevClose = 0;
    return data.map((item) => {
      const open = Number(item.open) || 0;
      const close = Number(item.close) || 0;
      const high = Number(item.high) || 0;
      const low = Number(item.low) || 0;
      const vol = Number(item.volume) || 0;

      // 新浪日K成交量单位是股，转手
      const volume = period >= 101 ? Math.round(vol / 100) : vol;
      const changeAmount = prevClose > 0 ? close - prevClose : 0;
      const changePercent = prevClose > 0
        ? Math.round(((close - prevClose) / prevClose) * 10000) / 100
        : 0;
      const amplitude = prevClose > 0
        ? Math.round(((high - low) / prevClose) * 10000) / 100
        : 0;

      prevClose = close;

      return {
        date: String(item.day || ''),
        open,
        close,
        high,
        low,
        volume,
        turnover: Number(item.amount) || 0,
        amplitude,
        changePercent,
        changeAmount: Math.round(changeAmount * 100) / 100,
        turnoverRate: 0, // 新浪不提供换手率
      };
    });
  }

  /**
   * 获取当日分时数据（腾讯财经）。
   */
  async getTimeline(market: number, code: string): Promise<TimelinePoint[]> {
    const tencentCode = toStockCode(market, code);
    const cacheKey = `timeline:${tencentCode}`;

    const url = `https://web.ifzq.gtimg.cn/appstock/app/minute/query?_var=min_data&code=${tencentCode}`;

    return rateLimiter.execute<TimelinePoint[]>(
      async () => {
        const resp = await fetchWithTimeout(url);
        const text = await resp.text();

        // JSONP 格式：min_data={...}
        const jsonMatch = text.match(/=(\{[\s\S]*\})/);
        if (!jsonMatch) return [];

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const json: any = JSON.parse(jsonMatch[1]);
        const stockData = json?.data?.[tencentCode];
        if (!stockData) return [];

        const minuteData = stockData.data;
        const date = String(minuteData?.date || stockData.date || '');
        const prevClose = Number(stockData.qt?.[tencentCode]?.[4]) || 0;

        const rawItems = minuteData?.data;
        if (!Array.isArray(rawItems)) return [];

        return parseTencentTimeline(rawItems, date, prevClose);
      },
      { key: cacheKey, cacheTtlMs: QUOTE_CACHE_TTL },
    );
  }

  /**
   * 获取资金流向数据（日 K 级别，近 100 个交易日）。
   * 走 Python Bridge 调用 AKShare（东方财富数据源）。
   * AKShare 只提供净额，无法拆分单独的流入/流出，mainInflow/mainOutflow/
   * retailInflow/retailOutflow 固定填 0，前端 MoneyFlow.tsx 只消费净额字段。
   * 主力 = 超大单+大单净流入（AKShare 已合并），散户 = 中单+小单净流入。
   * Python 守护进程不可用或接口失败时优雅降级为空数组，不阻塞前端渲染。
   */
  async getMoneyFlow(market: number, code: string): Promise<MoneyFlowPoint[]> {
    const akMarket = market === 1 ? 'sh' : 'sz';

    try {
      const result = await pythonBridge.call<{
        data: Array<{
          date: string;
          main_net_inflow: number | null;
          medium_net_inflow: number | null;
          small_net_inflow: number | null;
        }>;
        error?: string;
      }>('get_individual_fund_flow', { stock: code, market: akMarket }, 30_000);

      if (result.error) {
        console.warn('[StockService] 资金流向获取失败:', result.error);
        return [];
      }

      return result.data.map((row) => ({
        date: row.date,
        mainInflow: 0,
        mainOutflow: 0,
        mainNetInflow: row.main_net_inflow ?? 0,
        retailInflow: 0,
        retailOutflow: 0,
        retailNetInflow: (row.medium_net_inflow ?? 0) + (row.small_net_inflow ?? 0),
      }));
    } catch (error) {
      console.warn('[StockService] Python Bridge 调用失败，资金流向降级为空数组:', error);
      return [];
    }
  }

  /**
   * 搜索股票（腾讯 smartbox 接口）。
   */
  async search(keyword: string): Promise<StockSearchResult[]> {
    if (!keyword.trim()) return [];

    const cacheKey = `search:${keyword}`;
    const encoded = encodeURIComponent(keyword);

    // 腾讯搜索接口，t=gp 限制 A 股
    const url = `https://smartbox.gtimg.cn/s3/?v=2&q=${encoded}&t=gp`;

    return rateLimiter.execute<StockSearchResult[]>(
      async () => {
        const resp = await fetchWithTimeout(url);
        const text = await resp.text();

        // 格式：v_hint="市场~代码~名称~拼音~类型^..."
        const match = text.match(/v_hint="(.*)"/);
        if (!match || !match[1]) return [];

        const items = match[1].split('^').filter((s) => s.trim());
        return items.map((item) => {
          const parts = item.split('~');
          const mktStr = parts[0] || '';
          return {
            code: parts[1] || '',
            name: decodeURIComponent(parts[2] || ''),
            market: mktStr === 'sh' ? 1 : 0,
            type: parts[4] || 'GP-A',
          };
        });
      },
      { key: cacheKey, cacheTtlMs: SEARCH_CACHE_TTL },
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
