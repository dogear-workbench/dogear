/**
 * 请求防御体系 — RateLimiter
 *
 * 三层防御 + 请求合并 + 内存缓存，股票模块的基础设施。
 *
 * 架构：
 *   1. TokenBucket（令牌桶）— 控制瞬时速率
 *   2. SlidingWindow（滑动窗口）— 控制时间窗口内总请求数
 *   3. CircuitBreaker（断路器）— 连续失败时熔断
 *   4. RequestMerger（请求合并）— 相同 key 的并发请求共享 Promise
 *   5. MemoryCache（内存缓存）— 支持 TTL 的简易缓存
 *   6. RateLimiter（主类）— 整合以上所有组件
 */

// ============================================================
// 类型定义（在文件内定义，避免 rootDir 限制）
// ============================================================

/** 断路器状态 */
export type CircuitState = 'CLOSED' | 'OPEN' | 'HALF_OPEN';

/** RateLimiter 运行状态快照 */
export interface RateLimiterStatus {
  circuitState: CircuitState;
  requestsInWindow: number;
  tokensAvailable: number;
  consecutiveFailures: number;
  cooldownUntil: number | null;
}

// ============================================================
// 1. TokenBucket — 令牌桶
// ============================================================

/**
 * 令牌桶算法，控制瞬时请求速率。
 * - 桶容量：maxTokens（默认 2）
 * - 补充速率：每 refillIntervalMs 补充 1 个令牌（默认 500ms）
 */
class TokenBucket {
  /** 当前可用令牌数 */
  private tokens: number;
  /** 上次补充时间戳 */
  private lastRefillTime: number;

  constructor(
    /** 桶的最大容量 */
    private readonly maxTokens: number = 2,
    /** 令牌补充间隔（毫秒） */
    private readonly refillIntervalMs: number = 500
  ) {
    this.tokens = maxTokens;
    this.lastRefillTime = Date.now();
  }

  /** 补充令牌：根据流逝时间计算应补充的令牌数 */
  private refill(): void {
    const now = Date.now();
    const elapsed = now - this.lastRefillTime;
    // 计算应补充的令牌数（每 refillIntervalMs 补充 1 个）
    const tokensToAdd = Math.floor(elapsed / this.refillIntervalMs);
    if (tokensToAdd > 0) {
      this.tokens = Math.min(this.maxTokens, this.tokens + tokensToAdd);
      this.lastRefillTime = now;
    }
  }

  /** 尝试消耗一个令牌，成功返回 true */
  tryConsume(): boolean {
    this.refill();
    if (this.tokens > 0) {
      this.tokens--;
      return true;
    }
    return false;
  }

  /**
   * 等待直到有令牌可用，然后消耗一个。
   * 内部以 refillIntervalMs 为间隔轮询。
   */
  async waitForToken(): Promise<void> {
    while (!this.tryConsume()) {
      await new Promise((resolve) => setTimeout(resolve, this.refillIntervalMs));
    }
  }

  /** 获取当前可用令牌数（先补充再返回） */
  getAvailableTokens(): number {
    this.refill();
    return this.tokens;
  }
}

// ============================================================
// 2. SlidingWindow — 滑动窗口
// ============================================================

/**
 * 滑动窗口限流器。
 * - 窗口大小：windowMs（默认 60s）
 * - 窗口内最大请求数：maxRequests（默认 60）
 */
class SlidingWindow {
  /** 窗口内的请求时间戳列表 */
  private timestamps: number[] = [];

  constructor(
    /** 窗口时长（毫秒） */
    private readonly windowMs: number = 60_000,
    /** 窗口内最大请求数 */
    private readonly maxRequests: number = 60
  ) {}

  /** 清除窗口外的过期时间戳 */
  private cleanup(): void {
    const cutoff = Date.now() - this.windowMs;
    // 找到第一个未过期的索引，截掉之前的
    const firstValidIndex = this.timestamps.findIndex((t) => t > cutoff);
    if (firstValidIndex === -1) {
      // 全部过期
      this.timestamps = [];
    } else if (firstValidIndex > 0) {
      this.timestamps = this.timestamps.slice(firstValidIndex);
    }
  }

  /** 检查是否允许新请求（不记录） */
  canProceed(): boolean {
    this.cleanup();
    return this.timestamps.length < this.maxRequests;
  }

  /** 记录一次请求 */
  record(): void {
    this.timestamps.push(Date.now());
  }

  /** 等待直到窗口内有空位 */
  async waitForSlot(): Promise<void> {
    while (!this.canProceed()) {
      // 计算最早的请求何时过期
      const oldestTimestamp = this.timestamps[0];
      const waitTime = oldestTimestamp + this.windowMs - Date.now() + 10; // 加 10ms 余量
      await new Promise((resolve) => setTimeout(resolve, Math.max(waitTime, 100)));
    }
  }

  /** 获取当前窗口内的请求数 */
  getRequestCount(): number {
    this.cleanup();
    return this.timestamps.length;
  }
}

// ============================================================
// 3. CircuitBreaker — 断路器
// ============================================================

/**
 * 断路器模式，防止对故障服务持续请求。
 *
 * 状态转换：
 *   CLOSED → (连续 failureThreshold 次失败) → OPEN
 *   OPEN   → (冷却 cooldownMs 后) → HALF_OPEN
 *   HALF_OPEN → 探测成功 → CLOSED
 *   HALF_OPEN → 探测失败 → OPEN（重置冷却计时）
 */
class CircuitBreaker {
  /** 当前状态 */
  private state: CircuitState = 'CLOSED';
  /** 连续失败次数 */
  private consecutiveFailures: number = 0;
  /** 冷却截止时间（仅 OPEN 状态有效） */
  private cooldownUntil: number | null = null;

  constructor(
    /** 触发熔断的连续失败次数阈值 */
    private readonly failureThreshold: number = 3,
    /** 熔断冷却时间（毫秒） */
    private readonly cooldownMs: number = 30_000
  ) {}

  /** 检查断路器是否允许请求通过 */
  canProceed(): boolean {
    switch (this.state) {
      case 'CLOSED':
        return true;

      case 'OPEN':
        // 检查冷却是否到期
        if (this.cooldownUntil && Date.now() >= this.cooldownUntil) {
          // 转为半开状态，允许一次探测请求
          this.state = 'HALF_OPEN';
          this.cooldownUntil = null;
          return true;
        }
        return false;

      case 'HALF_OPEN':
        // 半开状态只允许一个探测请求（由调用方保证串行）
        return true;

      default:
        return false;
    }
  }

  /** 记录一次成功 */
  onSuccess(): void {
    this.consecutiveFailures = 0;
    this.state = 'CLOSED';
    this.cooldownUntil = null;
  }

  /** 记录一次失败 */
  onFailure(): void {
    this.consecutiveFailures++;

    if (this.state === 'HALF_OPEN') {
      // 半开状态下探测失败，立刻回到 OPEN
      this.state = 'OPEN';
      this.cooldownUntil = Date.now() + this.cooldownMs;
      return;
    }

    if (this.consecutiveFailures >= this.failureThreshold) {
      // 达到阈值，熔断
      this.state = 'OPEN';
      this.cooldownUntil = Date.now() + this.cooldownMs;
    }
  }

  /** 获取当前状态 */
  getState(): CircuitState {
    // 检查 OPEN 状态是否已冷却完毕（惰性转换）
    if (this.state === 'OPEN' && this.cooldownUntil && Date.now() >= this.cooldownUntil) {
      this.state = 'HALF_OPEN';
      this.cooldownUntil = null;
    }
    return this.state;
  }

  /** 获取连续失败次数 */
  getConsecutiveFailures(): number {
    return this.consecutiveFailures;
  }

  /** 获取冷却截止时间 */
  getCooldownUntil(): number | null {
    return this.cooldownUntil;
  }
}

// ============================================================
// 4. RequestMerger — 请求合并
// ============================================================

/**
 * 请求合并器：相同 key 的并发请求共享同一个 Promise。
 * 当第一个请求完成后，后续所有等待的请求都会得到相同的结果。
 */
class RequestMerger {
  /** 正在进行中的请求 map：key → Promise */
  private inflight: Map<string, Promise<unknown>> = new Map();

  /**
   * 执行或合并请求。
   * - 如果该 key 已有进行中的请求，直接返回共享的 Promise
   * - 否则执行 fn 并将 Promise 注册到 map 中
   */
  async execute<T>(key: string, fn: () => Promise<T>): Promise<T> {
    // 如果该 key 已有进行中的请求，直接共享
    const existing = this.inflight.get(key);
    if (existing) {
      return existing as Promise<T>;
    }

    // 执行请求，完成后从 map 中移除
    const promise = fn().finally(() => {
      this.inflight.delete(key);
    });

    this.inflight.set(key, promise);
    return promise;
  }
}

// ============================================================
// 5. MemoryCache — 内存缓存
// ============================================================

/** 缓存条目 */
interface CacheEntry<T> {
  value: T;
  /** 过期时间戳（Date.now() 基准） */
  expiresAt: number;
}

/**
 * 支持 TTL 的简易内存缓存。
 * 过期条目在 get 时惰性清除。
 */
class MemoryCache {
  private store: Map<string, CacheEntry<unknown>> = new Map();

  /** 获取缓存值，过期则返回 undefined */
  get<T>(key: string): T | undefined {
    const entry = this.store.get(key);
    if (!entry) return undefined;

    if (Date.now() > entry.expiresAt) {
      // 已过期，惰性清除
      this.store.delete(key);
      return undefined;
    }

    return entry.value as T;
  }

  /**
   * 写入缓存
   * @param key 缓存键
   * @param value 缓存值
   * @param ttlMs 生存时间（毫秒）
   */
  set<T>(key: string, value: T, ttlMs: number): void {
    this.store.set(key, {
      value,
      expiresAt: Date.now() + ttlMs,
    });
  }

  /** 删除指定缓存 */
  delete(key: string): void {
    this.store.delete(key);
  }

  /** 清空所有缓存 */
  clear(): void {
    this.store.clear();
  }

  /** 清除所有已过期的条目 */
  cleanup(): void {
    const now = Date.now();
    for (const [key, entry] of this.store) {
      if (now > entry.expiresAt) {
        this.store.delete(key);
      }
    }
  }
}

// ============================================================
// 6. RateLimiter — 主类
// ============================================================

/** execute 方法的选项 */
export interface ExecuteOptions {
  /** 缓存/合并用的唯一键 */
  key: string;
  /** 缓存 TTL（毫秒），不传则不缓存 */
  cacheTtlMs?: number;
}

/**
 * RateLimiter 主类 — 整合三层防御 + 请求合并 + 内存缓存。
 *
 * execute() 方法流程：
 *   1. 检查缓存 → 命中则直接返回
 *   2. 断路器检查 → OPEN 则拒绝
 *   3. 请求合并去重 → 相同 key 共享 Promise
 *   4. 滑动窗口限流 → 等待窗口有空位
 *   5. 令牌桶限速 → 等待令牌
 *   6. 记录请求到滑动窗口
 *   7. 执行请求（带指数退避重试，最多 3 次：2s→4s→8s）
 *   8. 写入缓存
 */
export class RateLimiter {
  private tokenBucket: TokenBucket;
  private slidingWindow: SlidingWindow;
  private circuitBreaker: CircuitBreaker;
  private requestMerger: RequestMerger;
  private cache: MemoryCache;

  constructor() {
    // 令牌桶：最多 2 token，每 500ms 补充 1 个
    this.tokenBucket = new TokenBucket(2, 500);
    // 滑动窗口：60s 内最多 60 次
    this.slidingWindow = new SlidingWindow(60_000, 60);
    // 断路器：连续 3 次失败熔断，30s 冷却
    this.circuitBreaker = new CircuitBreaker(3, 30_000);
    // 请求合并器
    this.requestMerger = new RequestMerger();
    // 内存缓存
    this.cache = new MemoryCache();
  }

  /**
   * 执行受保护的请求。
   *
   * @param fn 实际的请求函数
   * @param options 缓存键和 TTL 配置
   * @returns 请求结果
   * @throws 断路器打开或重试耗尽时抛出错误
   */
  async execute<T>(fn: () => Promise<T>, options: ExecuteOptions): Promise<T> {
    const { key, cacheTtlMs } = options;

    // 步骤 1：检查缓存
    if (cacheTtlMs) {
      const cached = this.cache.get<T>(key);
      if (cached !== undefined) {
        return cached;
      }
    }

    // 步骤 2：断路器检查
    if (!this.circuitBreaker.canProceed()) {
      throw new Error(
        `断路器已打开，请求被拒绝（连续失败 ${this.circuitBreaker.getConsecutiveFailures()} 次，` +
        `冷却至 ${new Date(this.circuitBreaker.getCooldownUntil() || 0).toLocaleTimeString()}）`
      );
    }

    // 步骤 3：请求合并去重 — 相同 key 的并发请求共享同一个 Promise
    return this.requestMerger.execute<T>(key, async () => {
      // 步骤 4：滑动窗口限流 — 等待窗口内有空位
      await this.slidingWindow.waitForSlot();

      // 步骤 5：令牌桶限速 — 等待令牌
      await this.tokenBucket.waitForToken();

      // 步骤 6：记录请求到滑动窗口
      this.slidingWindow.record();

      // 步骤 7：带指数退避的重试执行
      // 网络级错误（fetch failed / AbortError）不重试，直接失败
      // HTTP 5xx 等可恢复错误最多重试 2 次（共 3 次尝试）
      const maxRetries = 3;
      const baseDelayMs = 2000;
      let lastError: Error | undefined;

      for (let attempt = 0; attempt < maxRetries; attempt++) {
        try {
          const result = await fn();

          // 执行成功，通知断路器
          this.circuitBreaker.onSuccess();

          // 步骤 8：写入缓存
          if (cacheTtlMs) {
            this.cache.set(key, result, cacheTtlMs);
          }

          return result;
        } catch (error) {
          lastError = error instanceof Error ? error : new Error(String(error));

          // 网络级错误不重试：连接被拒绝/重置（IP封禁）、超时等
          const errMsg = String(error);
          if (
            (error instanceof TypeError && errMsg.includes('fetch failed')) ||
            (error instanceof Error && error.name === 'AbortError')
          ) {
            break; // 跳出重试循环，直接失败
          }

          // 如果不是最后一次重试，等待指数退避时间
          if (attempt < maxRetries - 1) {
            const delay = baseDelayMs * Math.pow(2, attempt); // 2s → 4s → 8s
            await new Promise((resolve) => setTimeout(resolve, delay));
          }
        }
      }

      // 所有重试都失败，通知断路器
      this.circuitBreaker.onFailure();

      throw lastError || new Error('请求失败，重试次数已耗尽');
    });
  }

  /** 获取当前运行状态快照 */
  getStatus(): RateLimiterStatus {
    return {
      circuitState: this.circuitBreaker.getState(),
      requestsInWindow: this.slidingWindow.getRequestCount(),
      tokensAvailable: this.tokenBucket.getAvailableTokens(),
      consecutiveFailures: this.circuitBreaker.getConsecutiveFailures(),
      cooldownUntil: this.circuitBreaker.getCooldownUntil(),
    };
  }

  /** 清空缓存 */
  clearCache(): void {
    this.cache.clear();
  }

  /** 清除过期缓存条目 */
  cleanupCache(): void {
    this.cache.cleanup();
  }
}

// ============================================================
// 导出单例
// ============================================================

/** 全局 RateLimiter 单例 */
export const rateLimiter = new RateLimiter();
