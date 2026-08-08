/**
 * 股票分析 MCP Server 工具
 *
 * 依赖 Python Bridge 进行计算，与基础股票工具（dogear-stock）分离。
 * Python 不可用时不影响基础行情查询功能。
 *
 * Phase 1 工具清单：
 *   - CalcIndicators — 计算技术指标（MACD/KDJ/RSI/BOLL/MA 等）
 *
 * 后续 Phase 追加：
 *   - ScreenStocks / GetFinancials / CompareIndustry / DetectSignals / EvalFormula / SimpleBacktest
 */

import { z } from 'zod';
import { stockService } from '../../services/stock/stock-service.js';
import { stockDataService } from '../../services/stock/stock-data-service.js';
import { pythonBridge, DataSourceExhaustedError } from '../../services/stock/python-bridge.js';
import { readFinancialsCache, writeFinancialsCache } from '../../services/stock/financials-cache-service.js';
import { registerToolGroup } from './tool-registry.js';
import { defineTool, type ToolDef } from '../pi/tool-adapter.js';


// ============================================================
// 常量
// ============================================================

/** 指标计算超时 */
const CALC_TIMEOUT_MS = 30_000;
/** 支持的指标列表 */
const AVAILABLE_INDICATORS = ['MA', 'EMA', 'MACD', 'KDJ', 'RSI', 'BOLL', 'WR', 'OBV', 'ATR', 'VWAP'] as const;
/** K线数据默认条数（指标计算需要足够数据） */
const DEFAULT_KLINE_LIMIT = 250;
/** K线最大条数 */
const MAX_KLINE_LIMIT = 500;

// ============================================================
// 辅助函数
// ============================================================

/** 安全数字格式化 */
function safe(val: number | undefined | null, digits = 2): string {
  if (val == null || isNaN(val)) return '-';
  return val.toFixed(digits);
}

/** 金额格式化：亿/万，用于资金流向净额（元）展示 */
function formatYuan(val: number | undefined | null): string {
  if (val == null || isNaN(val)) return '-';
  const abs = Math.abs(val);
  if (abs >= 1e8) return `${(val / 1e8).toFixed(2)}亿`;
  if (abs >= 1e4) return `${(val / 1e4).toFixed(1)}万`;
  return val.toFixed(0);
}

/** 备源降级 banner；_source 为空或本就是主源（eastmoney）时不显示 */
function formatSourceBanner(source: string | null | undefined): string {
  if (!source || source === 'eastmoney') return '';
  return `> ⚠️ 数据源：${source}（东财不可达）\n` +
    '> 备源字段可能不全（如 PE / 流通市值缺失），本次未按对应条件筛\n\n';
}

/** 获取数组最后一个非 null 值 */
function lastValue(arr: (number | null)[]): number | null {
  for (let i = arr.length - 1; i >= 0; i--) {
    if (arr[i] !== null && arr[i] !== undefined) return arr[i];
  }
  return null;
}

/** 格式化单个指标结果为可读文本 */
function formatIndicatorResult(name: string, data: Record<string, (number | null)[]>): string {
  switch (name) {
    case 'MACD': {
      const dif = lastValue(data.DIF);
      const dea = lastValue(data.DEA);
      const macd = lastValue(data.MACD);
      const trend = dif !== null && dea !== null
        ? (dif > dea ? 'DIF 在 DEA 上方（多头）' : 'DIF 在 DEA 下方（空头）')
        : '';
      const zeroAxis = dif !== null
        ? (dif > 0 ? '，DIF 在零轴上方' : '，DIF 在零轴下方')
        : '';
      return `MACD(12,26,9): DIF=${safe(dif, 4)}, DEA=${safe(dea, 4)}, 柱=${safe(macd, 4)} | ${trend}${zeroAxis}`;
    }
    case 'KDJ': {
      const k = lastValue(data.K);
      const d = lastValue(data.D);
      const j = lastValue(data.J);
      let zone = '';
      if (k !== null) {
        if (k > 80) zone = '超买区(>80)';
        else if (k < 20) zone = '超卖区(<20)';
        else zone = '中性区间';
      }
      return `KDJ(9,3,3): K=${safe(k)}, D=${safe(d)}, J=${safe(j)} | ${zone}`;
    }
    case 'RSI': {
      const rsi = lastValue(data.RSI);
      let zone = '';
      if (rsi !== null) {
        if (rsi > 70) zone = '超买区(>70)';
        else if (rsi < 30) zone = '超卖区(<30)';
        else if (rsi >= 40 && rsi <= 60) zone = '中性区间(40-60)';
        else if (rsi > 60) zone = '偏强(60-70)';
        else zone = '偏弱(30-40)';
      }
      return `RSI(14): ${safe(rsi)} | ${zone}`;
    }
    case 'BOLL': {
      const upper = lastValue(data.UPPER);
      const mid = lastValue(data.MID);
      const lower = lastValue(data.LOWER);
      return `BOLL(20,2): 上轨=${safe(upper, 2)}, 中轨=${safe(mid, 2)}, 下轨=${safe(lower, 2)}`;
    }
    case 'MA': {
      const parts: string[] = [];
      for (const key of Object.keys(data).sort()) {
        const val = lastValue(data[key]);
        parts.push(`${key}=${safe(val, 2)}`);
      }
      return `均线: ${parts.join(', ')}`;
    }
    case 'EMA': {
      const parts: string[] = [];
      for (const key of Object.keys(data).sort()) {
        const val = lastValue(data[key]);
        parts.push(`${key}=${safe(val, 2)}`);
      }
      return `指数均线: ${parts.join(', ')}`;
    }
    case 'WR': {
      const wr = lastValue(data.WR);
      let zone = '';
      if (wr !== null) {
        if (wr > -20) zone = '超买区(>-20)';
        else if (wr < -80) zone = '超卖区(<-80)';
        else zone = '中性区间';
      }
      return `WR(14): ${safe(wr)} | ${zone}`;
    }
    case 'OBV': {
      const obv = lastValue(data.OBV);
      return `OBV: ${obv !== null ? obv.toLocaleString() : '-'}`;
    }
    case 'ATR': {
      const atr = lastValue(data.ATR);
      return `ATR(14): ${safe(atr, 4)}`;
    }
    case 'VWAP': {
      const vwap = lastValue(data.VWAP);
      return `VWAP: ${safe(vwap, 2)}`;
    }
    default:
      return `${name}: ${JSON.stringify(data)}`;
  }
}

// ============================================================
// 工具创建函数
// ============================================================

export function createStockAnalysisToolDefs(): ToolDef[] {
  return [
    // ========================================
    // 工具: 计算技术指标
    // ========================================
    defineTool(
      'CalcIndicators',
      '计算股票技术指标。返回精确的指标数值，用于技术分析。\n' +
      '支持指标: MA(均线), EMA(指数均线), MACD, KDJ, RSI, BOLL(布林带), WR(威廉), OBV(能量潮), ATR(真实波幅), VWAP\n' +
      '数据来源: 从已有 K 线数据获取，由 Python 计算引擎精确计算。',
      z.object({
        market: z.number().describe('市场代码（1=沪市 0=深市）'),
        code: z.string().describe('股票代码（如"600519"）'),
        indicators: z.array(
          z.enum(AVAILABLE_INDICATORS)
        ).min(1).describe('要计算的指标列表'),
        params: z.record(z.string(), z.record(z.string(), z.union([z.number(), z.array(z.number())]))).optional()
          .describe('可选参数覆盖，如 {"RSI": {"period": 6}, "BOLL": {"width": 3}, "MA": {"N": [5,10,20,60]}}'),
        period: z.enum(['daily', 'weekly', 'monthly']).default('daily')
          .describe('K线周期（默认日K）'),
        limit: z.number().min(30).max(MAX_KLINE_LIMIT).default(DEFAULT_KLINE_LIMIT)
          .describe('K线数据条数（默认250，指标需要足够数据才准确）'),
      }),
      async (args) => {
        try {
          // 1. 获取 K 线数据（复用现有 stockService，享受缓存+限流+备用源）
          const periodMap: Record<string, 101 | 102 | 103> = {
            daily: 101, weekly: 102, monthly: 103,
          };
          const secid = `${args.market}.${args.code}`;
          const klineData = await stockService.getKLine({
            secid,
            period: periodMap[args.period],
            adjust: 1, // 前复权
            limit: args.limit,
          });

          if (klineData.length === 0) {
            return {
              content: [{ type: 'text' as const, text: '未获取到 K 线数据，无法计算指标。请检查股票代码。' }],
            };
          }

          if (klineData.length < 30) {
            return {
              content: [{
                type: 'text' as const,
                text: `K 线数据不足（仅 ${klineData.length} 条），部分指标可能不准确。建议至少需要 60 条以上数据。`,
              }],
            };
          }

          // 日K增量存储到本地
          if (periodMap[args.period] === 101) {
            stockDataService.appendKLine(args.market, args.code, klineData)
              .catch((err: unknown) => console.warn('[CalcIndicators] K线存储失败:', err));
          }

          // 2. 调用 Python 计算
          const result = await pythonBridge.call<Record<string, Record<string, (number | null)[]>>>(
            'calc_indicators',
            {
              kline: klineData,
              indicators: args.indicators,
              params: args.params || {},
            },
            CALC_TIMEOUT_MS,
          );

          // 3. 格式化输出
          const periodLabel = args.period === 'weekly' ? '周K' : args.period === 'monthly' ? '月K' : '日K';
          const lastDate = klineData[klineData.length - 1].date;
          const lastClose = klineData[klineData.length - 1].close;

          const header = `=== ${args.code} 技术指标（${periodLabel}，截至 ${lastDate}，收盘 ${safe(lastClose)}） ===`;
          const lines = args.indicators.map((name) => {
            const data = result[name.toUpperCase()];
            if (!data) return `${name}: 计算失败`;
            return formatIndicatorResult(name.toUpperCase(), data);
          });

          return {
            content: [{
              type: 'text' as const,
              text: `${header}\n${lines.join('\n')}`,
            }],
          };
        } catch (error) {
          const errMsg = error instanceof Error ? error.message : String(error);

          // Python 不可用时给出友好提示
          if (errMsg.includes('Python 3 未找到') || errMsg.includes('断路器')) {
            return {
              content: [{
                type: 'text' as const,
                text: `技术指标计算不可用: ${errMsg}\n\n` +
                  '需要安装 Python 3 和依赖:\n' +
                  '1. 安装 Python 3.10+: https://www.python.org/downloads/\n' +
                  '2. 安装依赖: pip install pandas numpy',
              }],
              isError: true,
            };
          }

          return {
            content: [{ type: 'text' as const, text: `计算技术指标失败: ${errMsg}` }],
            isError: true,
          };
        }
      }
    ),

    // ========================================
    // 工具: 全市场筛选
    // ========================================
    defineTool(
      'ScreenStocks',
      '全市场 A 股条件筛选。\n' +
      '支持基本面条件（行业、PE、PB、市值、价格）和技术指标条件（RSI、MACD 等）。\n' +
      '注意: 技术指标筛选需要逐股获取K线数据，候选超过100只时会自动截断。',
      z.object({
        conditions: z.object({
          industry: z.string().optional().describe('证监会行业分类名（带分类代码前缀，如"J66货币金融服务"、"C27医药制造业"），必须精确等值匹配；命名与东方财富板块名（"银行"、"食品饮料"）不同——不要直接传俗名，先调 ListIndustries 查真实值域'),
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
      'GetFinancials',
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
              console.warn(`[GetFinancials] ${args.code} 回源失败，降级用缓存: ${fetchError}`);
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
          return {
            content: [{ type: 'text' as const, text: `获取财报失败: ${error}` }],
            isError: true,
          };
        }
      }
    ),

    // ========================================
    // 工具: 检测技术信号
    // ========================================
    defineTool(
      'DetectSignals',
      '检测股票近期技术信号。\n' +
      '内置信号: MACD金叉/死叉, KDJ金叉/超买/超卖, RSI超买/超卖, 布林上轨突破/下轨跌破, 成交量突破, 均线多头排列。\n' +
      '返回: 触发的信号列表（含信号名称、触发日期、指标数值）。',
      z.object({
        market: z.number().describe('市场代码（1=沪市 0=深市）'),
        code: z.string().describe('股票代码（如"600519"）'),
        signals: z.array(z.string()).optional()
          .describe('要检测的信号 ID 列表（不传则检测全部），可选值: macd_golden_cross, macd_death_cross, kdj_golden_cross, kdj_oversold, kdj_overbought, rsi_oversold, rsi_overbought, boll_upper_break, boll_lower_break, volume_breakout, ma_bullish_arrangement'),
        lookback: z.number().min(1).max(30).default(5)
          .describe('回看天数（默认5天）'),
        period: z.enum(['daily', 'weekly', 'monthly']).default('daily')
          .describe('K线周期（默认日K）'),
      }),
      async (args) => {
        try {
          const periodMap: Record<string, 101 | 102 | 103> = {
            daily: 101, weekly: 102, monthly: 103,
          };
          const secid = `${args.market}.${args.code}`;
          const klineData = await stockService.getKLine({
            secid,
            period: periodMap[args.period],
            adjust: 1,
            limit: Math.max(DEFAULT_KLINE_LIMIT, (args.lookback ?? 5) + 70),
          });

          if (klineData.length === 0) {
            return { content: [{ type: 'text' as const, text: '未获取到 K 线数据，无法检测信号。请检查股票代码。' }] };
          }

          const result = await pythonBridge.call<{
            detected: Array<{
              signal_id: string;
              name: string;
              description: string;
              date: string;
              details: string;
            }>;
            lookback_days: number;
            signals_checked: number;
            summary: string;
          }>(
            'detect_signals',
            {
              kline: klineData,
              signals: args.signals ?? null,
              lookback: args.lookback ?? 5,
            },
            CALC_TIMEOUT_MS,
          );

          if (result.detected.length === 0) {
            return {
              content: [{ type: 'text' as const, text: `${args.code} 近${result.lookback_days}日（共检测 ${result.signals_checked} 种信号）：无信号触发。` }],
            };
          }

          const lines = result.detected.map(
            (s) => `• [${s.date}] ${s.name}: ${s.details}（${s.description}）`
          );
          return {
            content: [{
              type: 'text' as const,
              text: `${args.code} ${result.summary}（共检测 ${result.signals_checked} 种信号）：\n${lines.join('\n')}`,
            }],
          };
        } catch (error) {
          return {
            content: [{ type: 'text' as const, text: `信号检测失败: ${error}` }],
            isError: true,
          };
        }
      }
    ),

    // ========================================
    // 工具: 执行公式表达式
    // ========================================
    defineTool(
      'EvalFormula',
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
          const periodMap: Record<string, 101 | 102 | 103> = { daily: 101, weekly: 102, monthly: 103 };
          const secid = `${args.market}.${args.code}`;
          const klineData = await stockService.getKLine({
            secid,
            period: 101,
            adjust: 1,
            limit: DEFAULT_KLINE_LIMIT,
          });

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
          return {
            content: [{ type: 'text' as const, text: `公式执行失败: ${error}` }],
            isError: true,
          };
        }
      }
    ),

    // ========================================
    // 工具: 简单策略回测
    // ========================================
    defineTool(
      'SimpleBacktest',
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
          const secid = `${args.market}.${args.code}`;
          const klineData = await stockService.getKLine({
            secid,
            period: 101,
            adjust: 1,
            limit: args.limit,
          });

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
          return {
            content: [{ type: 'text' as const, text: `回测失败: ${error}` }],
            isError: true,
          };
        }
      }
    ),

    // ========================================
    // 工具: 列出行业板块
    // ========================================
    defineTool(
      'ListIndustries',
      '列出证监会行业分类（CSRC 一级/二级行业），用来查询"科技"、"消费"这类宽概念对应哪些细分分类名。\n' +
      '返回的每个 name 字段带分类代码前缀（如"J66货币金融服务"、"C27医药制造业"），可直接作为 ScreenStocks 的 industry 参数（精确等值匹配）。\n' +
      '⚠️ 命名与东方财富板块名不同：银行股在"J66货币金融服务"下（混少量非银金融），不叫"银行"；医药股在"C27医药制造业"下，不叫"医药"。\n' +
      '参数：\n' +
      '- keyword：可选，板块名子串过滤（大小写不敏感）。不传则返回全部（受 limit 截断）。\n' +
      '- limit：返回条数上限，默认 60，最多 200。带 keyword 时通常十几条就够，不带时可能有 90+ 板块，建议配合 keyword 使用。\n' +
      '返回字段：只有 name（分类名）。板块涨跌统计需另用专门工具（当前未提供）。',
      z.object({
        keyword: z.string().optional().describe('板块名子串过滤，如"半导体"、"电子"、"银行"；不传则返回全部'),
        limit: z.number().min(1).max(200).default(60).describe('返回条数上限，默认 60'),
      }),
      async (args) => {
        try {
          const result = await pythonBridge.call<{
            total: number;
            returned: number;
            truncated: boolean;
            industries: Array<{ name: string }>;
          }>(
            'list_industries',
            { keyword: args.keyword ?? '', limit: args.limit },
            30_000,
          );

          if (result.industries.length === 0) {
            const hint = args.keyword
              ? `无匹配"${args.keyword}"的板块。尝试更短的关键词或不带 keyword 列出全部。`
              : '未获取到行业板块列表。';
            return { content: [{ type: 'text' as const, text: hint }] };
          }

          const title = args.keyword
            ? `匹配"${args.keyword}"的 CSRC 行业分类（共 ${result.total} 个，返回 ${result.returned}）`
            : `CSRC 行业分类（共 ${result.total} 个，返回 ${result.returned}）`;

          const list = result.industries.map((it) => `- ${it.name}`).join('\n');
          let output = `${title}：\n${list}`;
          if (result.truncated) {
            output += `\n\n(已按 limit=${args.limit} 截断，如需更多请调大 limit 或增加 keyword)`;
          }
          output += '\n\n以上分类名可直接作为 ScreenStocks 的 industry 参数（精确等值匹配）。';

          return { content: [{ type: 'text' as const, text: output }] };
        } catch (error) {
          return {
            content: [{ type: 'text' as const, text: `列出行业板块失败: ${error}` }],
            isError: true,
          };
        }
      }
    ),

    // ========================================
    // 工具: 行业对比
    // ========================================
    defineTool(
      'CompareIndustry',
      '将个股与同行业其他股票对比，显示行业均值/中位数/排名。\n' +
      '数据源: baostock 行业快照（证监会行业分类），与 ScreenStocks 同口径。\n' +
      'PE/PB 统计自动剔除负值（亏损股）。\n' +
      'rank 为升序位次（1 = 行业内最低），total 为参与统计的有效样本数。',
      z.object({
        market: z.number().describe('市场代码（1=沪市 0=深市）'),
        code: z.string().describe('股票代码'),
        metrics: z.array(z.string()).optional().default(['pe', 'pb', 'turnover_rate'])
          .describe('对比指标，可选: pe/pb/turnover_rate/change_percent。市值类指标（market_cap/float_market_cap）因快照无股本数据不可用'),
      }),
      async (args) => {
        try {
          const result = await pythonBridge.call<{
            symbol: string;
            name: string;
            industry: string;
            industry_count: number;
            metrics: Record<string, {
              value: number | null;
              industry_avg: number;
              industry_median: number;
              rank: number;
              total: number;
              error?: string;
            }>;
            error?: string;
          }>('compare_industry', {
            symbol: args.code,
            metrics: args.metrics,
          }, 60_000);

          if (result.error) {
            return {
              content: [{ type: 'text' as const, text: `行业对比失败: ${result.error}` }],
              isError: true,
            };
          }

          let output = `=== ${result.name}(${result.symbol}) vs ${result.industry}（共 ${result.industry_count} 只） ===\n\n`;
          output += `指标 | 本股 | 行业均值 | 行业中位数 | 排名(升序)\n`;
          output += `---|---|---|---|---\n`;

          const metricLabels: Record<string, string> = {
            pe: 'PE(TTM)', pb: 'PB(MRQ)',
            turnover_rate: '换手率(%)', change_percent: '涨跌幅(%)',
          };

          for (const [key, data] of Object.entries(result.metrics)) {
            if (data.error) {
              output += `${metricLabels[key] || key} | - | - | - | ${data.error}\n`;
              continue;
            }
            const scaleStr = data.rank > 0 ? `${data.rank}/${data.total}` : `本股无有效值(样本${data.total})`;
            output += `${metricLabels[key] || key} | ${safe(data.value)} | ${safe(data.industry_avg)} | ${safe(data.industry_median)} | ${scaleStr}\n`;
          }

          return {
            content: [{ type: 'text' as const, text: output }],
          };
        } catch (error) {
          return {
            content: [{ type: 'text' as const, text: `行业对比失败: ${error}` }],
            isError: true,
          };
        }
      }
    ),

    // ========================================
    // 工具: 资金流向
    // ========================================
    defineTool(
      'GetFundFlow',
      '查询资金流向数据（东方财富数据源）。一个工具聚合三种用途：\n' +
      '- type=individual: 个股资金流向，近 100 个交易日，需 stock+market\n' +
      '- type=market: 大盘（沪深两市整体）资金流向，近 100 个交易日\n' +
      '- type=sector: 板块资金流向排名（行业/概念/地域），需 indicator+sector_type\n' +
      '字段单位：净额（元）、净占比（%）。主力=超大单+大单净流入，散户=中单+小单净流入。',
      z.object({
        type: z.enum(['individual', 'market', 'sector']).describe('查询类型：individual=个股 / market=大盘 / sector=板块排名'),
        stock: z.string().optional().describe('股票代码（如"600519"），type=individual 时必填'),
        market: z.enum(['sh', 'sz', 'bj']).optional().describe('市场（sh=沪 sz=深 bj=北交所），type=individual 时必填'),
        indicator: z.enum(['今日', '5日', '10日']).optional().describe('板块资金流统计口径，type=sector 时必填'),
        sector_type: z.enum(['行业资金流', '概念资金流', '地域资金流']).optional().describe('板块类型，type=sector 时必填'),
      }),
      async (args) => {
        try {
          if (args.type === 'individual') {
            if (!args.stock || !args.market) {
              return {
                content: [{ type: 'text' as const, text: 'type=individual 时必须提供 stock 和 market 参数' }],
                isError: true,
              };
            }

            const result = await pythonBridge.call<{
              stock: string;
              market: string;
              count: number;
              data: Array<Record<string, number | string | null>>;
              error?: string;
            }>('get_individual_fund_flow', { stock: args.stock, market: args.market }, 30_000);

            if (result.error) {
              return { content: [{ type: 'text' as const, text: `获取个股资金流向失败: ${result.error}` }], isError: true };
            }
            if (result.data.length === 0) {
              return { content: [{ type: 'text' as const, text: `未找到 ${args.market}${args.stock} 的资金流向数据。` }] };
            }

            const recent = result.data.slice(-10);
            const mainSum = result.data.reduce((s, d) => s + (Number(d.main_net_inflow) || 0), 0);
            const retailSum = result.data.reduce((s, d) => s + (Number(d.medium_net_inflow) || 0) + (Number(d.small_net_inflow) || 0), 0);

            let output = `=== ${args.stock} 个股资金流向（近 ${result.count} 个交易日，${args.market}） ===\n`;
            output += `期间主力净流入累计: ${formatYuan(mainSum)}  |  散户净流入累计: ${formatYuan(retailSum)}\n\n`;
            output += `日期 | 收盘价 | 涨跌幅 | 主力净流入 | 主力净占比 | 散户净流入\n---|---|---|---|---|---\n`;
            output += recent.map((d) => {
              const retail = (Number(d.medium_net_inflow) || 0) + (Number(d.small_net_inflow) || 0);
              return `${d.date} | ${safe(Number(d.close))} | ${safe(Number(d.change_percent))}% | ${formatYuan(Number(d.main_net_inflow))} | ${safe(Number(d.main_net_pct))}% | ${formatYuan(retail)}`;
            }).join('\n');
            output += `\n\n（仅展示最近 10 日，完整区间共 ${result.count} 个交易日）`;

            return { content: [{ type: 'text' as const, text: output }] };
          }

          if (args.type === 'market') {
            const result = await pythonBridge.call<{
              count: number;
              data: Array<Record<string, number | string | null>>;
              error?: string;
            }>('get_market_fund_flow', {}, 30_000);

            if (result.error) {
              return { content: [{ type: 'text' as const, text: `获取大盘资金流向失败: ${result.error}` }], isError: true };
            }
            if (result.data.length === 0) {
              return { content: [{ type: 'text' as const, text: '未获取到大盘资金流向数据。' }] };
            }

            const recent = result.data.slice(-10);
            const mainSum = result.data.reduce((s, d) => s + (Number(d.main_net_inflow) || 0), 0);

            let output = `=== 大盘资金流向（沪深两市整体，近 ${result.count} 个交易日） ===\n`;
            output += `期间主力净流入累计: ${formatYuan(mainSum)}\n\n`;
            output += `日期 | 上证收盘 | 上证涨跌幅 | 深证收盘 | 深证涨跌幅 | 主力净流入 | 主力净占比\n---|---|---|---|---|---|---\n`;
            output += recent.map((d) =>
              `${d.date} | ${safe(Number(d.sh_close))} | ${safe(Number(d.sh_change_percent))}% | ${safe(Number(d.sz_close))} | ${safe(Number(d.sz_change_percent))}% | ${formatYuan(Number(d.main_net_inflow))} | ${safe(Number(d.main_net_pct))}%`
            ).join('\n');
            output += `\n\n（仅展示最近 10 日，完整区间共 ${result.count} 个交易日）`;

            return { content: [{ type: 'text' as const, text: output }] };
          }

          // type === 'sector'
          if (!args.indicator || !args.sector_type) {
            return {
              content: [{ type: 'text' as const, text: 'type=sector 时必须提供 indicator 和 sector_type 参数' }],
              isError: true,
            };
          }

          const result = await pythonBridge.call<{
            indicator: string;
            sector_type: string;
            total: number;
            returned: number;
            data: Array<Record<string, number | string | null>>;
            error?: string;
          }>('get_sector_fund_flow_rank', { indicator: args.indicator, sector_type: args.sector_type }, 30_000);

          if (result.error) {
            return { content: [{ type: 'text' as const, text: `获取板块资金流排名失败: ${result.error}` }], isError: true };
          }
          if (result.data.length === 0) {
            return { content: [{ type: 'text' as const, text: `未获取到${args.sector_type}的${args.indicator}资金流排名。` }] };
          }

          let output = `=== ${args.sector_type} 资金流排名（${args.indicator}，共 ${result.total} 个板块，返回 ${result.returned}） ===\n`;
          output += `排名 | 板块 | 涨跌幅 | 主力净流入 | 主力净占比 | 主力净流入最大股\n---|---|---|---|---|---\n`;
          output += result.data.map((d) =>
            `${d.rank} | ${d.name} | ${safe(Number(d.change_percent))}% | ${formatYuan(Number(d.main_net_inflow))} | ${safe(Number(d.main_net_pct))}% | ${d.main_net_inflow_top_stock ?? '-'}`
          ).join('\n');

          return { content: [{ type: 'text' as const, text: output }] };
        } catch (error) {
          return {
            content: [{ type: 'text' as const, text: `获取资金流向失败: ${error}` }],
            isError: true,
          };
        }
      }
    ),

    // ========================================
    // 工具: 北向资金持股
    // ========================================
    defineTool(
      'GetNorthboundHolding',
      '查询北向资金持股数据（东方财富数据源）。一个工具聚合两种用途：\n' +
      '- type=individual: 个股北向持股历史，需 stock（裸代码，如"600519"）\n' +
      '- type=summary: 沪深港通资金流向汇总历史，需 fund_type\n' +
      '数据来源: 东方财富沪深港通持股统计接口。\n' +
      '单位：持股数量（股）、持股市值/净买额/资金流入（元，summary 的净买额/买卖额单位为亿元、' +
      '历史累计净买额单位为万亿元，字段名已标注）、持股占比/涨跌幅（%）。\n' +
      '限制：A 股只关注北向（沪股通+深股通），南向/港股通是港股方向数据；' +
      '交易所自 2024-08-19 起不再披露沪深港通每日资金流明细，summary 的 net_buy_amount/' +
      'buy_amount/sell_amount/daily_fund_inflow/daily_balance 此后恒为空值（预期行为非故障）。',
      z.object({
        type: z.enum(['individual', 'summary']).describe('查询类型：individual=个股北向持股 / summary=北向资金汇总'),
        stock: z.string().optional().describe('股票代码，type=individual 时必填'),
        fund_type: z.enum(['北向资金', '沪股通', '深股通', '南向资金', '港股通沪', '港股通深']).optional()
          .describe('资金类型，type=summary 时必填'),
        days: z.number().min(1).max(250).default(30).describe('返回最近多少个交易日，默认 30'),
      }),
      async (args) => {
        try {
          if (args.type === 'individual') {
            if (!args.stock) {
              return {
                content: [{ type: 'text' as const, text: 'type=individual 时必须提供 stock 参数' }],
                isError: true,
              };
            }

            const result = await pythonBridge.call<{
              symbol: string;
              count: number;
              data: Array<Record<string, number | string | null>>;
              error?: string;
            }>('get_hsgt_individual', { symbol: args.stock, days: args.days }, 30_000);

            if (result.error) {
              return { content: [{ type: 'text' as const, text: `获取北向个股持股失败: ${result.error}` }], isError: true };
            }
            if (result.data.length === 0) {
              return { content: [{ type: 'text' as const, text: `未找到 ${args.stock} 的北向持股数据。` }] };
            }

            const rows = [...result.data].reverse();
            let output = `=== ${args.stock} 北向持股历史（最近 ${result.count} 个交易日） ===\n`;
            output += `日期 | 收盘价 | 涨跌幅 | 持股数量 | 持股市值 | 占A股% | 今日增持股数 | 今日增持资金\n---|---|---|---|---|---|---|---\n`;
            output += rows.map((d) =>
              `${d.date} | ${safe(Number(d.close))} | ${safe(Number(d.change_percent))}% | ${d.hold_shares ?? '-'} | ${formatYuan(Number(d.hold_market_cap))} | ${safe(Number(d.hold_pct_a_share))}% | ${d.net_shares_change ?? '-'} | ${formatYuan(Number(d.net_cap_change))}`
            ).join('\n');

            return { content: [{ type: 'text' as const, text: output }] };
          }

          // type === 'summary'
          if (!args.fund_type) {
            return {
              content: [{ type: 'text' as const, text: 'type=summary 时必须提供 fund_type 参数' }],
              isError: true,
            };
          }

          const result = await pythonBridge.call<{
            fund_type: string;
            count: number;
            data: Array<Record<string, number | string | null>>;
            error?: string;
          }>('get_hsgt_hist', { fund_type: args.fund_type, days: args.days }, 30_000);

          if (result.error) {
            return { content: [{ type: 'text' as const, text: `获取北向资金汇总失败: ${result.error}` }], isError: true };
          }
          if (result.data.length === 0) {
            return { content: [{ type: 'text' as const, text: `未找到${args.fund_type}的历史数据。` }] };
          }

          const rows = [...result.data].reverse();
          let output = `=== ${args.fund_type} 历史（最近 ${result.count} 个交易日） ===\n`;
          output += `日期 | 净买额(亿) | 买入额(亿) | 卖出额(亿) | 累计净买额(万亿) | 持股市值 | 领涨股\n---|---|---|---|---|---|---\n`;
          output += rows.map((d) => {
            const leading = d.leading_stock ? `${d.leading_stock}(${safe(Number(d.leading_stock_change_percent))}%)` : '-';
            return `${d.date} | ${safe(Number(d.net_buy_amount))} | ${safe(Number(d.buy_amount))} | ${safe(Number(d.sell_amount))} | ${safe(Number(d.cumulative_net_buy_amount), 4)} | ${formatYuan(Number(d.hold_market_cap))} | ${leading}`;
          }).join('\n');
          output += '\n\n（交易所自 2024-08-19 起不再披露每日资金流明细，净买额/买入额/卖出额此后为空属预期行为）';

          return { content: [{ type: 'text' as const, text: output }] };
        } catch (error) {
          return {
            content: [{ type: 'text' as const, text: `获取北向资金持股失败: ${error}` }],
            isError: true,
          };
        }
      }
    ),
  ];
}

registerToolGroup({
  server: 'dogear-stock-analysis',
  label: '股票分析',
  create: createStockAnalysisToolDefs,
});
