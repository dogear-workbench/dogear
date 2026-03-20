// electron/main/tipc/stock.ts
import { tipc } from '@egoist/tipc/main';
import { stockService, stockWatchlistService, stockDataService } from '../services/stock/index.js';

const t = tipc.create();

export const stockRouter = {
  // === 自选股管理 ===

  /** 获取自选股列表 */
  'stock:getWatchlist': t.procedure.action(async () => {
    try {
      const watchlist = await stockWatchlistService.load();
      return { data: watchlist };
    } catch (error) {
      return { error: String(error) };
    }
  }),

  /** 添加自选股 */
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

  /** 删除自选股 */
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

  /** 更新自选股排序 */
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

  /** 批量获取实时行情 */
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

  /** 获取单股实时行情 */
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

  /** 获取 K 线数据，日 K 线(period=101)会自动保存到本地 JSONL */
  'stock:getKLine': t.procedure
    .input<{ market: number; code: string; period: number; adjust: number; limit?: number }>()
    .action(async ({ input }) => {
      try {
        const { market, code, period, adjust, limit } = input;
        const klineData = await stockService.getKLine({
          secid: `${market}.${code}`,
          period: period as 1 | 5 | 15 | 30 | 60 | 101 | 102 | 103,
          adjust: adjust as 0 | 1 | 2,
          limit: limit ?? 120,
        });

        // 日 K 线（period=101）增量保存到本地 JSONL
        if (period === 101 && klineData.length > 0) {
          await stockDataService.appendKLine(market, code, klineData);
        }

        return { data: klineData };
      } catch (error) {
        return { error: String(error) };
      }
    }),

  /** 获取当日分时数据 */
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

  /** 获取资金流向数据 */
  'stock:getMoneyFlow': t.procedure
    .input<{ market: number; code: string }>()
    .action(async ({ input }) => {
      try {
        const moneyFlow = await stockService.getMoneyFlow(input.market, input.code);
        return { data: moneyFlow };
      } catch (error) {
        return { error: String(error) };
      }
    }),

  // === 搜索 ===

  /** 搜索股票（模糊匹配代码或名称） */
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

  /** 获取 RateLimiter 当前状态 */
  'stock:getRateLimiterStatus': t.procedure.action(async () => {
    return { data: stockService.getStatus() };
  }),
};
