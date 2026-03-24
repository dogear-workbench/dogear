/**
 * 股票行情相关类型定义
 */

// === 自选股 ===

/** 自选股条目 */
export interface WatchlistItem {
  code: string;            // 股票代码，如 "600519"
  market: number;          // 市场：1=沪 0=深
  name: string;            // 股票名称，如 "贵州茅台"
  addedAt: string;         // 添加时间（ISO 格式）
  sortOrder: number;       // 排序权重
  tags?: string[];         // 用户自定义标签
}

/** 自选股列表 */
export interface Watchlist {
  version: number;
  items: WatchlistItem[];
}

// === 实时行情 ===

/** 股票实时行情报价 */
export interface StockQuote {
  code: string;            // 股票代码
  name: string;            // 股票名称
  market: number;          // 市场
  price: number;           // 最新价
  changePercent: number;   // 涨跌幅(%)
  changeAmount: number;    // 涨跌额
  volume: number;          // 成交量(手)
  turnover: number;        // 成交额
  open: number;            // 开盘价
  high: number;            // 最高价
  low: number;             // 最低价
  prevClose: number;       // 昨收价
  amplitude: number;       // 振幅(%)
  turnoverRate: number;    // 换手率(%)
  peRatio: number;         // 市盈率(动态)
  peRatioTTM: number;      // 市盈率(TTM)
  pbRatio: number;         // 市净率
  totalMarketCap: number;  // 总市值
  floatMarketCap: number;  // 流通市值
  volumeRatio: number;     // 量比
  speedPercent: number;    // 涨速(%)
  fiveMinChange: number;   // 5分钟涨跌
  mainNetInflow: number;   // 主力净流入
  changePercent60d: number;  // 60日涨跌幅
  changePercentYTD: number;  // 年初至今涨跌幅
  outerVolume: number;     // 外盘（手）— 主动买入量
  innerVolume: number;     // 内盘（手）— 主动卖出量
  limitUp: number;         // 涨停价
  limitDown: number;       // 跌停价
  orderDiff: number;       // 委差（手）
  avgPrice: number;        // 均价
  high52w: number;         // 52周最高
  low52w: number;          // 52周最低
  floatShares: number;     // 流通股本（股）
  totalShares: number;     // 总股本（股）
  tradeDate: string;       // 交易日期 "2026-03-23"
  timestamp: number;       // 时间戳
}

// === K线数据 ===

/** K线数据点 */
export interface KLineDataPoint {
  date: string;            // 日期，如 "2026-03-20"
  open: number;            // 开盘价
  close: number;           // 收盘价
  high: number;            // 最高价
  low: number;             // 最低价
  volume: number;          // 成交量
  turnover: number;        // 成交额
  amplitude: number;       // 振幅(%)
  changePercent: number;   // 涨跌幅(%)
  changeAmount: number;    // 涨跌额
  turnoverRate: number;    // 换手率(%)
}

/** K线周期：1/5/15/30/60分钟 | 日(101) | 周(102) | 月(103) */
export type KLinePeriod = 1 | 5 | 15 | 30 | 60 | 101 | 102 | 103;

/** 复权类型：0=不复权 | 1=前复权 | 2=后复权 */
export type AdjustType = 0 | 1 | 2;

/** K线数据请求参数 */
export interface KLineRequest {
  secid: string;           // 证券ID，如 "1.600519"
  period: KLinePeriod;     // K线周期
  adjust: AdjustType;      // 复权类型
  limit?: number;          // 返回条数，默认 120
}

// === 每日快照 ===

/** 每日快照数据点 — 记录日K缺少但行情接口有的字段，每日自动采集 */
export interface DailySnapshot {
  date: string;           // 交易日 "2026-03-23"
  outerVolume: number;    // 外盘（手）
  innerVolume: number;    // 内盘（手）
  limitUp: number;        // 涨停价
  limitDown: number;      // 跌停价
  orderDiff: number;      // 委差（手）
  avgPrice: number;       // 均价
  high52w: number;        // 52周最高
  low52w: number;         // 52周最低
  floatShares: number;    // 流通股本（股）
  totalShares: number;    // 总股本（股）
  price: number;          // 收盘/当前价
  volume: number;         // 成交量（手）
  turnover: number;       // 成交额
  changePercent: number;  // 涨跌幅
  peRatio: number;        // 市盈率
  pbRatio: number;        // 市净率
  totalMarketCap: number; // 总市值
  floatMarketCap: number; // 流通市值
  turnoverRate: number;   // 换手率
  timestamp: number;      // 采集时间戳
}

// === 分时数据 ===

/** 分时数据点 */
export interface TimelinePoint {
  time: string;            // 时间，如 "09:30"
  price: number;           // 当前价格
  avgPrice: number;        // 均价
  volume: number;          // 成交量
  turnover: number;        // 成交额
  changePercent: number;   // 涨跌幅(%)
}

// === 资金流向 ===

/** 资金流向数据点 */
export interface MoneyFlowPoint {
  date: string;            // 日期
  mainInflow: number;      // 主力流入
  mainOutflow: number;     // 主力流出
  mainNetInflow: number;   // 主力净流入
  retailInflow: number;    // 散户流入
  retailOutflow: number;   // 散户流出
  retailNetInflow: number; // 散户净流入
}

// === 搜索 ===

/** 股票搜索结果 */
export interface StockSearchResult {
  code: string;            // 股票代码
  name: string;            // 股票名称
  market: number;          // 市场
  type: string;            // 股票类型(A股/创业板/科创板等)
}

// === 东方财富 API 原始字段映射 ===

/** 东方财富行情接口字段编号 → 语义字段名映射 */
export const QUOTE_FIELD_MAP: Record<string, string> = {
  f1: 'market',
  f2: 'price',
  f3: 'changePercent',
  f4: 'changeAmount',
  f5: 'volume',
  f6: 'turnover',
  f7: 'amplitude',
  f8: 'turnoverRate',
  f9: 'peRatio',
  f10: 'volumeRatio',
  f11: 'fiveMinChange',
  f12: 'code',
  f13: 'marketId',
  f14: 'name',
  f15: 'high',
  f16: 'low',
  f17: 'open',
  f18: 'prevClose',
  f20: 'totalMarketCap',
  f21: 'floatMarketCap',
  f22: 'speedPercent',
  f23: 'pbRatio',
  f24: 'changePercent60d',
  f25: 'changePercentYTD',
  f62: 'mainNetInflow',
  f115: 'peRatioTTM',
  f128: 'leadStock',
  f136: 'leadStockChange',
  f152: 'reserved',
};

/** 行情请求所需的全量字段 key */
export const ALL_QUOTE_FIELDS = Object.keys(QUOTE_FIELD_MAP).join(',');

// === 断路器状态 ===

/** 断路器状态：CLOSED=正常 | OPEN=熔断 | HALF_OPEN=半开探测 */
export type CircuitState = 'CLOSED' | 'OPEN' | 'HALF_OPEN';

/** 速率限制器状态 */
export interface RateLimiterStatus {
  circuitState: CircuitState;       // 断路器当前状态
  requestsInWindow: number;         // 当前窗口内请求数
  tokensAvailable: number;          // 可用令牌数
  consecutiveFailures: number;      // 连续失败次数
  cooldownUntil: number | null;     // 冷却截止时间戳（null=无冷却）
}
