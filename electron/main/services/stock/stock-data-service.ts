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
 *   - readKLine / appendKLine / writeKLine / getLastDate — K线数据管理
 *   - appendDailySnapshot / readDailySnapshots / hasTodaySnapshot — 每日快照管理
 */
import fs from 'fs/promises';
import path from 'path';
import electron from 'electron';

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
 * - 打包发布后：<app.asar 同级目录>/.dogear
 */
function getConfigDir(): string {
  if (app.isPackaged) {
    return path.join(path.dirname(app.getAppPath()), '.dogear');
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
   * 增量追加 K 线数据。
   *
   * 先读取现有数据获取已有日期集合，只追加新日期的数据点。
   * 适用于日 K 线等需要增量更新的场景。
   *
   * @param market 市场代码（1=沪 0=深）
   * @param code   股票代码
   * @param points 待追加的 K 线数据点
   * @returns 实际追加的数据点数量
   */
  async appendKLine(market: number, code: string, points: KLineDataPoint[]): Promise<number> {
    if (points.length === 0) return 0;

    const filePath = getKLinePath(market, code);

    // 读取现有数据，收集已有日期
    const existing = await this.readKLine(market, code);
    const existingDates = new Set(existing.map((p) => p.date));

    // 过滤出新数据点（按 date 去重）
    const newPoints = points.filter((p) => !existingDates.has(p.date));
    if (newPoints.length === 0) return 0;

    // 确保目录存在
    await fs.mkdir(path.dirname(filePath), { recursive: true });

    // 追加写入新数据
    const jsonlContent = toJsonl(newPoints as unknown as Record<string, unknown>[]);
    await fs.appendFile(filePath, jsonlContent, 'utf-8');

    return newPoints.length;
  }

  /**
   * 获取本地最后一条 K 线数据的日期。
   *
   * 用于增量请求：获取本地最新日期后，只请求该日期之后的数据。
   *
   * @param market 市场代码（1=沪 0=深）
   * @param code   股票代码
   * @returns 最后一条数据的日期字符串，无数据则返回 null
   */
  async getLastDate(market: number, code: string): Promise<string | null> {
    const points = await this.readKLine(market, code);
    if (points.length === 0) return null;

    // JSONL 文件中数据按时间顺序存储，最后一条即为最新
    return points[points.length - 1].date;
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

    // 确保目录存在
    await fs.mkdir(path.dirname(filePath), { recursive: true });

    if (points.length === 0) {
      // 空数据则写入空文件
      await fs.writeFile(filePath, '', 'utf-8');
      return;
    }

    const jsonlContent = toJsonl(points as unknown as Record<string, unknown>[]);
    await fs.writeFile(filePath, jsonlContent, 'utf-8');
  }

  // ============================================================
  // 每日快照
  // ============================================================

  /**
   * 追加每日快照（按 date 去重）。
   * @returns 是否实际写入（false 表示该日已存在）
   */
  async appendDailySnapshot(market: number, code: string, snapshot: DailySnapshot): Promise<boolean> {
    const filePath = getDailyPath(market, code);

    // 读取已有快照，检查去重
    const existing = await this.readDailySnapshots(market, code);
    if (existing.some((s) => s.date === snapshot.date)) {
      return false;
    }

    await fs.mkdir(path.dirname(filePath), { recursive: true });
    const line = JSON.stringify(snapshot) + '\n';
    await fs.appendFile(filePath, line, 'utf-8');
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

  /**
   * 判断指定交易日是否已有快照。
   */
  async hasTodaySnapshot(market: number, code: string, tradeDate: string): Promise<boolean> {
    const snapshots = await this.readDailySnapshots(market, code);
    return snapshots.some((s) => s.date === tradeDate);
  }
}

// ============================================================
// 导出单例
// ============================================================

/** 全局 StockDataService 单例 */
export const stockDataService = new StockDataService();
