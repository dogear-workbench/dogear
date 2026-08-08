/**
 * 股票行情 MCP Server 工具
 *
 * 提供 6 个工具，允许 Agent 查询股票行情、K线、分时数据，以及管理自选股列表。
 * 所有网络请求都经过 RateLimiter 防护（令牌桶 + 滑动窗口 + 断路器 + 请求合并 + 缓存），
 * 无需在工具层额外限流。
 *
 * 工具清单：
 *   - SearchStock       — 搜索股票（模糊匹配名称/拼音/代码）
 *   - GetStockQuote     — 实时行情（单只或批量，最多 10 只）
 *   - GetKLineData      — K线历史（日/周/月K，可指定条数）
 *   - GetTimeline       — 当日分时数据
 *   - GetWatchlist      — 获取自选股列表
 *   - ModifyWatchlist   — 添加/删除自选股（写操作，需用户权限确认）
 */

import { z } from 'zod';
import { stockService } from '../../services/stock/stock-service.js';
import { stockWatchlistService } from '../../services/stock/stock-watchlist-service.js';
import { registerToolGroup } from './tool-registry.js';
import { defineTool, type ToolDef } from '../pi/tool-adapter.js';

import { stockDataService } from '../../services/stock/stock-data-service.js';

// ============================================================
// 常量
// ============================================================

/** 批量行情查询上限 */
const MAX_BATCH_QUOTES = 10;
/** K线数据默认条数 */
const DEFAULT_KLINE_LIMIT = 120;
/** K线数据最大条数 */
const MAX_KLINE_LIMIT = 500;

// ============================================================
// 辅助函数
// ============================================================

/** 安全数字格式化（防止 undefined.toFixed 崩溃） */
function safe(val: number | undefined | null, digits = 2): string {
  if (val == null || isNaN(val)) return '-';
  return val.toFixed(digits);
}

/** 格式化成交额（元 → 万/亿） */
function formatTurnover(val: number): string {
  if (val >= 1e8) return `${(val / 1e8).toFixed(2)}亿`;
  if (val >= 1e4) return `${(val / 1e4).toFixed(2)}万`;
  return `${val.toFixed(2)}`;
}

/** 格式化成交量（手） */
function formatVolume(val: number): string {
  if (val >= 1e4) return `${(val / 1e4).toFixed(2)}万手`;
  return `${val}手`;
}

/** 周期参数映射 */
function periodToKlt(period: string): 101 | 102 | 103 {
  switch (period) {
    case 'weekly': return 102;
    case 'monthly': return 103;
    default: return 101; // daily
  }
}

// ============================================================
// 工具创建函数
// ============================================================

/**
 * 创建股票行情工具中立定义（ToolDef[]）
 * @returns ToolDef 数组
 */
export function createStockToolDefs(): ToolDef[] {
  return [
    // ========================================
    // 工具 1: 搜索股票
    // ========================================
    defineTool(
      'SearchStock',
      '搜索 A 股股票',
      '搜索 A 股股票（支持名称、拼音首字母、股票代码模糊匹配）。\n' +
      '返回匹配的股票列表（最多 10 条），包含代码、名称、市场信息。',
      z.object({
        keyword: z.string().describe('搜索关键词（如"茅台"、"moutai"、"600519"）'),
      }),
      async (args) => {
        try {
          const results = await stockService.search(args.keyword);

          if (results.length === 0) {
            return {
              content: [{ type: 'text' as const, text: `未找到与"${args.keyword}"相关的股票。` }],
            };
          }

          const list = results.map((r, i) =>
            `${i + 1}. ${r.name}（${r.code}）\n` +
            `   市场: ${r.market === 1 ? '沪市' : '深市'} | 代码: ${r.code} | market: ${r.market}`
          ).join('\n');

          return {
            content: [{
              type: 'text' as const,
              text: `搜索"${args.keyword}"结果（${results.length} 条）：\n\n${list}`,
            }],
          };
        } catch (error) {
          return {
            content: [{ type: 'text' as const, text: `搜索失败: ${error}` }],
            isError: true,
          };
        }
      }
    ),

    // ========================================
    // 工具 2: 获取实时行情
    // ========================================
    defineTool(
      'GetStockQuote',
      '获取实时行情',
      '获取股票实时行情数据（支持批量查询，最多 10 只）。\n' +
      '返回当前价格、涨跌幅、成交量、成交额、最高最低价、换手率等详细数据。',
      z.object({
        stocks: z.array(
          z.object({
            market: z.number().describe('市场代码（1=沪市 0=深市）'),
            code: z.string().describe('股票代码（如"600519"）'),
          })
        ).min(1).max(MAX_BATCH_QUOTES).describe('要查询的股票列表'),
      }),
      async (args) => {
        try {
          const quotes = await stockService.batchQuotes(args.stocks);

          if (quotes.length === 0) {
            return {
              content: [{ type: 'text' as const, text: '未获取到行情数据，请检查股票代码是否正确。' }],
            };
          }

          const parts = quotes.map((q) => {
            const direction = q.changePercent >= 0 ? '↑' : '↓';
            return [
              `【${q.name}】${q.code}（${q.market === 1 ? '沪' : '深'}）`,
              `  当前价: ${safe(q.price)} | 涨跌: ${direction}${safe(q.changePercent)}%（${safe(q.changeAmount)}）`,
              `  今开: ${safe(q.open)} | 最高: ${safe(q.high)} | 最低: ${safe(q.low)} | 昨收: ${safe(q.prevClose)}`,
              `  成交量: ${formatVolume(q.volume)} | 成交额: ${formatTurnover(q.turnover)}`,
              `  换手率: ${safe(q.turnoverRate)}% | 振幅: ${safe(q.amplitude)}% | 量比: ${safe(q.volumeRatio)}`,
              `  市盈率: ${safe(q.peRatio)} | 市净率: ${safe(q.pbRatio)}`,
              `  涨停: ${safe(q.limitUp)} | 跌停: ${safe(q.limitDown)}`,
              `  交易日: ${q.tradeDate}`,
            ].join('\n');
          });

          return {
            content: [{
              type: 'text' as const,
              text: `实时行情（${quotes.length} 只）：\n\n${parts.join('\n\n')}`,
            }],
          };
        } catch (error) {
          return {
            content: [{ type: 'text' as const, text: `获取行情失败: ${error}` }],
            isError: true,
          };
        }
      }
    ),

    // ========================================
    // 工具 3: 获取 K 线历史数据
    // ========================================
    defineTool(
      'GetKLineData',
      '获取 K 线历史数据',
      '获取股票 K 线历史数据。\n' +
      '支持日K、周K、月K，返回开高低收、成交量、涨跌幅、换手率等字段。\n' +
      '数据会缓存到本地 JSONL 文件，重复查询直接读取本地数据，非常快。',
      z.object({
        market: z.number().describe('市场代码（1=沪市 0=深市）'),
        code: z.string().describe('股票代码（如"600519"）'),
        period: z.enum(['daily', 'weekly', 'monthly']).default('daily').describe('K线周期（默认 daily）'),
        limit: z.number().min(1).max(MAX_KLINE_LIMIT).default(DEFAULT_KLINE_LIMIT).describe('数据条数（默认120，最多500）'),
      }),
      async (args) => {
        try {
          const klt = periodToKlt(args.period);
          const secid = `${args.market}.${args.code}`;

          // 从 API 获取 K 线数据
          const klineData = await stockService.getKLine({
            secid,
            period: klt,
            adjust: 1, // 前复权
            limit: args.limit,
          });

          if (klineData.length === 0) {
            return {
              content: [{ type: 'text' as const, text: '未获取到 K 线数据，请检查股票代码是否正确。' }],
            };
          }

          // 日K数据增量存储到本地
          if (klt === 101) {
            const appended = await stockDataService.appendKLine(args.market, args.code, klineData);
            if (appended > 0) {
              console.log(`[stock-tools] K线增量写入 ${appended} 条: ${secid}`);
            }
          }

          // 格式化输出：表头 + 数据行
          const periodLabel = args.period === 'weekly' ? '周K' : args.period === 'monthly' ? '月K' : '日K';
          const header = '日期 | 开盘 | 收盘 | 最高 | 最低 | 涨跌幅 | 成交量 | 换手率';
          const separator = '---|---|---|---|---|---|---|---';
          const rows = klineData.map((k) =>
            `${k.date} | ${safe(k.open)} | ${safe(k.close)} | ${safe(k.high)} | ${safe(k.low)} | ${safe(k.changePercent)}% | ${formatVolume(k.volume)} | ${safe(k.turnoverRate)}%`
          );

          // 数据量大时只展示最近和统计摘要
          let output: string;
          if (klineData.length > 30) {
            // 统计摘要
            const closes = klineData.map((k) => k.close);
            const maxPrice = Math.max(...closes);
            const minPrice = Math.min(...closes);
            const latestClose = closes[closes.length - 1];
            const firstClose = closes[0];
            const totalChange = firstClose > 0
              ? ((latestClose - firstClose) / firstClose * 100).toFixed(2)
              : '-';

            const summary = [
              `统计摘要（共 ${klineData.length} 条${periodLabel}数据）：`,
              `  期间: ${klineData[0].date} ~ ${klineData[klineData.length - 1].date}`,
              `  最高价: ${safe(maxPrice)} | 最低价: ${safe(minPrice)}`,
              `  起始收盘: ${safe(firstClose)} | 最新收盘: ${safe(latestClose)}`,
              `  期间涨跌幅: ${totalChange}%`,
            ].join('\n');

            // 最近 10 条明细
            const recentRows = rows.slice(-10);
            output = `${summary}\n\n最近 10 条${periodLabel}数据：\n${header}\n${separator}\n${recentRows.join('\n')}`;
          } else {
            output = `${periodLabel}数据（${klineData.length} 条）：\n${header}\n${separator}\n${rows.join('\n')}`;
          }

          return {
            content: [{ type: 'text' as const, text: output }],
          };
        } catch (error) {
          return {
            content: [{ type: 'text' as const, text: `获取 K 线数据失败: ${error}` }],
            isError: true,
          };
        }
      }
    ),

    // ========================================
    // 工具 4: 获取当日分时数据
    // ========================================
    defineTool(
      'GetTimeline',
      '获取当日分时数据',
      '获取股票当日分时数据（逐分钟价格、均价、成交量）。',
      z.object({
        market: z.number().describe('市场代码（1=沪市 0=深市）'),
        code: z.string().describe('股票代码（如"600519"）'),
      }),
      async (args) => {
        try {
          const timeline = await stockService.getTimeline(args.market, args.code);

          if (timeline.length === 0) {
            return {
              content: [{ type: 'text' as const, text: '未获取到分时数据（可能非交易时段或代码有误）。' }],
            };
          }

          // 提取关键数据点（不全部输出，太多了）
          const total = timeline.length;
          const first = timeline[0];
          const last = timeline[total - 1];
          const maxPoint = timeline.reduce((a, b) => a.price > b.price ? a : b);
          const minPoint = timeline.reduce((a, b) => a.price < b.price ? a : b);

          // 摘要
          const summary = [
            `当日分时数据（共 ${total} 个数据点）：`,
            `  开盘: ${safe(first.price)}（${first.time}）`,
            `  最新: ${safe(last.price)}（${last.time}）| 涨跌: ${safe(last.changePercent)}%`,
            `  最高: ${safe(maxPoint.price)}（${maxPoint.time}）`,
            `  最低: ${safe(minPoint.price)}（${minPoint.time}）`,
            `  均价: ${safe(last.avgPrice)}`,
          ].join('\n');

          // 每隔 30 分钟采样一条明细
          const sampled = timeline.filter((_, i) => i % 30 === 0 || i === total - 1);
          const header = '时间 | 价格 | 均价 | 涨跌幅 | 成交量';
          const separator = '---|---|---|---|---';
          const rows = sampled.map((p) =>
            `${p.time} | ${safe(p.price)} | ${safe(p.avgPrice)} | ${safe(p.changePercent)}% | ${p.volume}`
          );

          return {
            content: [{
              type: 'text' as const,
              text: `${summary}\n\n采样明细（每30分钟）：\n${header}\n${separator}\n${rows.join('\n')}`,
            }],
          };
        } catch (error) {
          return {
            content: [{ type: 'text' as const, text: `获取分时数据失败: ${error}` }],
            isError: true,
          };
        }
      }
    ),

    // ========================================
    // 工具 5: 获取自选股列表
    // ========================================
    defineTool(
      'GetWatchlist',
      '查看自选股列表',
      '获取用户的自选股列表。\n' +
      '返回所有已添加的自选股信息（代码、名称、市场、添加时间）。',
      z.object({}),
      async () => {
        try {
          const watchlist = await stockWatchlistService.load();

          if (watchlist.items.length === 0) {
            return {
              content: [{ type: 'text' as const, text: '自选股列表为空。可以使用 ModifyWatchlist 工具添加股票。' }],
            };
          }

          const list = watchlist.items.map((item, i) =>
            `${i + 1}. ${item.name}（${item.code}）\n` +
            `   市场: ${item.market === 1 ? '沪市' : '深市'} | market: ${item.market} | code: ${item.code}\n` +
            `   添加时间: ${new Date(item.addedAt).toLocaleString('zh-CN')}` +
            (item.tags?.length ? `\n   标签: ${item.tags.join(', ')}` : '')
          ).join('\n\n');

          return {
            content: [{
              type: 'text' as const,
              text: `自选股列表（${watchlist.items.length} 只）：\n\n${list}`,
            }],
          };
        } catch (error) {
          return {
            content: [{ type: 'text' as const, text: `获取自选股列表失败: ${error}` }],
            isError: true,
          };
        }
      }
    ),

    // ========================================
    // 工具 6: 修改自选股（需权限确认）
    // ========================================
    defineTool(
      'ModifyWatchlist',
      '添加或删除自选股',
      '添加或删除自选股。\n' +
      '添加时需提供 name（股票名称），可通过 SearchStock 工具获取。',
      z.object({
        action: z.enum(['add', 'remove']).describe('操作类型（add=添加 remove=删除）'),
        market: z.number().describe('市场代码（1=沪市 0=深市）'),
        code: z.string().describe('股票代码（如"600519"）'),
        name: z.string().optional().describe('股票名称（添加时必填，删除时可选）'),
      }),
      async (args) => {
        try {
          if (args.action === 'add') {
            if (!args.name) {
              return {
                content: [{ type: 'text' as const, text: '添加自选股时必须提供股票名称（name）。请先使用 SearchStock 搜索获取。' }],
                isError: true,
              };
            }

            const watchlist = await stockWatchlistService.addItem({
              market: args.market,
              code: args.code,
              name: args.name,
            });

            // 检查是否已存在（addItem 去重）
            const existed = watchlist.items.length === (await stockWatchlistService.load()).items.length;
            if (existed) {
              return {
                content: [{
                  type: 'text' as const,
                  text: `${args.name}（${args.code}）已在自选股列表中，无需重复添加。`,
                }],
              };
            }

            return {
              content: [{
                type: 'text' as const,
                text: `已将 ${args.name}（${args.code}）添加到自选股列表。当前共 ${watchlist.items.length} 只自选股。`,
              }],
            };
          } else {
            // 删除
            const before = await stockWatchlistService.load();
            const watchlist = await stockWatchlistService.removeItem(args.market, args.code);

            if (before.items.length === watchlist.items.length) {
              return {
                content: [{
                  type: 'text' as const,
                  text: `未找到 ${args.code} 在自选股列表中，可能已被删除。`,
                }],
              };
            }

            const removedName = args.name || before.items.find(
              (i) => i.market === args.market && i.code === args.code
            )?.name || args.code;

            return {
              content: [{
                type: 'text' as const,
                text: `已将 ${removedName}（${args.code}）从自选股列表中删除。当前剩余 ${watchlist.items.length} 只。`,
              }],
            };
          }
        } catch (error) {
          return {
            content: [{ type: 'text' as const, text: `修改自选股失败: ${error}` }],
            isError: true,
          };
        }
      }
    ),
  ];
}

registerToolGroup({
  server: 'dogear-stock',
  label: '股票行情',
  create: createStockToolDefs,
});
