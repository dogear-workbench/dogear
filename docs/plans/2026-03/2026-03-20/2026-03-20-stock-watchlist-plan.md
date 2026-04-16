# 自选股行情系统 Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 在 Dogear 中实现自选股行情模块，包含自选股管理、个股详情（行情/K线/资金流向/基本面/分时）、完整请求防御体系。

**Architecture:** Electron Main 层提供 stock-service（API 请求 + RateLimiter 防御）、stock-data-service（JSONL K线存储）、stock-watchlist-service（JSON 自选股）三个服务，通过 tipc/stock.ts 暴露 IPC 路由，前端用 Zustand store + Lightweight Charts 渲染。

**Tech Stack:** Electron, React 19, Zustand 5, tipc, Lightweight Charts (TradingView), Tailwind CSS 4, shadcn/ui

**Design Doc:** `docs/plans/2026-03-20-stock-watchlist-design.md`

---

## Task 1: 安装依赖 + 创建类型定义

**Files:**
- Modify: `package.json`
- Create: `types/stock.ts`

**Step 1: 安装 lightweight-charts**

```bash
bun add lightweight-charts
```

**Step 2: 创建股票类型定义文件 `types/stock.ts`**

包含所有数据模型：

```typescript
// === 自选股 ===
export interface WatchlistItem {
  code: string;            // "600519"
  market: number;          // 1=沪 0=深
  name: string;            // "贵州茅台"
  addedAt: string;         // ISO 时间
  sortOrder: number;       // 排序权重
  tags?: string[];         // 用户自定义标签
}

export interface Watchlist {
  version: number;
  items: WatchlistItem[];
}

// === 实时行情 ===
export interface StockQuote {
  code: string;
  name: string;
  market: number;
  price: number;
  changePercent: number;
  changeAmount: number;
  volume: number;          // 成交量(手)
  turnover: number;        // 成交额
  open: number;
  high: number;
  low: number;
  prevClose: number;
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
  timestamp: number;
}

// === K线数据 ===
export interface KLineDataPoint {
  date: string;            // "2026-03-20"
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

export type KLinePeriod = 1 | 5 | 15 | 30 | 60 | 101 | 102 | 103;
export type AdjustType = 0 | 1 | 2; // 不复权 | 前复权 | 后复权

export interface KLineRequest {
  secid: string;           // "1.600519"
  period: KLinePeriod;
  adjust: AdjustType;
  limit?: number;          // 返回条数，默认 120
}

// === 分时数据 ===
export interface TimelinePoint {
  time: string;            // "09:30"
  price: number;
  avgPrice: number;
  volume: number;
  turnover: number;
  changePercent: number;
}

// === 资金流向 ===
export interface MoneyFlowPoint {
  date: string;
  mainInflow: number;
  mainOutflow: number;
  mainNetInflow: number;
  retailInflow: number;
  retailOutflow: number;
  retailNetInflow: number;
}

// === 搜索 ===
export interface StockSearchResult {
  code: string;
  name: string;
  market: number;
  type: string;
}

// === 东方财富 API 原始字段映射 ===
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

// 行情请求所需的全量字段 key
export const ALL_QUOTE_FIELDS = Object.keys(QUOTE_FIELD_MAP).join(',');

// === 断路器状态 ===
export type CircuitState = 'CLOSED' | 'OPEN' | 'HALF_OPEN';

export interface RateLimiterStatus {
  circuitState: CircuitState;
  requestsInWindow: number;
  tokensAvailable: number;
  consecutiveFailures: number;
  cooldownUntil: number | null;
}
```

**Step 3: Commit**

```bash
git add types/stock.ts package.json bun.lockb
git commit -m "feat(stock): add lightweight-charts dependency and stock type definitions"
```

---

## Task 2: 请求防御体系 — RateLimiter

**Files:**
- Create: `electron/main/services/stock/rate-limiter.ts`

这是整个系统最核心的基础设施，需要先于业务服务实现。

**Step 1: 创建 `electron/main/services/stock/rate-limiter.ts`**

实现三层防御：TokenBucket + SlidingWindow + CircuitBreaker + RequestMerger

```typescript
import type { CircuitState, RateLimiterStatus } from '../../types';

// --- Token Bucket ---
// 令牌桶：控制瞬时速率，最多 2 token，每 500ms 补充 1 个
class TokenBucket {
  private tokens: number;
  private lastRefill: number;

  constructor(
    private maxTokens: number = 2,
    private refillIntervalMs: number = 500
  ) {
    this.tokens = maxTokens;
    this.lastRefill = Date.now();
  }

  async acquire(): Promise<void> {
    this.refill();
    if (this.tokens >= 1) {
      this.tokens -= 1;
      return;
    }
    // 等待下一个令牌
    const waitMs = this.refillIntervalMs - (Date.now() - this.lastRefill);
    await new Promise(resolve => setTimeout(resolve, Math.max(0, waitMs)));
    this.refill();
    this.tokens -= 1;
  }

  private refill() {
    const now = Date.now();
    const elapsed = now - this.lastRefill;
    const newTokens = Math.floor(elapsed / this.refillIntervalMs);
    if (newTokens > 0) {
      this.tokens = Math.min(this.maxTokens, this.tokens + newTokens);
      this.lastRefill = now;
    }
  }

  getAvailable(): number {
    this.refill();
    return this.tokens;
  }
}

// --- Sliding Window ---
// 滑动窗口：60 秒内最多 60 次请求
class SlidingWindow {
  private timestamps: number[] = [];

  constructor(
    private windowMs: number = 60_000,
    private maxRequests: number = 60
  ) {}

  canProceed(): boolean {
    this.cleanup();
    return this.timestamps.length < this.maxRequests;
  }

  record() {
    this.timestamps.push(Date.now());
  }

  async waitIfNeeded(): Promise<void> {
    this.cleanup();
    if (this.timestamps.length >= this.maxRequests) {
      const oldest = this.timestamps[0];
      const waitMs = oldest + this.windowMs - Date.now();
      if (waitMs > 0) {
        await new Promise(resolve => setTimeout(resolve, waitMs));
        this.cleanup();
      }
    }
  }

  getCount(): number {
    this.cleanup();
    return this.timestamps.length;
  }

  private cleanup() {
    const cutoff = Date.now() - this.windowMs;
    this.timestamps = this.timestamps.filter(t => t > cutoff);
  }
}

// --- Circuit Breaker ---
// 断路器：连续 3 次失败 → OPEN（拒绝请求）→ 30s 后 HALF_OPEN → 探测
class CircuitBreaker {
  private state: CircuitState = 'CLOSED';
  private failureCount = 0;
  private lastFailureTime = 0;
  private cooldownMs: number;

  constructor(
    private failureThreshold: number = 3,
    private baseCooldownMs: number = 30_000,
    private maxCooldownMs: number = 120_000
  ) {
    this.cooldownMs = baseCooldownMs;
  }

  canProceed(): boolean {
    if (this.state === 'CLOSED') return true;
    if (this.state === 'OPEN') {
      // 检查冷却时间是否已过
      if (Date.now() - this.lastFailureTime >= this.cooldownMs) {
        this.state = 'HALF_OPEN';
        return true; // 允许一个探测请求
      }
      return false;
    }
    // HALF_OPEN：只允许一个在飞行中
    return true;
  }

  recordSuccess() {
    this.state = 'CLOSED';
    this.failureCount = 0;
    this.cooldownMs = this.baseCooldownMs; // 重置冷却时间
  }

  recordFailure() {
    this.failureCount++;
    this.lastFailureTime = Date.now();
    if (this.state === 'HALF_OPEN') {
      // 探测失败，回到 OPEN，冷却时间翻倍
      this.state = 'OPEN';
      this.cooldownMs = Math.min(this.cooldownMs * 2, this.maxCooldownMs);
    } else if (this.failureCount >= this.failureThreshold) {
      this.state = 'OPEN';
    }
  }

  getState(): CircuitState { return this.state; }
  getFailureCount(): number { return this.failureCount; }
  getCooldownUntil(): number | null {
    if (this.state === 'OPEN') {
      return this.lastFailureTime + this.cooldownMs;
    }
    return null;
  }
}

// --- Request Merger ---
// 相同 URL 的并发请求共享同一个 Promise
class RequestMerger {
  private inflight = new Map<string, Promise<any>>();

  async dedupe<T>(key: string, factory: () => Promise<T>): Promise<T> {
    const existing = this.inflight.get(key);
    if (existing) return existing as Promise<T>;

    const promise = factory().finally(() => {
      this.inflight.delete(key);
    });
    this.inflight.set(key, promise);
    return promise;
  }
}

// --- Memory Cache ---
// 内存缓存，支持 TTL
interface CacheEntry<T> {
  data: T;
  expiresAt: number;
}

class MemoryCache {
  private cache = new Map<string, CacheEntry<any>>();

  get<T>(key: string): T | null {
    const entry = this.cache.get(key);
    if (!entry) return null;
    if (Date.now() > entry.expiresAt) {
      this.cache.delete(key);
      return null;
    }
    return entry.data as T;
  }

  set<T>(key: string, data: T, ttlMs: number) {
    this.cache.set(key, { data, expiresAt: Date.now() + ttlMs });
  }

  clear() {
    this.cache.clear();
  }
}

// --- RateLimiter 主类 ---
export class RateLimiter {
  private tokenBucket = new TokenBucket(2, 500);
  private slidingWindow = new SlidingWindow(60_000, 60);
  private circuitBreaker = new CircuitBreaker(3, 30_000, 120_000);
  private requestMerger = new RequestMerger();
  private cache = new MemoryCache();

  /**
   * 执行一个受保护的请求
   * @param key 请求去重 key（相同 key 的并发请求共享结果）
   * @param fetcher 实际的请求函数
   * @param cacheTtlMs 缓存 TTL（毫秒），0 = 不缓存
   */
  async execute<T>(key: string, fetcher: () => Promise<T>, cacheTtlMs: number = 0): Promise<T> {
    // 1. 检查缓存
    if (cacheTtlMs > 0) {
      const cached = this.cache.get<T>(key);
      if (cached !== null) return cached;
    }

    // 2. 断路器检查
    if (!this.circuitBreaker.canProceed()) {
      const until = this.circuitBreaker.getCooldownUntil();
      const waitSec = until ? Math.ceil((until - Date.now()) / 1000) : '?';
      throw new Error(`请求被熔断，${waitSec}s 后重试`);
    }

    // 3. 请求合并（相同 key 去重）
    return this.requestMerger.dedupe(key, async () => {
      // 4. 滑动窗口限流
      await this.slidingWindow.waitIfNeeded();

      // 5. 令牌桶限速
      await this.tokenBucket.acquire();

      // 6. 记录请求
      this.slidingWindow.record();

      // 7. 执行请求（带重试）
      const result = await this.executeWithRetry(fetcher);

      // 8. 写入缓存
      if (cacheTtlMs > 0) {
        this.cache.set(key, result, cacheTtlMs);
      }

      return result;
    });
  }

  private async executeWithRetry<T>(fetcher: () => Promise<T>, maxRetries = 3): Promise<T> {
    let lastError: Error | undefined;
    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try {
        const result = await fetcher();
        this.circuitBreaker.recordSuccess();
        return result;
      } catch (err) {
        lastError = err instanceof Error ? err : new Error(String(err));
        this.circuitBreaker.recordFailure();

        if (attempt < maxRetries - 1) {
          // 指数退避：2s → 4s → 8s
          const backoffMs = Math.pow(2, attempt + 1) * 1000;
          await new Promise(resolve => setTimeout(resolve, backoffMs));

          // 如果断路器已打开，不再重试
          if (!this.circuitBreaker.canProceed()) break;
        }
      }
    }
    throw lastError!;
  }

  getStatus(): RateLimiterStatus {
    return {
      circuitState: this.circuitBreaker.getState(),
      requestsInWindow: this.slidingWindow.getCount(),
      tokensAvailable: this.tokenBucket.getAvailable(),
      consecutiveFailures: this.circuitBreaker.getFailureCount(),
      cooldownUntil: this.circuitBreaker.getCooldownUntil(),
    };
  }

  clearCache() {
    this.cache.clear();
  }
}

// 单例
export const rateLimiter = new RateLimiter();
```

**Step 2: Commit**

```bash
git add electron/main/services/stock/rate-limiter.ts
git commit -m "feat(stock): implement RateLimiter with token bucket, sliding window, circuit breaker"
```

---

## Task 3: 东方财富 API 服务 — stock-service.ts

**Files:**
- Create: `electron/main/services/stock/stock-service.ts`

封装所有东方财富 API 请求，通过 RateLimiter 保护。

**Step 1: 创建 `electron/main/services/stock/stock-service.ts`**

```typescript
import { rateLimiter } from './rate-limiter';
import type {
  StockQuote,
  KLineDataPoint,
  KLineRequest,
  TimelinePoint,
  MoneyFlowPoint,
  StockSearchResult,
  KLinePeriod,
  AdjustType,
} from '../../types';

const QUOTE_CACHE_TTL = 10_000;   // 行情缓存 10s
const KLINE_CACHE_TTL = 60_000;   // K线缓存 60s
const SEARCH_CACHE_TTL = 300_000; // 搜索缓存 5min

// 所有行情字段
const ALL_FIELDS = 'f1,f2,f3,f4,f5,f6,f7,f8,f9,f10,f11,f12,f13,f14,f15,f16,f17,f18,f20,f21,f22,f23,f24,f25,f62,f115,f128,f136,f152';

// K线字段
const KLINE_FIELDS1 = 'f1,f2,f3,f4,f5,f6';
const KLINE_FIELDS2 = 'f51,f52,f53,f54,f55,f56,f57,f58,f59,f60,f61';

/**
 * 构造 secid：市场.代码
 */
function toSecid(market: number, code: string): string {
  return `${market}.${code}`;
}

/**
 * 带超时的 fetch
 */
async function fetchWithTimeout(url: string, timeoutMs = 10_000): Promise<any> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const resp = await fetch(url, { signal: controller.signal });
    if (!resp.ok) {
      throw new Error(`HTTP ${resp.status}`);
    }
    const data = await resp.json();
    if (data.rc !== 0 && data.rc !== undefined) {
      throw new Error(`API error: rc=${data.rc}`);
    }
    return data;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * 解析原始行情数据为 StockQuote
 */
function parseQuote(raw: Record<string, any>): StockQuote {
  return {
    code: String(raw.f12 ?? ''),
    name: String(raw.f14 ?? ''),
    market: raw.f13 ?? raw.f1 ?? 0,
    price: raw.f2 ?? 0,
    changePercent: raw.f3 ?? 0,
    changeAmount: raw.f4 ?? 0,
    volume: raw.f5 ?? 0,
    turnover: raw.f6 ?? 0,
    open: raw.f17 ?? 0,
    high: raw.f15 ?? 0,
    low: raw.f16 ?? 0,
    prevClose: raw.f18 ?? 0,
    amplitude: raw.f7 ?? 0,
    turnoverRate: raw.f8 ?? 0,
    peRatio: raw.f9 ?? 0,
    peRatioTTM: raw.f115 ?? 0,
    pbRatio: raw.f23 ?? 0,
    totalMarketCap: raw.f20 ?? 0,
    floatMarketCap: raw.f21 ?? 0,
    volumeRatio: raw.f10 ?? 0,
    speedPercent: raw.f22 ?? 0,
    fiveMinChange: raw.f11 ?? 0,
    mainNetInflow: raw.f62 ?? 0,
    changePercent60d: raw.f24 ?? 0,
    changePercentYTD: raw.f25 ?? 0,
    timestamp: Date.now(),
  };
}

/**
 * 解析 K线数据（API 返回逗号分隔字符串）
 * "2026-03-20,1856.00,1870.50,1880.00,1840.00,12345,230000000,2.15,0.78,14.50,0.66"
 */
function parseKLine(raw: string): KLineDataPoint {
  const parts = raw.split(',');
  return {
    date: parts[0],
    open: parseFloat(parts[1]),
    close: parseFloat(parts[2]),
    high: parseFloat(parts[3]),
    low: parseFloat(parts[4]),
    volume: parseInt(parts[5], 10),
    turnover: parseFloat(parts[6]),
    amplitude: parseFloat(parts[7]),
    changePercent: parseFloat(parts[8]),
    changeAmount: parseFloat(parts[9]),
    turnoverRate: parseFloat(parts[10]),
  };
}

/**
 * 解析分时数据
 * "2026-03-20 09:30,1856.00,1855.50,100,186000,0.78"
 */
function parseTimeline(raw: string, prevClose: number): TimelinePoint {
  const parts = raw.split(',');
  const price = parseFloat(parts[1]);
  return {
    time: parts[0].split(' ')[1] || parts[0], // 提取时间部分
    price,
    avgPrice: parseFloat(parts[2]),
    volume: parseInt(parts[3], 10),
    turnover: parseFloat(parts[4]),
    changePercent: prevClose > 0 ? ((price - prevClose) / prevClose) * 100 : 0,
  };
}

// =====================================================
// 公开 API
// =====================================================

export class StockService {
  /**
   * 批量获取行情（自选股列表用）
   * 将多只股票合并为一次 API 请求
   */
  async batchQuotes(stocks: { market: number; code: string }[]): Promise<StockQuote[]> {
    if (stocks.length === 0) return [];

    // 构造 fs 参数：m:1+s:600519,m:0+s:000001,...
    const fs = stocks.map(s => `${s.market}.${s.code}`).join(',');
    const key = `batch:${fs}`;
    const url = `https://push2.eastmoney.com/api/qt/ulist.np/get?fltt=2&invt=2&fields=${ALL_FIELDS}&secids=${fs}`;

    const data = await rateLimiter.execute(key, () => fetchWithTimeout(url), QUOTE_CACHE_TTL);

    if (!data?.data?.diff) return [];
    return data.data.diff.map(parseQuote);
  }

  /**
   * 获取单股详细行情
   */
  async getQuote(market: number, code: string): Promise<StockQuote | null> {
    const secid = toSecid(market, code);
    const key = `quote:${secid}`;
    const url = `https://push2.eastmoney.com/api/qt/stock/get?secid=${secid}&fields=${ALL_FIELDS}&fltt=2&invt=2`;

    const data = await rateLimiter.execute(key, () => fetchWithTimeout(url), QUOTE_CACHE_TTL);

    if (!data?.data) return null;
    return parseQuote(data.data);
  }

  /**
   * 获取 K线数据
   */
  async getKLine(req: KLineRequest): Promise<KLineDataPoint[]> {
    const { secid, period, adjust, limit = 120 } = req;
    const key = `kline:${secid}:${period}:${adjust}:${limit}`;
    const end = '20500101'; // 取最新
    const url = `https://push2his.eastmoney.com/api/qt/stock/kline/get?secid=${secid}&klt=${period}&fqt=${adjust}&lmt=${limit}&end=${end}&fields1=${KLINE_FIELDS1}&fields2=${KLINE_FIELDS2}`;

    const data = await rateLimiter.execute(key, () => fetchWithTimeout(url), KLINE_CACHE_TTL);

    if (!data?.data?.klines) return [];
    return data.data.klines.map(parseKLine);
  }

  /**
   * 获取分时数据
   */
  async getTimeline(market: number, code: string): Promise<TimelinePoint[]> {
    const secid = toSecid(market, code);
    const key = `timeline:${secid}`;
    const url = `https://push2.eastmoney.com/api/qt/stock/trends2/get?secid=${secid}&fields1=f1,f2,f3,f4,f5,f6,f7,f8,f9,f10,f11,f12,f13&fields2=f51,f52,f53,f54,f55,f56,f57,f58`;

    const data = await rateLimiter.execute(key, () => fetchWithTimeout(url), QUOTE_CACHE_TTL);

    if (!data?.data?.trends) return [];
    const prevClose = data.data.preClose ?? 0;
    return data.data.trends.map((t: string) => parseTimeline(t, prevClose));
  }

  /**
   * 获取资金流向（日级）
   */
  async getMoneyFlow(market: number, code: string): Promise<MoneyFlowPoint[]> {
    const secid = toSecid(market, code);
    const key = `moneyflow:${secid}`;
    const url = `https://push2.eastmoney.com/api/qt/stock/fflow/daykline/get?secid=${secid}&lmt=30&klt=101&fields1=f1,f2,f3,f7&fields2=f51,f52,f53,f54,f55,f56,f57,f58,f59,f60,f61,f62,f63,f64,f65`;

    const data = await rateLimiter.execute(key, () => fetchWithTimeout(url), KLINE_CACHE_TTL);

    if (!data?.data?.klines) return [];
    return data.data.klines.map((line: string) => {
      const parts = line.split(',');
      return {
        date: parts[0],
        mainInflow: parseFloat(parts[1]),
        mainOutflow: parseFloat(parts[2]),
        mainNetInflow: parseFloat(parts[3]),
        retailInflow: parseFloat(parts[5]),
        retailOutflow: parseFloat(parts[6]),
        retailNetInflow: parseFloat(parts[7]),
      };
    });
  }

  /**
   * 搜索股票（模糊匹配代码/名称）
   */
  async search(keyword: string): Promise<StockSearchResult[]> {
    if (!keyword.trim()) return [];
    const key = `search:${keyword}`;
    const url = `https://searchapi.eastmoney.com/api/suggest/get?input=${encodeURIComponent(keyword)}&type=14&token=D43BF722C8E33BDC906FB84D85E326E8&count=10`;

    const data = await rateLimiter.execute(key, () => fetchWithTimeout(url), SEARCH_CACHE_TTL);

    if (!data?.QuotationCodeTable?.Data) return [];
    return data.QuotationCodeTable.Data
      .filter((item: any) => item.SecurityTypeName === 'A股' || item.SecurityTypeName === '深A' || item.SecurityTypeName === '沪A' || item.SecurityTypeName === '创业板' || item.SecurityTypeName === '科创板')
      .map((item: any) => ({
        code: item.Code,
        name: item.Name,
        market: item.MktNum === '1' ? 1 : 0,
        type: item.SecurityTypeName || '',
      }));
  }

  /**
   * 获取限流器状态
   */
  getStatus() {
    return rateLimiter.getStatus();
  }
}

export const stockService = new StockService();
```

**Step 2: 在 `electron/main/types.ts` 中重新导出类型（如果需要）**

检查 `electron/main/types.ts` 是否存在，如果存在则添加 stock 类型的镜像导出（因为 tsconfig.electron.json 的 rootDir 限制不能直接 import types/）。需要把 `types/stock.ts` 中主进程需要用到的类型复制到 `electron/main/types.ts`。

**Step 3: Commit**

```bash
git add electron/main/services/stock/stock-service.ts
git commit -m "feat(stock): implement StockService with all EastMoney API endpoints"
```

---

## Task 4: 自选股存储服务 — stock-watchlist-service.ts

**Files:**
- Create: `electron/main/services/stock/stock-watchlist-service.ts`

**Step 1: 创建 JSON 存储服务**

参照 `settings-service.ts` 的 `getConfigDir()` 模式：

```typescript
import * as fs from 'fs/promises';
import * as path from 'path';
import { app } from 'electron';
import type { Watchlist, WatchlistItem } from '../../types';

function getStockDir(): string {
  const base = app.isPackaged
    ? path.join(path.dirname(app.getAppPath()), '.dogear')
    : path.join(process.cwd(), '.dogear');
  return path.join(base, 'stocks');
}

function getWatchlistPath(): string {
  return path.join(getStockDir(), 'watchlist.json');
}

const DEFAULT_WATCHLIST: Watchlist = { version: 1, items: [] };

export class StockWatchlistService {
  async load(): Promise<Watchlist> {
    try {
      const raw = await fs.readFile(getWatchlistPath(), 'utf-8');
      const data = JSON.parse(raw) as Watchlist;
      return { ...DEFAULT_WATCHLIST, ...data };
    } catch {
      return { ...DEFAULT_WATCHLIST };
    }
  }

  async save(watchlist: Watchlist): Promise<void> {
    const dir = getStockDir();
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(getWatchlistPath(), JSON.stringify(watchlist, null, 2), 'utf-8');
  }

  async addItem(item: Omit<WatchlistItem, 'addedAt' | 'sortOrder'>): Promise<Watchlist> {
    const watchlist = await this.load();
    // 去重
    if (watchlist.items.some(i => i.code === item.code && i.market === item.market)) {
      return watchlist; // 已存在
    }
    const maxOrder = watchlist.items.reduce((max, i) => Math.max(max, i.sortOrder), 0);
    watchlist.items.push({
      ...item,
      addedAt: new Date().toISOString(),
      sortOrder: maxOrder + 1,
    });
    await this.save(watchlist);
    return watchlist;
  }

  async removeItem(market: number, code: string): Promise<Watchlist> {
    const watchlist = await this.load();
    watchlist.items = watchlist.items.filter(i => !(i.code === code && i.market === market));
    await this.save(watchlist);
    return watchlist;
  }

  async reorder(items: { market: number; code: string; sortOrder: number }[]): Promise<Watchlist> {
    const watchlist = await this.load();
    for (const update of items) {
      const item = watchlist.items.find(i => i.code === update.code && i.market === update.market);
      if (item) item.sortOrder = update.sortOrder;
    }
    watchlist.items.sort((a, b) => a.sortOrder - b.sortOrder);
    await this.save(watchlist);
    return watchlist;
  }
}

export const stockWatchlistService = new StockWatchlistService();
```

**Step 2: Commit**

```bash
git add electron/main/services/stock/stock-watchlist-service.ts
git commit -m "feat(stock): implement watchlist JSON storage service"
```

---

## Task 5: K线历史 JSONL 存储 — stock-data-service.ts

**Files:**
- Create: `electron/main/services/stock/stock-data-service.ts`

**Step 1: 创建 JSONL 读写服务**

```typescript
import * as fs from 'fs/promises';
import * as path from 'path';
import { app } from 'electron';
import type { KLineDataPoint } from '../../types';

function getKLineDir(): string {
  const base = app.isPackaged
    ? path.join(path.dirname(app.getAppPath()), '.dogear')
    : path.join(process.cwd(), '.dogear');
  return path.join(base, 'stocks', 'kline');
}

function getKLinePath(market: number, code: string): string {
  return path.join(getKLineDir(), `${market}.${code}.jsonl`);
}

export class StockDataService {
  /**
   * 读取本地 K线数据
   */
  async readKLine(market: number, code: string): Promise<KLineDataPoint[]> {
    const filePath = getKLinePath(market, code);
    try {
      const raw = await fs.readFile(filePath, 'utf-8');
      return raw
        .split('\n')
        .filter(line => line.trim())
        .map(line => JSON.parse(line) as KLineDataPoint);
    } catch {
      return [];
    }
  }

  /**
   * 追加 K线数据（去重：按 date 去重）
   */
  async appendKLine(market: number, code: string, points: KLineDataPoint[]): Promise<void> {
    if (points.length === 0) return;

    const dir = getKLineDir();
    await fs.mkdir(dir, { recursive: true });

    // 读取现有数据的日期集合
    const existing = await this.readKLine(market, code);
    const existingDates = new Set(existing.map(p => p.date));

    // 过滤出新数据
    const newPoints = points.filter(p => !existingDates.has(p.date));
    if (newPoints.length === 0) return;

    // 追加写入
    const filePath = getKLinePath(market, code);
    const lines = newPoints.map(p => JSON.stringify(p)).join('\n') + '\n';
    await fs.appendFile(filePath, lines, 'utf-8');
  }

  /**
   * 获取本地最后一条 K线的日期（用于增量请求）
   */
  async getLastDate(market: number, code: string): Promise<string | null> {
    const filePath = getKLinePath(market, code);
    try {
      const raw = await fs.readFile(filePath, 'utf-8');
      const lines = raw.trim().split('\n').filter(Boolean);
      if (lines.length === 0) return null;
      const last = JSON.parse(lines[lines.length - 1]) as KLineDataPoint;
      return last.date;
    } catch {
      return null;
    }
  }

  /**
   * 覆盖写入（用于非日K线，不需要增量）
   */
  async writeKLine(market: number, code: string, points: KLineDataPoint[]): Promise<void> {
    const dir = getKLineDir();
    await fs.mkdir(dir, { recursive: true });
    const filePath = getKLinePath(market, code);
    const content = points.map(p => JSON.stringify(p)).join('\n') + '\n';
    await fs.writeFile(filePath, content, 'utf-8');
  }
}

export const stockDataService = new StockDataService();
```

**Step 2: 创建 barrel 导出 `electron/main/services/stock/index.ts`**

```typescript
export { stockService } from './stock-service';
export { stockWatchlistService } from './stock-watchlist-service';
export { stockDataService } from './stock-data-service';
export { rateLimiter } from './rate-limiter';
```

**Step 3: Commit**

```bash
git add electron/main/services/stock/
git commit -m "feat(stock): implement JSONL K-line storage and barrel export"
```

---

## Task 6: IPC 路由 — tipc/stock.ts

**Files:**
- Create: `electron/main/tipc/stock.ts`
- Modify: `electron/main/tipc/index.ts` — 注册 stockRouter

**Step 1: 创建 `electron/main/tipc/stock.ts`**

参照 `tipc/article.ts` 的模式，创建所有 RPC：

```typescript
import { tipc } from './index'; // 或从创建处导入
import { stockService, stockWatchlistService, stockDataService, rateLimiter } from '../services/stock';

// 注意：需要看 index.ts 中 tipc 实例的创建方式，可能是：
// const t = tipc.create();
// 这里先用 t 来表示

const t = tipc.create();

export const stockRouter = {
  // === 自选股管理 ===
  'stock:getWatchlist': t.procedure
    .action(async () => {
      try {
        const watchlist = await stockWatchlistService.load();
        return { data: watchlist };
      } catch (error) {
        return { error: String(error) };
      }
    }),

  'stock:addToWatchlist': t.procedure
    .input<{ code: string; market: number; name: string; tags?: string[] }>()
    .action(async ({ input }) => {
      try {
        const watchlist = await stockWatchlistService.addItem(input);
        return { data: watchlist };
      } catch (error) {
        return { error: String(error) };
      }
    }),

  'stock:removeFromWatchlist': t.procedure
    .input<{ market: number; code: string }>()
    .action(async ({ input }) => {
      try {
        const watchlist = await stockWatchlistService.removeItem(input.market, input.code);
        return { data: watchlist };
      } catch (error) {
        return { error: String(error) };
      }
    }),

  'stock:reorderWatchlist': t.procedure
    .input<{ items: { market: number; code: string; sortOrder: number }[] }>()
    .action(async ({ input }) => {
      try {
        const watchlist = await stockWatchlistService.reorder(input.items);
        return { data: watchlist };
      } catch (error) {
        return { error: String(error) };
      }
    }),

  // === 行情数据 ===
  'stock:batchQuotes': t.procedure
    .input<{ stocks: { market: number; code: string }[] }>()
    .action(async ({ input }) => {
      try {
        const quotes = await stockService.batchQuotes(input.stocks);
        return { data: quotes };
      } catch (error) {
        return { error: String(error) };
      }
    }),

  'stock:getQuote': t.procedure
    .input<{ market: number; code: string }>()
    .action(async ({ input }) => {
      try {
        const quote = await stockService.getQuote(input.market, input.code);
        return { data: quote };
      } catch (error) {
        return { error: String(error) };
      }
    }),

  'stock:getKLine': t.procedure
    .input<{ market: number; code: string; period: number; adjust: number; limit?: number }>()
    .action(async ({ input }) => {
      try {
        const secid = `${input.market}.${input.code}`;
        const klines = await stockService.getKLine({
          secid,
          period: input.period as any,
          adjust: input.adjust as any,
          limit: input.limit,
        });
        // 日K线：追加存储到 JSONL
        if (input.period === 101) {
          await stockDataService.appendKLine(input.market, input.code, klines);
        }
        return { data: klines };
      } catch (error) {
        return { error: String(error) };
      }
    }),

  'stock:getTimeline': t.procedure
    .input<{ market: number; code: string }>()
    .action(async ({ input }) => {
      try {
        const timeline = await stockService.getTimeline(input.market, input.code);
        return { data: timeline };
      } catch (error) {
        return { error: String(error) };
      }
    }),

  'stock:getMoneyFlow': t.procedure
    .input<{ market: number; code: string }>()
    .action(async ({ input }) => {
      try {
        const flow = await stockService.getMoneyFlow(input.market, input.code);
        return { data: flow };
      } catch (error) {
        return { error: String(error) };
      }
    }),

  // === 搜索 ===
  'stock:search': t.procedure
    .input<{ keyword: string }>()
    .action(async ({ input }) => {
      try {
        const results = await stockService.search(input.keyword);
        return { data: results };
      } catch (error) {
        return { error: String(error) };
      }
    }),

  // === 调试 ===
  'stock:getRateLimiterStatus': t.procedure
    .action(async () => {
      return { data: stockService.getStatus() };
    }),
};
```

**Step 2: 修改 `electron/main/tipc/index.ts`**

在路由聚合处添加 stockRouter：

```typescript
import { stockRouter } from './stock';
// ... 在 router 对象中添加
export const router = {
  ...existingRouters,
  ...stockRouter,
};
```

**Step 3: 编译主进程验证**

```bash
bun run build:electron
```

预期：编译通过，无类型错误。

**Step 4: Commit**

```bash
git add electron/main/tipc/stock.ts electron/main/tipc/index.ts
git commit -m "feat(stock): add stock IPC routes and register in router"
```

---

## Task 7: 前端状态管理 — stock-store.ts

**Files:**
- Create: `stores/stock-store.ts`

**Step 1: 创建 Zustand store**

参照 `stores/article-store.ts` 的模式：

```typescript
import { create } from 'zustand';
import { client } from '@/lib/client';
import { toast } from 'sonner';
import type {
  Watchlist,
  WatchlistItem,
  StockQuote,
  KLineDataPoint,
  TimelinePoint,
  MoneyFlowPoint,
  StockSearchResult,
  KLinePeriod,
  AdjustType,
  RateLimiterStatus,
} from '@/types/stock';

interface StockState {
  // 自选股
  watchlist: Watchlist | null;
  loadingWatchlist: boolean;

  // 行情
  quotes: Map<string, StockQuote>; // key: "market.code"
  loadingQuotes: boolean;

  // 选中的股票
  selectedStock: { market: number; code: string } | null;

  // 个股详情
  currentQuote: StockQuote | null;
  klineData: KLineDataPoint[];
  timelineData: TimelinePoint[];
  moneyFlowData: MoneyFlowPoint[];
  loadingDetail: boolean;

  // K线参数
  klinePeriod: KLinePeriod;
  klineAdjust: AdjustType;

  // 搜索
  searchResults: StockSearchResult[];
  searchLoading: boolean;

  // 限流器状态
  rateLimiterStatus: RateLimiterStatus | null;

  // Actions
  loadWatchlist: () => Promise<void>;
  addToWatchlist: (stock: { code: string; market: number; name: string }) => Promise<void>;
  removeFromWatchlist: (market: number, code: string) => Promise<void>;
  reorderWatchlist: (items: { market: number; code: string; sortOrder: number }[]) => Promise<void>;
  refreshQuotes: () => Promise<void>;
  selectStock: (market: number, code: string) => Promise<void>;
  loadKLine: (period?: KLinePeriod, adjust?: AdjustType) => Promise<void>;
  loadTimeline: () => Promise<void>;
  loadMoneyFlow: () => Promise<void>;
  searchStocks: (keyword: string) => Promise<void>;
  clearSearch: () => void;
  loadRateLimiterStatus: () => Promise<void>;
}

export const useStockStore = create<StockState>((set, get) => ({
  watchlist: null,
  loadingWatchlist: false,
  quotes: new Map(),
  loadingQuotes: false,
  selectedStock: null,
  currentQuote: null,
  klineData: [],
  timelineData: [],
  moneyFlowData: [],
  loadingDetail: false,
  klinePeriod: 101, // 默认日K
  klineAdjust: 1,   // 默认前复权
  searchResults: [],
  searchLoading: false,
  rateLimiterStatus: null,

  loadWatchlist: async () => {
    set({ loadingWatchlist: true });
    try {
      const res = await client.invoke('stock:getWatchlist', undefined);
      if ('error' in res) throw new Error(res.error);
      set({ watchlist: res.data });
    } catch (err) {
      toast.error(`加载自选股失败: ${err}`);
    } finally {
      set({ loadingWatchlist: false });
    }
  },

  addToWatchlist: async (stock) => {
    try {
      const res = await client.invoke('stock:addToWatchlist', stock);
      if ('error' in res) throw new Error(res.error);
      set({ watchlist: res.data });
      toast.success(`已添加 ${stock.name}`);
      // 刷新行情
      get().refreshQuotes();
    } catch (err) {
      toast.error(`添加失败: ${err}`);
    }
  },

  removeFromWatchlist: async (market, code) => {
    try {
      const res = await client.invoke('stock:removeFromWatchlist', { market, code });
      if ('error' in res) throw new Error(res.error);
      set({ watchlist: res.data });
      // 如果删除的是当前选中的，清空详情
      const { selectedStock } = get();
      if (selectedStock?.market === market && selectedStock?.code === code) {
        set({ selectedStock: null, currentQuote: null, klineData: [], timelineData: [], moneyFlowData: [] });
      }
    } catch (err) {
      toast.error(`删除失败: ${err}`);
    }
  },

  reorderWatchlist: async (items) => {
    try {
      const res = await client.invoke('stock:reorderWatchlist', { items });
      if ('error' in res) throw new Error(res.error);
      set({ watchlist: res.data });
    } catch (err) {
      toast.error(`排序失败: ${err}`);
    }
  },

  refreshQuotes: async () => {
    const { watchlist } = get();
    if (!watchlist || watchlist.items.length === 0) return;

    set({ loadingQuotes: true });
    try {
      const stocks = watchlist.items.map(i => ({ market: i.market, code: i.code }));
      const res = await client.invoke('stock:batchQuotes', { stocks });
      if ('error' in res) throw new Error(res.error);

      const newQuotes = new Map<string, StockQuote>();
      for (const q of res.data) {
        newQuotes.set(`${q.market}.${q.code}`, q);
      }
      set({ quotes: newQuotes });
    } catch (err) {
      toast.error(`刷新行情失败: ${err}`);
    } finally {
      set({ loadingQuotes: false });
    }
  },

  selectStock: async (market, code) => {
    set({ selectedStock: { market, code }, loadingDetail: true });
    try {
      // 并行请求行情 + K线
      const [quoteRes, klineRes] = await Promise.all([
        client.invoke('stock:getQuote', { market, code }),
        client.invoke('stock:getKLine', {
          market, code,
          period: get().klinePeriod,
          adjust: get().klineAdjust,
          limit: 250,
        }),
      ]);

      if ('error' in quoteRes) throw new Error(quoteRes.error);
      if ('error' in klineRes) throw new Error(klineRes.error);

      set({
        currentQuote: quoteRes.data,
        klineData: klineRes.data,
        // 切换股票时清空分时和资金流向，需要用户主动切 tab 才加载
        timelineData: [],
        moneyFlowData: [],
      });
    } catch (err) {
      toast.error(`加载详情失败: ${err}`);
    } finally {
      set({ loadingDetail: false });
    }
  },

  loadKLine: async (period, adjust) => {
    const { selectedStock } = get();
    if (!selectedStock) return;

    if (period !== undefined) set({ klinePeriod: period });
    if (adjust !== undefined) set({ klineAdjust: adjust });

    const p = period ?? get().klinePeriod;
    const a = adjust ?? get().klineAdjust;

    try {
      const res = await client.invoke('stock:getKLine', {
        market: selectedStock.market,
        code: selectedStock.code,
        period: p,
        adjust: a,
        limit: 250,
      });
      if ('error' in res) throw new Error(res.error);
      set({ klineData: res.data });
    } catch (err) {
      toast.error(`加载K线失败: ${err}`);
    }
  },

  loadTimeline: async () => {
    const { selectedStock } = get();
    if (!selectedStock) return;
    try {
      const res = await client.invoke('stock:getTimeline', selectedStock);
      if ('error' in res) throw new Error(res.error);
      set({ timelineData: res.data });
    } catch (err) {
      toast.error(`加载分时失败: ${err}`);
    }
  },

  loadMoneyFlow: async () => {
    const { selectedStock } = get();
    if (!selectedStock) return;
    try {
      const res = await client.invoke('stock:getMoneyFlow', selectedStock);
      if ('error' in res) throw new Error(res.error);
      set({ moneyFlowData: res.data });
    } catch (err) {
      toast.error(`加载资金流向失败: ${err}`);
    }
  },

  searchStocks: async (keyword) => {
    if (!keyword.trim()) {
      set({ searchResults: [] });
      return;
    }
    set({ searchLoading: true });
    try {
      const res = await client.invoke('stock:search', { keyword });
      if ('error' in res) throw new Error(res.error);
      set({ searchResults: res.data });
    } catch (err) {
      toast.error(`搜索失败: ${err}`);
    } finally {
      set({ searchLoading: false });
    }
  },

  clearSearch: () => set({ searchResults: [], searchLoading: false }),

  loadRateLimiterStatus: async () => {
    try {
      const res = await client.invoke('stock:getRateLimiterStatus', undefined);
      if ('error' in res) return;
      set({ rateLimiterStatus: res.data });
    } catch { /* 忽略 */ }
  },
}));
```

**Step 2: Commit**

```bash
git add stores/stock-store.ts
git commit -m "feat(stock): implement Zustand stock store with all actions"
```

---

## Task 8: 前端共享组件 — PriceText + PercentBadge

**Files:**
- Create: `components/stock/shared/PriceText.tsx`
- Create: `components/stock/shared/PercentBadge.tsx`

**Step 1: PriceText — 价格着色组件**

```tsx
import { cn } from '@/lib/utils';

interface PriceTextProps {
  value: number;
  prevClose?: number;        // 昨收，用于判断涨跌
  className?: string;
  prefix?: string;           // 前缀如 "¥"
  decimals?: number;
}

export function PriceText({ value, prevClose, className, prefix = '', decimals = 2 }: PriceTextProps) {
  const diff = prevClose !== undefined ? value - prevClose : value;
  const colorClass = diff > 0 ? 'text-red-500' : diff < 0 ? 'text-green-500' : 'text-muted-foreground';

  return (
    <span className={cn(colorClass, className)}>
      {prefix}{value.toFixed(decimals)}
    </span>
  );
}
```

**Step 2: PercentBadge — 涨跌幅徽章**

```tsx
import { cn } from '@/lib/utils';

interface PercentBadgeProps {
  value: number;             // 涨跌幅百分比
  className?: string;
  showSign?: boolean;        // 是否显示 +/- 号
}

export function PercentBadge({ value, className, showSign = true }: PercentBadgeProps) {
  const isUp = value > 0;
  const isDown = value < 0;
  const sign = showSign && isUp ? '+' : '';

  return (
    <span
      className={cn(
        'inline-flex items-center px-1.5 py-0.5 rounded text-xs font-medium',
        isUp && 'bg-red-500/10 text-red-500',
        isDown && 'bg-green-500/10 text-green-500',
        !isUp && !isDown && 'bg-muted text-muted-foreground',
        className,
      )}
    >
      {sign}{value.toFixed(2)}%
    </span>
  );
}
```

**Step 3: Commit**

```bash
git add components/stock/shared/
git commit -m "feat(stock): add PriceText and PercentBadge shared components"
```

---

## Task 9: 自选股列表组件 — WatchList.tsx

**Files:**
- Create: `components/stock/WatchList.tsx`

**Step 1: 创建自选股列表**

左栏组件：显示所有自选股的简要行情，支持点击选中、右键删除。

```tsx
// 使用 useStockStore 获取数据
// 每行显示：名称、代码、价格、涨跌幅
// 选中态高亮
// 底部 "+ 添加股票" 按钮 → 打开 StockSearch 弹窗
// 加载状态：Loader2 spinner
```

组件约 120-150 行。具体参照 `components/BookConversationList.tsx` 的列表模式。

**Step 2: Commit**

```bash
git add components/stock/WatchList.tsx
git commit -m "feat(stock): implement WatchList component"
```

---

## Task 10: 股票搜索弹窗 — StockSearch.tsx

**Files:**
- Create: `components/stock/StockSearch.tsx`

**Step 1: 创建搜索组件**

使用 shadcn Dialog + Input，输入防抖 300ms，显示搜索结果列表，点击添加到自选。

```tsx
// shadcn: Dialog, DialogContent, DialogHeader, DialogTitle
// Input 输入框 + 防抖 300ms
// 搜索结果列表，每行：代码、名称、市场标签（沪/深）
// 点击 → addToWatchlist → 关闭弹窗
```

约 80-100 行。

**Step 2: Commit**

```bash
git add components/stock/StockSearch.tsx
git commit -m "feat(stock): implement StockSearch dialog"
```

---

## Task 11: 行情卡片 — StockQuote.tsx

**Files:**
- Create: `components/stock/StockQuote.tsx`

**Step 1: 创建行情卡片**

显示个股的完整行情数据：价格、涨跌、开高低收、成交量/额、市盈率/市净率、市值等。

```tsx
// 顶部大字：价格 + 涨跌额 + 涨跌幅
// 网格布局显示详细数据：
//   开盘    最高    成交量    市盈率    总市值
//   昨收    最低    成交额    市净率    流通市值
//   振幅    换手率  量比     涨速      主力净流入
// 使用 PriceText 和 PercentBadge
```

约 100-130 行。

**Step 2: Commit**

```bash
git add components/stock/StockQuote.tsx
git commit -m "feat(stock): implement StockQuote info card"
```

---

## Task 12: K线图组件 — KLineChart.tsx

**Files:**
- Create: `components/stock/KLineChart.tsx`

**Step 1: 创建 K线图**

这是最复杂的组件，封装 Lightweight Charts：

```tsx
// import { createChart, CandlestickSeries, VolumeSeries, LineSeries } from 'lightweight-charts';
//
// 功能：
// 1. 蜡烛图主图
// 2. 成交量副图（柱状图，红涨绿跌）
// 3. 均线叠加（MA5/10/20/60，通过 LineSeries 实现）
// 4. 周期切换按钮组：1min/5min/15min/30min/60min/日K/周K/月K
// 5. 复权切换：前复权/后复权/不复权
// 6. 响应式：useResizeObserver 监听容器大小变化
// 7. 暗色主题适配（通过 Tailwind CSS 变量）
//
// useEffect 管理 chart 生命周期（create → setData → dispose）
// K线数据从 store.klineData 获取
// 切换周期/复权时调用 store.loadKLine(period, adjust)
```

约 200-250 行。参考 Lightweight Charts 文档：
- createChart() → chart.addSeries(CandlestickSeries) → series.setData()
- 副图：chart.addSeries(VolumeSeries, { priceScaleId: 'volume' })

**Step 2: Commit**

```bash
git add components/stock/KLineChart.tsx
git commit -m "feat(stock): implement KLineChart with Lightweight Charts"
```

---

## Task 13: 分时图 + 资金流向 + 基本面组件

**Files:**
- Create: `components/stock/TimelineChart.tsx`
- Create: `components/stock/MoneyFlow.tsx`
- Create: `components/stock/StockFundamental.tsx`

**Step 1: TimelineChart — 分时图**

```tsx
// 使用 Lightweight Charts 的 LineSeries
// X 轴：09:30 ~ 15:00
// 双线：价格线（蓝色）+ 均价线（橙色）
// 底部成交量柱状图
// 数据从 store.timelineData 获取
```

约 120 行。

**Step 2: MoneyFlow — 资金流向**

```tsx
// 柱状图显示每日主力/散户净流入
// 红色=净流入，绿色=净流出
// 使用 Lightweight Charts HistogramSeries
// 数据从 store.moneyFlowData 获取
```

约 100 行。

**Step 3: StockFundamental — 基本面数据**

```tsx
// 简单的数据展示卡片
// 从 currentQuote 中提取：
//   市盈率(动态) / 市盈率(TTM) / 市净率
//   总市值 / 流通市值
//   60日涨跌幅 / 年初至今涨跌幅
// 格式化大数字：亿/万
```

约 60 行。

**Step 4: Commit**

```bash
git add components/stock/TimelineChart.tsx components/stock/MoneyFlow.tsx components/stock/StockFundamental.tsx
git commit -m "feat(stock): add timeline chart, money flow, and fundamental components"
```

---

## Task 14: 个股详情容器 — StockDetail.tsx

**Files:**
- Create: `components/stock/StockDetail.tsx`

**Step 1: 创建详情容器**

右栏容器，组合行情卡片 + K线图 + 底部 Tab（分时/资金/基本面）。

```tsx
// 使用 shadcn Tabs 组件
// 布局：
//   <StockQuote />
//   <KLineChart />
//   <Tabs>
//     <TabsTrigger value="timeline">分时</TabsTrigger>
//     <TabsTrigger value="moneyflow">资金流向</TabsTrigger>
//     <TabsTrigger value="fundamental">基本面</TabsTrigger>
//   </Tabs>
//   <TabsContent>对应组件</TabsContent>
//
// Tab 切换时懒加载对应数据（loadTimeline / loadMoneyFlow）
// 空状态提示："请从左侧选择一只股票"
```

约 80-100 行。

**Step 2: Commit**

```bash
git add components/stock/StockDetail.tsx
git commit -m "feat(stock): implement StockDetail container with tabs"
```

---

## Task 15: 股票主页面 — StockPage + 路由注册

**Files:**
- Create: `app/stocks/page.tsx`
- Modify: `src/App.tsx` — 添加 `/stocks` 路由

**Step 1: 创建 `app/stocks/page.tsx`**

```tsx
// 双栏布局：
// <div className="h-screen flex flex-col">
//   <header> 顶栏：返回按钮 + 标题 + 搜索按钮 + 刷新按钮 </header>
//   <div className="flex flex-1 overflow-hidden">
//     <aside className="w-60 border-r"> <WatchList /> </aside>
//     <main className="flex-1"> <StockDetail /> </main>
//   </div>
// </div>
//
// useEffect → loadWatchlist + refreshQuotes
// 搜索按钮 → 打开 StockSearch 弹窗
// 刷新按钮 → 防抖 500ms → refreshQuotes
```

约 80 行。

**Step 2: 修改 `src/App.tsx` 添加路由**

```tsx
import StockPage from '@/app/stocks/page';
// 在 <Routes> 中添加：
<Route path="/stocks" element={<StockPage />} />
```

**Step 3: 编译并启动验证**

```bash
bun run build:electron && bun run dev
```

在浏览器/Electron 中访问 `#/stocks`，验证：
- 页面正常渲染
- 搜索能找到股票
- 添加到自选后行情加载
- 点击股票显示 K线图

**Step 4: Commit**

```bash
git add app/stocks/page.tsx src/App.tsx
git commit -m "feat(stock): add stock page with route registration"
```

---

## Task 16: 导航入口 + 收尾

**Files:**
- Modify: `app/page.tsx` 或相关导航组件 — 添加进入 `/stocks` 的入口

**Step 1: 在主页添加导航入口**

查看现有的导航模式（侧边栏/顶栏），添加 "股票行情" 入口链接/按钮，使用 `useNavigate()` 跳转到 `/stocks`。

**Step 2: 完整功能验证**

```bash
bun run build:electron && bun run dev
```

验证清单：
- [ ] 主页能看到股票入口并点击进入
- [ ] 自选股搜索、添加、删除正常
- [ ] 批量行情加载（红涨绿跌着色）
- [ ] 个股详情：行情卡片数据完整
- [ ] K线图渲染正常，周期/复权切换
- [ ] 分时图、资金流向、基本面 Tab 切换
- [ ] 快速操作不触发限流
- [ ] 限流器状态可查（调试用）

**Step 3: Commit**

```bash
git add -A
git commit -m "feat(stock): add navigation entry and finalize stock watchlist feature"
```

---

## 任务依赖关系

```
Task 1 (类型+依赖)
  └─▶ Task 2 (RateLimiter)
       └─▶ Task 3 (StockService API)
            ├─▶ Task 4 (Watchlist JSON)
            ├─▶ Task 5 (JSONL K线)
            │    └─▶ Task 6 (IPC 路由) ←── Task 4
            │         └─▶ Task 7 (Zustand Store)
            │              ├─▶ Task 8 (共享组件)
            │              ├─▶ Task 9 (WatchList)
            │              ├─▶ Task 10 (Search)
            │              ├─▶ Task 11 (Quote)
            │              ├─▶ Task 12 (KLine) ★ 最复杂
            │              ├─▶ Task 13 (分时/资金/基本面)
            │              └─▶ Task 14 (Detail 容器)
            │                   └─▶ Task 15 (页面+路由)
            │                        └─▶ Task 16 (导航+收尾)
```

Tasks 8-14 之间互相独立，可以并行开发。
