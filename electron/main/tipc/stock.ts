// electron/main/tipc/stock.ts
import { tipc } from '@egoist/tipc/main';
import { stockService, stockWatchlistService, stockDataService, pythonBridge, formulaService } from '../services/stock/index.js';

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

  /** 获取单股实时行情（同时自动采集每日快照） */
  'stock:getQuote': t.procedure
    .input<{ market: number; code: string }>()
    .action(async ({ input }) => {
      try {
        const quote = await stockService.getQuote(input.market, input.code);

        // 自动采集每日快照（fire-and-forget，不阻塞返回）
        if (quote && quote.tradeDate) {
          stockDataService.appendDailySnapshot(input.market, input.code, {
            date: quote.tradeDate,
            outerVolume: quote.outerVolume,
            innerVolume: quote.innerVolume,
            limitUp: quote.limitUp,
            limitDown: quote.limitDown,
            orderDiff: quote.orderDiff,
            avgPrice: quote.avgPrice,
            high52w: quote.high52w,
            low52w: quote.low52w,
            floatShares: quote.floatShares,
            totalShares: quote.totalShares,
            price: quote.price,
            volume: quote.volume,
            turnover: quote.turnover,
            changePercent: quote.changePercent,
            peRatio: quote.peRatio,
            pbRatio: quote.pbRatio,
            totalMarketCap: quote.totalMarketCap,
            floatMarketCap: quote.floatMarketCap,
            turnoverRate: quote.turnoverRate,
            timestamp: quote.timestamp,
          }).catch((err) => console.warn('[stock:getQuote] 快照采集失败:', err));
        }

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

  // === 每日快照 ===

  /** 获取历史每日快照 */
  'stock:getDailySnapshots': t.procedure
    .input<{ market: number; code: string; limit?: number }>()
    .action(async ({ input }) => {
      try {
        const snapshots = await stockDataService.readDailySnapshots(
          input.market, input.code, input.limit,
        );
        return { data: snapshots };
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

  // === 技术指标计算（Python Bridge） ===

  /** 计算技术指标（供前端直接调用） */
  'stock:calcIndicators': t.procedure
    .input<{
      market: number;
      code: string;
      indicators: string[];
      params?: Record<string, Record<string, number>>;
      period?: 101 | 102 | 103;
      limit?: number;
    }>()
    .action(async ({ input }) => {
      try {
        const secid = `${input.market}.${input.code}`;
        const klineData = await stockService.getKLine({
          secid,
          period: input.period ?? 101,
          adjust: 1,
          limit: input.limit ?? 250,
        });

        if (klineData.length === 0) {
          return { error: '未获取到 K 线数据' };
        }

        const result = await pythonBridge.call('calc_indicators', {
          kline: klineData,
          indicators: input.indicators,
          params: input.params || {},
        }, 30_000);

        return { data: result };
      } catch (error) {
        return { error: String(error) };
      }
    }),

  /** 获取 Python Bridge 状态 */
  'stock:getPythonBridgeStatus': t.procedure.action(async () => {
    return { data: pythonBridge.getStatus() };
  }),

  // === 公式管理 ===

  /** 获取全部公式（含内置模板） */
  'stock:getFormulas': t.procedure.action(async () => {
    try {
      const formulas = await formulaService.getAll();
      return { data: formulas };
    } catch (error) {
      return { error: String(error) };
    }
  }),

  /** 添加自定义公式 */
  'stock:addFormula': t.procedure
    .input<{ name: string; type: 'screener' | 'signal' | 'score'; expression: string; description?: string }>()
    .action(async ({ input }) => {
      try {
        // 先验证语法
        const validateResult = await pythonBridge.call<{ valid: boolean; error?: string }>(
          'validate_formula',
          { expression: input.expression },
          10_000,
        );
        if (!validateResult.valid) {
          return { error: `公式语法错误: ${validateResult.error}` };
        }
        const formula = await formulaService.add(input.name, input.type, input.expression, input.description);
        return { data: formula };
      } catch (error) {
        return { error: String(error) };
      }
    }),

  /** 更新公式（不可修改内置公式） */
  'stock:updateFormula': t.procedure
    .input<{ id: string; name?: string; expression?: string; description?: string }>()
    .action(async ({ input }) => {
      try {
        const { id, ...patch } = input;
        if (patch.expression) {
          const validateResult = await pythonBridge.call<{ valid: boolean; error?: string }>(
            'validate_formula',
            { expression: patch.expression },
            10_000,
          );
          if (!validateResult.valid) {
            return { error: `公式语法错误: ${validateResult.error}` };
          }
        }
        const formula = await formulaService.update(id, patch);
        if (!formula) return { error: '公式不存在' };
        return { data: formula };
      } catch (error) {
        return { error: String(error) };
      }
    }),

  /** 删除公式（不可删除内置公式） */
  'stock:removeFormula': t.procedure
    .input<{ id: string }>()
    .action(async ({ input }) => {
      try {
        const ok = await formulaService.remove(input.id);
        return { data: ok };
      } catch (error) {
        return { error: String(error) };
      }
    }),

  /** 验证公式语法（不执行） */
  'stock:validateFormula': t.procedure
    .input<{ expression: string }>()
    .action(async ({ input }) => {
      try {
        const result = await pythonBridge.call<{ valid: boolean; error?: string }>(
          'validate_formula',
          { expression: input.expression },
          10_000,
        );
        return { data: result };
      } catch (error) {
        return { error: String(error) };
      }
    }),

  // === 回测 ===

  /** 运行简单策略回测 */
  'stock:runBacktest': t.procedure
    .input<{
      market: number;
      code: string;
      buyFormula: string;
      sellFormula: string;
      initialCapital?: number;
      commission?: number;
      limit?: number;
    }>()
    .action(async ({ input }) => {
      try {
        const secid = `${input.market}.${input.code}`;
        const klineData = await stockService.getKLine({
          secid,
          period: 101,
          adjust: 1,
          limit: input.limit ?? 500,
        });

        if (klineData.length < 60) {
          return { error: `K 线数据不足（仅 ${klineData.length} 条），至少需要 60 条` };
        }

        const result = await pythonBridge.call(
          'simple_backtest',
          {
            kline: klineData,
            buy_formula: input.buyFormula,
            sell_formula: input.sellFormula,
            initial_capital: input.initialCapital ?? 100_000,
            commission: input.commission ?? 0.001,
          },
          60_000,
        );
        return { data: result };
      } catch (error) {
        return { error: String(error) };
      }
    }),
};
