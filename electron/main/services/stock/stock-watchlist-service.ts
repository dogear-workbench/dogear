/**
 * 自选股列表存储服务
 * 存储路径：.dogear/stocks/watchlist.json
 * - 开发阶段：<项目根目录>/.dogear/stocks/watchlist.json
 * - 打包发布后：<app.asar 同级目录>/.dogear/stocks/watchlist.json
 */
import fs from 'fs/promises';
import path from 'path';
import electron from 'electron';

const { app } = electron;

// ============================================================
// 类型定义（在文件内定义，避免 rootDir 限制）
// ============================================================

/** 自选股条目 */
export interface WatchlistItem {
  /** 股票代码 */
  code: string;
  /** 市场代码（1=沪 0=深） */
  market: number;
  /** 股票名称 */
  name: string;
  /** 添加时间（ISO 8601） */
  addedAt: string;
  /** 排序序号（越小越靠前） */
  sortOrder: number;
  /** 自定义标签 */
  tags?: string[];
}

/** 自选股列表 */
export interface Watchlist {
  /** 数据版本号 */
  version: number;
  /** 自选股条目列表 */
  items: WatchlistItem[];
}

// ============================================================
// 默认值
// ============================================================

const DEFAULT_WATCHLIST: Watchlist = {
  version: 1,
  items: [],
};

// ============================================================
// 路径函数
// ============================================================

/**
 * 获取 .dogear 配置目录
 * 开发阶段：项目根目录/.dogear
 * 打包后：app.asar 同级目录/.dogear
 */
function getConfigDir(): string {
  if (app.isPackaged) {
    return path.join(path.dirname(app.getAppPath()), '.dogear');
  }
  return path.join(process.cwd(), '.dogear');
}

/** 获取自选股 JSON 文件所在目录 */
function getStocksDir(): string {
  return path.join(getConfigDir(), 'stocks');
}

/** 获取自选股 JSON 文件路径 */
function getWatchlistPath(): string {
  return path.join(getStocksDir(), 'watchlist.json');
}

// ============================================================
// StockWatchlistService 类
// ============================================================

class StockWatchlistService {
  /**
   * 读取自选股列表
   * 文件不存在时返回默认空列表
   */
  async load(): Promise<Watchlist> {
    const filePath = getWatchlistPath();

    try {
      const raw = await fs.readFile(filePath, 'utf-8');
      const parsed = JSON.parse(raw) as Watchlist;
      return parsed;
    } catch {
      // 文件不存在或解析失败，返回默认值
      return structuredClone(DEFAULT_WATCHLIST);
    }
  }

  /**
   * 保存自选股列表到 JSON 文件
   * 自动创建 .dogear/stocks 目录
   */
  async save(watchlist: Watchlist): Promise<void> {
    const dir = getStocksDir();
    await fs.mkdir(dir, { recursive: true });
    const filePath = getWatchlistPath();
    await fs.writeFile(filePath, JSON.stringify(watchlist, null, 2), 'utf-8');
  }

  /**
   * 添加自选股（去重：相同 market + code 不重复添加）
   * 自动设置 addedAt 和 sortOrder
   *
   * @param item 股票信息（code, market, name, 可选 tags）
   * @returns 更新后的 Watchlist
   */
  async addItem(item: { code: string; market: number; name: string; tags?: string[] }): Promise<Watchlist> {
    const watchlist = await this.load();

    // 去重检查：相同 market + code 视为同一股票
    const exists = watchlist.items.some(
      (existing) => existing.market === item.market && existing.code === item.code,
    );
    if (exists) {
      return watchlist;
    }

    // 计算 sortOrder：放到列表末尾
    const maxOrder = watchlist.items.reduce(
      (max, i) => Math.max(max, i.sortOrder),
      0,
    );

    const newItem: WatchlistItem = {
      code: item.code,
      market: item.market,
      name: item.name,
      addedAt: new Date().toISOString(),
      sortOrder: maxOrder + 1,
      ...(item.tags ? { tags: item.tags } : {}),
    };

    watchlist.items.push(newItem);
    await this.save(watchlist);
    return watchlist;
  }

  /**
   * 删除自选股
   *
   * @param market 市场代码
   * @param code   股票代码
   * @returns 更新后的 Watchlist
   */
  async removeItem(market: number, code: string): Promise<Watchlist> {
    const watchlist = await this.load();

    watchlist.items = watchlist.items.filter(
      (item) => !(item.market === market && item.code === code),
    );

    await this.save(watchlist);
    return watchlist;
  }

  /**
   * 更新自选股排序
   *
   * @param items 排序数组，每项包含 market、code、sortOrder
   * @returns 更新后的 Watchlist
   */
  async reorder(items: Array<{ market: number; code: string; sortOrder: number }>): Promise<Watchlist> {
    const watchlist = await this.load();

    // 构建排序映射：key = "market:code"，value = sortOrder
    const orderMap = new Map<string, number>();
    for (const item of items) {
      orderMap.set(`${item.market}:${item.code}`, item.sortOrder);
    }

    // 更新匹配到的条目的 sortOrder
    for (const existing of watchlist.items) {
      const key = `${existing.market}:${existing.code}`;
      const newOrder = orderMap.get(key);
      if (newOrder !== undefined) {
        existing.sortOrder = newOrder;
      }
    }

    // 按 sortOrder 排序
    watchlist.items.sort((a, b) => a.sortOrder - b.sortOrder);

    await this.save(watchlist);
    return watchlist;
  }
}

// ============================================================
// 导出单例
// ============================================================

/** 全局 StockWatchlistService 单例 */
export const stockWatchlistService = new StockWatchlistService();
