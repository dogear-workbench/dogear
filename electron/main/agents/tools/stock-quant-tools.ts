import { z } from 'zod';
import { pythonBridge, DataSourceExhaustedError } from '../../services/stock/python-bridge.js';
import { readFinancialsCache, writeFinancialsCache } from '../../services/stock/financials-cache-service.js';
import { defineTool, type ToolDef } from '../pi/tool-adapter.js';
import { safe, CALC_TIMEOUT_MS, DEFAULT_KLINE_LIMIT, MAX_KLINE_LIMIT, PERIOD_MAP, fetchKLine, isErrorResult } from './stock-format.js';

/** 备源降级 banner；_source 为空或本就是主源（eastmoney）时不显示 */
function formatSourceBanner(source: string | null | undefined): string {
  if (!source || source === 'eastmoney') return '';
  return `> ⚠️ 数据源：${source}（东财不可达）\n` +
    '> 备源字段可能不全（如 PE / 流通市值缺失），本次未按对应条件筛\n\n';
}

/** 量化分析域：选股筛选 + 基本面 + 公式求值 + 回测 */
export function createQuantToolDefs(): ToolDef[] {
  return [
    // ========================================
    // 工具: 全市场筛选
    // ========================================
    defineTool(
      'dogear__ScreenStocks',
      '条件筛选全市场股票',
      '全市场 A 股条件筛选。\n' +
      '支持基本面条件（行业、PE、PB、市值、价格）和技术指标条件（RSI、MACD 等）。\n' +
      '注意: 技术指标筛选需要逐股获取K线数据，候选超过100只时会自动截断。',
      z.object({
        conditions: z.object({
          industry: z.string().optional().describe('证监会行业分类名（带分类代码前缀，如"J66货币金融服务"、"C27医药制造业"），必须精确等值匹配；命名与东方财富板块名（"银行"、"食品饮料"）不同——不要直接传俗名，先调 dogear__ListIndustries 查真实值域'),
          price_min: z.number().optional().describe('最低价格'),
          price_max: z.number().optional().describe('最高价格'),
          pe_min: z.number().optional().describe('最低市盈率'),
          pe_max: z.number().optional().describe('最高市盈率'),
          pb_min: z.number().optional().describe('最低市净率'),
          pb_max: z.number().optional().describe('最高市净率'),
          market_cap_min: z.number().optional().describe('最低总市值（亿元）'),
          market_cap_max: z.number().optional().describe('最高总市值（亿元）'),
          change_percent_min: z.number().optional().describe('最低涨跌幅（%）'),
          change_percent_max: z.number().optional().describe('最高涨跌幅（%）'),
          turnover_rate_min: z.number().optional().describe('最低换手率（%）'),
          turnover_rate_max: z.number().optional().describe('最高换手率（%）'),
          exclude_negative_pe: z.boolean().optional().default(true).describe('是否排除亏损股（PE<0）'),
          technical: z.array(z.object({
            indicator: z.string().describe('指标名（RSI/MACD/KDJ/BOLL等）'),
            condition: z.enum(['above', 'below']).describe('条件（above=大于/below=小于）'),
            value: z.number().optional().describe('阈值'),
          })).optional().describe('技术指标条件'),
        }),
        limit: z.number().min(1).max(50).default(20).describe('最大返回条数'),
      }),
      async (args) => {
        try {
          const result = await pythonBridge.call<{
            total_scanned: number;
            total_matched: number;
            returned: number;
            stocks: Array<{
              code: string; name: string; market: number;
              price?: number; pe?: number; pb?: number;
              market_cap?: number; change_percent?: number;
              industry?: string; turnover_rate?: number;
              technical_data?: Record<string, number>;
            }>;
            _source?: string | null;
          }>('screen_stocks', {
            conditions: args.conditions,
            limit: args.limit,
          }, 600_000);
          // 首次调用会触发全 A 快照预拉（baostock 逐只，5-7 分钟），同天后续调用毫秒命中

          const banner = formatSourceBanner(result._source);

          if (result.stocks.length === 0) {
            return {
              content: [{
                type: 'text' as const,
                text: `${banner}筛选完成：扫描 ${result.total_scanned} 只股票，无匹配结果。\n请尝试放宽条件。`,
              }],
            };
          }

          const header = '代码 | 名称 | 价格 | 涨跌幅 | PE | PB | 市值(亿) | 行业';
          const separator = '---|---|---|---|---|---|---|---';
          const rows = result.stocks.map((s) =>
            `${s.code} | ${s.name} | ${safe(s.price)} | ${safe(s.change_percent)}% | ${safe(s.pe)} | ${safe(s.pb)} | ${safe(s.market_cap)} | ${s.industry || '-'}`
          );

          let output = banner;
          output += `筛选结果（扫描 ${result.total_scanned} 只，匹配 ${result.total_matched} 只，返回 ${result.returned} 只）：\n`;
          output += `${header}\n${separator}\n${rows.join('\n')}`;

          const withTech = result.stocks.filter(s => s.technical_data);
          if (withTech.length > 0) {
            const techLines = withTech.map(s => {
              const parts = Object.entries(s.technical_data!).map(([k, v]) => `${k}=${safe(v)}`);
              return `  ${s.name}: ${parts.join(', ')}`;
            });
            output += `\n\n技术指标数据：\n${techLines.join('\n')}`;
          }

          return {
            content: [{ type: 'text' as const, text: output }],
          };
        } catch (error) {
          if (error instanceof DataSourceExhaustedError) {
            return {
              isError: true,
              content: [{
                type: 'text' as const,
                text: '候选池数据当前不可用（东财+新浪都不通，通常几小时后恢复）。\n\n尝试记录:\n' +
                  error.attempts.map(([n, m]) => `- ${n}: ${m}`).join('\n'),
              }],
            };
          }
          return {
            content: [{ type: 'text' as const, text: `筛选失败: ${error}` }],
            isError: true,
          };
        }
      }
    ),

    // ========================================
    // 工具: 获取财报数据
    // ========================================
    defineTool(
      'dogear__GetFinancials',
      '获取个股财报数据',
      '获取个股财报数据（营收、净利润、ROE、毛利率、净利率、资产负债率、每股经营现金流等，' +
      '每项指标均附带 _yoy 同比%/_mom 环比%/_single_yoy 单季同比% 三个衍生字段）。\n' +
      '数据来源: 同花顺财报摘要新版接口（stock_financial_abstract_new_ths），失败时降级 baostock。',
      z.object({
        market: z.number().describe('市场代码（1=沪市 0=深市）'),
        code: z.string().describe('股票代码（如"600519"）'),
        periods: z.number().min(1).max(8).default(4).describe('返回最近几期报告（默认4期）'),
      }),
      async (args) => {
        try {
          const { hit, missingCount, stale } = await readFinancialsCache(args.market, args.code, args.periods);

          let periods: Array<Record<string, number | string | null>>;

          if (missingCount === 0 && !stale) {
            periods = hit.map((entry) => entry.data);
          } else {
            let fetched: Array<Record<string, number | string | null>> | null = null;
            let fetchError = '';

            try {
              const result = await pythonBridge.call<{
                symbol: string;
                periods: Array<Record<string, number | string | null>>;
                error?: string;
              }>('get_financials', {
                symbol: args.code,
                periods: args.periods,
              }, 30_000);

              if (result.error) fetchError = result.error;
              else fetched = result.periods;
            } catch (err) {
              fetchError = String(err);
            }

            if (fetched) {
              periods = fetched;
              await writeFinancialsCache(args.market, args.code, periods);
            } else if (missingCount === 0) {
              // 回源失败但条数够，用过期缓存兜底，好过什么都返回不了
              console.warn(`[dogear__GetFinancials] ${args.code} 回源失败，降级用缓存: ${fetchError}`);
              periods = hit.map((entry) => entry.data);
            } else {
              return {
                content: [{ type: 'text' as const, text: `获取财报失败: ${fetchError}` }],
                isError: true,
              };
            }
          }

          if (periods.length === 0) {
            return {
              content: [{ type: 'text' as const, text: `未找到 ${args.code} 的财报数据。` }],
            };
          }

          const fields: Array<{ key: string; label: string; format?: (v: number) => string }> = [
            { key: 'report_date', label: '报告期' },
            { key: 'revenue', label: '营收', format: (v) => v > 1e8 ? `${(v/1e8).toFixed(1)}亿` : `${(v/1e4).toFixed(0)}万` },
            { key: 'revenue_yoy', label: '营收同比', format: (v) => `${v.toFixed(1)}%` },
            { key: 'net_profit', label: '净利润', format: (v) => v > 1e8 ? `${(v/1e8).toFixed(1)}亿` : `${(v/1e4).toFixed(0)}万` },
            { key: 'net_profit_yoy', label: '净利润同比', format: (v) => `${v.toFixed(1)}%` },
            { key: 'roe', label: 'ROE', format: (v) => `${v.toFixed(1)}%` },
            { key: 'gross_margin', label: '毛利率', format: (v) => `${v.toFixed(1)}%` },
            { key: 'debt_ratio', label: '资产负债率', format: (v) => `${v.toFixed(1)}%` },
            { key: 'eps', label: '每股收益', format: (v) => v.toFixed(2) },
          ];

          let output = `=== ${args.code} 财务数据 ===\n`;

          for (const field of fields) {
            const values = periods.map(p => {
              const v = p[field.key];
              if (v === null || v === undefined) return '-';
              if (field.format && typeof v === 'number') return field.format(v);
              return String(v);
            });
            output += `${field.label}: ${values.join(' | ')}\n`;
          }

          return {
            content: [{ type: 'text' as const, text: output }],
          };
        } catch (error) {
          return isErrorResult(`获取财报失败: ${error}`);
        }
      }
    ),

    // ========================================
    // 工具: 执行公式表达式
    // ========================================
    defineTool(
      'dogear__EvalFormula',
      '执行公式表达式',
      '执行自定义公式表达式（类通达信 TDX 语法）。\n' +
      '支持变量: CLOSE, OPEN, HIGH, LOW, VOL, PE, PB, MARKET_CAP\n' +
      '支持函数: MA(CLOSE, N), EMA(CLOSE, N), RSI(N), MACD(fast, slow, signal), KDJ(n), BOLL(N, k), ATR(N), CROSS(A, B), MAX(HIGH, N), MIN(LOW, N)\n' +
      '支持逻辑运算符: AND, OR, NOT\n' +
      '支持比较运算符: >, <, >=, <=, ==, !=\n' +
      '示例: "RSI(14) < 30 AND PE < 20"，"CROSS(MACD.DIF, MACD.DEA)"',
      z.object({
        market: z.number().describe('市场代码（1=沪市 0=深市）'),
        code: z.string().describe('股票代码（如"600519"）'),
        expression: z.string().describe('公式表达式，如 "RSI(14) < 30 AND PE < 20"'),
        stock_data: z.record(z.string(), z.union([z.number(), z.string(), z.null()])).optional()
          .describe('可选的附加股票数据（PE/PB/MARKET_CAP 等），如已从行情接口获取可传入'),
        validate_only: z.boolean().default(false)
          .describe('仅验证语法（不执行），true 时不需要传 market/code'),
      }),
      async (args) => {
        try {
          // 仅验证语法模式
          if (args.validate_only) {
            const result = await pythonBridge.call<{ valid: boolean; error?: string }>(
              'validate_formula',
              { expression: args.expression },
              10_000,
            );
            if (result.valid) {
              return { content: [{ type: 'text' as const, text: `公式语法正确: ${args.expression}` }] };
            } else {
              return { content: [{ type: 'text' as const, text: `公式语法错误: ${result.error}` }], isError: true };
            }
          }

          // 获取 K 线数据
          const klineData = await fetchKLine(args.market, args.code, PERIOD_MAP.daily, DEFAULT_KLINE_LIMIT);

          if (klineData.length === 0) {
            return { content: [{ type: 'text' as const, text: '未获取到 K 线数据，无法执行公式。' }] };
          }

          const result = await pythonBridge.call<{ result: boolean | number | null; error?: string }>(
            'eval_formula',
            {
              expression: args.expression,
              kline: klineData,
              stock_data: args.stock_data ?? {},
              industry_data: {},
            },
            CALC_TIMEOUT_MS,
          );

          if (result.error) {
            return {
              content: [{ type: 'text' as const, text: `公式执行错误: ${result.error}\n表达式: ${args.expression}` }],
              isError: true,
            };
          }

          const val = result.result;
          let interpretation = '';
          if (typeof val === 'boolean') {
            interpretation = val ? '✓ 条件成立' : '✗ 条件不成立';
          } else if (typeof val === 'number') {
            interpretation = `= ${val.toFixed(4)}`;
          } else {
            interpretation = '= null（数据不足或计算失败）';
          }

          const lastDate = klineData[klineData.length - 1].date;
          return {
            content: [{
              type: 'text' as const,
              text: `公式: ${args.expression}\n股票: ${args.code}（截至 ${lastDate}）\n结果: ${interpretation}`,
            }],
          };
        } catch (error) {
          return isErrorResult(`公式执行失败: ${error}`);
        }
      }
    ),

    // ========================================
    // 工具: 简单策略回测
    // ========================================
    defineTool(
      'dogear__SimpleBacktest',
      '策略回测',
      '基于公式表达式的简单策略回测。\n' +
      '在历史 K 线数据上模拟买卖操作，输出总收益率、年化收益率、最大回撤、夏普比率等绩效指标。\n' +
      '买卖公式使用类通达信（TDX）语法，支持技术指标函数（MA/EMA/RSI/MACD/KDJ/BOLL等）。\n' +
      '回测逻辑: 满足买入公式时全仓买入（收盘价），满足卖出公式时全仓卖出，单边手续费 0.1%。',
      z.object({
        market: z.number().describe('市场代码（1=沪市 0=深市）'),
        code: z.string().describe('股票代码（如"600519"）'),
        buy_formula: z.string().describe('买入公式，满足时买入，如 "CROSS(MACD.DIF, MACD.DEA)"'),
        sell_formula: z.string().describe('卖出公式，满足时卖出，如 "RSI(14) > 70"'),
        initial_capital: z.number().min(1000).max(10_000_000).default(100_000)
          .describe('初始资金（元，默认10万）'),
        commission: z.number().min(0).max(0.05).default(0.001)
          .describe('单边手续费率（默认0.001=0.1%）'),
        limit: z.number().min(60).max(MAX_KLINE_LIMIT).default(MAX_KLINE_LIMIT)
          .describe('K线数据条数（默认最大，数据越多回测越可靠）'),
      }),
      async (args) => {
        try {
          const klineData = await fetchKLine(args.market, args.code, PERIOD_MAP.daily, args.limit);

          if (klineData.length < 60) {
            return {
              content: [{
                type: 'text' as const,
                text: `K 线数据不足（仅 ${klineData.length} 条），回测需要至少 60 条数据。`,
              }],
            };
          }

          const result = await pythonBridge.call<{
            total_return: number;
            annual_return: number;
            max_drawdown: number;
            sharpe_ratio: number;
            trade_count: number;
            win_rate: number;
            final_capital: number;
            initial_capital: number;
            equity_curve: Array<{ date: string; value: number }>;
            trades: Array<{
              date: string;
              action: string;
              price: number;
              shares: number;
              profit?: number;
              capital: number;
            }>;
            buy_hold_return: number;
            error: string | null;
          }>(
            'simple_backtest',
            {
              kline: klineData,
              buy_formula: args.buy_formula,
              sell_formula: args.sell_formula,
              initial_capital: args.initial_capital,
              commission: args.commission,
            },
            60_000,
          );

          if (result.error) {
            return {
              content: [{ type: 'text' as const, text: `回测失败: ${result.error}` }],
              isError: true,
            };
          }

          const pct = (v: number) => `${(v * 100).toFixed(2)}%`;
          const period = `${klineData[0].date} ~ ${klineData[klineData.length - 1].date}`;

          // 展示最近几笔交易
          const recentTrades = result.trades.slice(-8).map((t) => {
            if (t.action === 'buy') {
              return `  [${t.date}] 买入 ${t.shares}股 @ ${t.price}`;
            } else {
              return `  [${t.date}] 卖出 ${t.shares}股 @ ${t.price}（收益 ${pct(t.profit ?? 0)}）`;
            }
          });

          let output = `=== ${args.code} 策略回测结果 ===\n`;
          output += `回测区间: ${period}（${klineData.length} 交易日）\n`;
          output += `买入条件: ${args.buy_formula}\n`;
          output += `卖出条件: ${args.sell_formula}\n\n`;
          output += `【绩效指标】\n`;
          output += `  总收益率: ${pct(result.total_return)}  |  年化收益率: ${pct(result.annual_return)}\n`;
          output += `  最大回撤: ${pct(result.max_drawdown)}  |  夏普比率: ${result.sharpe_ratio.toFixed(3)}\n`;
          output += `  交易次数: ${result.trade_count} 次  |  胜率: ${pct(result.win_rate)}\n`;
          output += `  初始资金: ¥${result.initial_capital.toLocaleString()}  →  最终资金: ¥${result.final_capital.toLocaleString()}\n\n`;
          output += `【与买入持有对比】\n`;
          output += `  策略收益: ${pct(result.total_return)}  vs  买入持有: ${pct(result.buy_hold_return)}\n`;
          output += `  超额收益: ${pct(result.total_return - result.buy_hold_return)}\n\n`;

          if (result.trades.length > 0) {
            output += `【最近交易记录（最多8条）】\n${recentTrades.join('\n')}\n`;
            if (result.trades.length > 8) {
              output += `  ...共 ${result.trades.length} 条交易记录\n`;
            }
          } else {
            output += '【交易记录】\n  回测期间无交易触发，请检查公式是否正确。\n';
          }

          return {
            content: [{ type: 'text' as const, text: output }],
          };
        } catch (error) {
          return isErrorResult(`回测失败: ${error}`);
        }
      }
    ),

  ];
}
