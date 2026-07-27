/**
 * 股票数据 JSONL 存储服务
 *
 * 存储路径：
 *   - K线数据：.dogear/stocks/kline/{market}.{code}.jsonl
 *   - 每日快照：.dogear/stocks/daily/{market}.{code}.jsonl
 *
 * JSONL 格式：每行一个 JSON 对象。
 *
 * 职责：
 *   - readKLine / appendKLine / writeKLine — K线数据管理
 *   - appendDailySnapshot / readDailySnapshots — 每日快照管理
 */
import fs from 'fs/promises';
import path from 'path';
import electron from 'electron';
import { safeFileWrite } from '../safe-json.js';

const { app } = electron;

// ============================================================
// 类型定义（在文件内定义，避免 rootDir 限制）
// ============================================================

/** K 线数据点（与 stock-service.ts 中的 KLineDataPoint 保持一致） */
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

/** 每日快照数据点（与 types/stock.ts 中的 DailySnapshot 保持一致） */
export interface DailySnapshot {
  date: string;
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
  price: number;
  volume: number;
  turnover: number;
  changePercent: number;
  peRatio: number;
  pbRatio: number;
  totalMarketCap: number;
  floatMarketCap: number;
  turnoverRate: number;
  timestamp: number;
}

// ============================================================
// 工具函数
// ============================================================

/**
 * 获取配置目录。
 * - 开发阶段：<项目根目录>/.dogear
 * - 打包发布后：AppData/Roaming/Dogear/.dogear
 */
function getConfigDir(): string {
  if (app.isPackaged) {
    return path.join(app.getPath('userData'), '.dogear');
  }
  return path.join(process.cwd(), '.dogear');
}

/**
 * 获取指定股票的 JSONL 文件路径。
 * @param market 市场代码（1=沪 0=深）
 * @param code   股票代码（如 "600519"）
 * @returns 如 ".dogear/stocks/kline/1.600519.jsonl"
 */
function getKLinePath(market: number, code: string): string {
  return path.join(getConfigDir(), 'stocks', 'kline', `${market}.${code}.jsonl`);
}

/**
 * 获取指定股票的每日快照 JSONL 文件路径。
 */
function getDailyPath(market: number, code: string): string {
  return path.join(getConfigDir(), 'stocks', 'daily', `${market}.${code}.jsonl`);
}

/**
 * 将对象数组序列化为 JSONL 字符串。
 * 每行一个 JSON 对象，末尾带换行符。
 */
function toJsonl(points: Record<string, unknown>[]): string {
  return points.map((p) => JSON.stringify(p)).join('\n') + '\n';
}

/**
 * 解析 JSONL 文本为 KLineDataPoint 数组。
 * 跳过空行和解析失败的行。
 */
function parseJsonl(content: string): KLineDataPoint[] {
  const results: KLineDataPoint[] = [];
  const lines = content.split('\n');

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    try {
      const point = JSON.parse(trimmed) as KLineDataPoint;
      // 基本校验：必须有 date 字段
      if (point.date) {
        results.push(point);
      }
    } catch {
      // 跳过无法解析的行
    }
  }

  return results;
}

// ============================================================
// StockDataService 类
// ============================================================

class StockDataService {
  /**
   * 读取本地 K 线数据。
   *
   * @param market 市场代码（1=沪 0=深）
   * @param code   股票代码
   * @returns K 线数据点数组，文件不存在则返回空数组
   */
  async readKLine(market: number, code: string): Promise<KLineDataPoint[]> {
    const filePath = getKLinePath(market, code);

    try {
      const content = await fs.readFile(filePath, 'utf-8');
      return parseJsonl(content);
    } catch (err: unknown) {
      // 文件不存在是正常情况，返回空数组
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        return [];
      }
      throw err;
    }
  }

  /**
   * 合并 K 线数据：接口返回的数据按 date 覆盖本地同日期的行，新日期追加。
   *
   * 不能简单跳过已存在的日期——当日 K 线在盘中是未收盘的临时值，
   * 且前复权数据在每次除权除息后整段历史都会变。
   *
   * @param market 市场代码（1=沪 0=深）
   * @param code   股票代码
   * @param points 接口返回的 K 线数据点
   * @returns 新增的数据点数量（不含被覆盖更新的）
   */
  async appendKLine(market: number, code: string, points: KLineDataPoint[]): Promise<number> {
    if (points.length === 0) return 0;

    const filePath = getKLinePath(market, code);
    const existing = await this.readKLine(market, code);
    const byDate = new Map(existing.map((p) => [p.date, p]));

    let added = 0;
    let changed = false;

    for (const point of points) {
      const prev = byDate.get(point.date);
      if (!prev) {
        added++;
        changed = true;
      } else if (JSON.stringify(prev) !== JSON.stringify(point)) {
        changed = true;
      }
      byDate.set(point.date, point);
    }

    if (!changed) return 0;

    const merged = [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date));
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await safeFileWrite(filePath, toJsonl(merged as unknown as Record<string, unknown>[]));

    return added;
  }

  /**
   * 覆盖写入 K 线数据。
   *
   * 完全替换文件内容，适用于非日 K 线（分钟线、周线等），无需增量更新。
   *
   * @param market 市场代码（1=沪 0=深）
   * @param code   股票代码
   * @param points K 线数据点数组
   */
  async writeKLine(market: number, code: string, points: KLineDataPoint[]): Promise<void> {
    const filePath = getKLinePath(market, code);

    const jsonlContent = points.length === 0
      ? ''
      : toJsonl(points as unknown as Record<string, unknown>[]);
    await safeFileWrite(filePath, jsonlContent);
  }

  // ============================================================
  // 每日快照
  // ============================================================

  /**
   * 写入每日快照：同日期用新值覆盖，新日期追加。
   *
   * 快照采自实时行情，盘中采到的是临时值，必须允许当日覆盖，
   * 否则那天最终留下的是第一次打开页面时的盘中价而非收盘价。
   *
   * @returns 是否实际写盘（false 表示数据无变化）
   */
  async appendDailySnapshot(market: number, code: string, snapshot: DailySnapshot): Promise<boolean> {
    const filePath = getDailyPath(market, code);
    const existing = await this.readDailySnapshots(market, code);
    const idx = existing.findIndex((s) => s.date === snapshot.date);

    await fs.mkdir(path.dirname(filePath), { recursive: true });

    if (idx < 0) {
      await fs.appendFile(filePath, JSON.stringify(snapshot) + '\n', 'utf-8');
      return true;
    }

    if (JSON.stringify(existing[idx]) === JSON.stringify(snapshot)) return false;

    // readDailySnapshots 返回降序，落盘统一按日期升序，与追加写入的自然顺序一致
    existing[idx] = snapshot;
    existing.sort((a, b) => a.date.localeCompare(b.date));
    await safeFileWrite(filePath, toJsonl(existing as unknown as Record<string, unknown>[]));
    return true;
  }

  /**
   * 读取本地每日快照数据。
   */
  async readDailySnapshots(market: number, code: string, limit?: number): Promise<DailySnapshot[]> {
    const filePath = getDailyPath(market, code);

    try {
      const content = await fs.readFile(filePath, 'utf-8');
      const results: DailySnapshot[] = [];

      for (const line of content.split('\n')) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        try {
          const point = JSON.parse(trimmed) as DailySnapshot;
          if (point.date) results.push(point);
        } catch { /* 跳过无法解析的行 */ }
      }

      // 按日期降序返回，可选限制条数
      results.sort((a, b) => b.date.localeCompare(a.date));
      return limit ? results.slice(0, limit) : results;
    } catch (err: unknown) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return [];
      throw err;
    }
  }
}

// ============================================================
// 导出单例
// ============================================================

/** 全局 StockDataService 单例 */
export const stockDataService = new StockDataService();
