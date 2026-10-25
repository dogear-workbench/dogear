import { z } from 'zod';
import { stockDataService } from '../../services/stock/stock-data-service.js';
import { pythonBridge } from '../../services/stock/python-bridge.js';
import { defineTool, type ToolDef } from '../pi/tool-adapter.js';
import { safe, formatIndicatorResult, CALC_TIMEOUT_MS, DEFAULT_KLINE_LIMIT, MAX_KLINE_LIMIT, PERIOD_MAP, fetchKLine, isErrorResult } from './stock-format.js';

/** 支持的指标列表 */
const AVAILABLE_INDICATORS = ['MA', 'EMA', 'MACD', 'KDJ', 'RSI', 'BOLL', 'WR', 'OBV', 'ATR', 'VWAP'] as const;

/** 技术指标与信号域：指标计算 + 信号检测（均由 Python 引擎计算） */
export function createIndicatorToolDefs(): ToolDef[] {
  return [
    // ========================================
    // 工具: 计算技术指标
    // ========================================
    defineTool(
      'dogear__CalcIndicators',
      '计算技术指标',
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
          const klineData = await fetchKLine(args.market, args.code, PERIOD_MAP[args.period], args.limit);

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
          if (PERIOD_MAP[args.period] === 101) {
            stockDataService.appendKLine(args.market, args.code, klineData)
              .catch((err: unknown) => console.warn('[dogear__CalcIndicators] K线存储失败:', err));
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
    // 工具: 检测技术信号
    // ========================================
    defineTool(
      'dogear__DetectSignals',
      '检测技术信号',
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
          const klineData = await fetchKLine(
            args.market, args.code,
            PERIOD_MAP[args.period],
            Math.max(DEFAULT_KLINE_LIMIT, (args.lookback ?? 5) + 70),
          );

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
          return isErrorResult(`信号检测失败: ${error}`);
        }
      }
    ),

  ];
}
