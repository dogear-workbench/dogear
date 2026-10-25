import { z } from 'zod';
import { pythonBridge } from '../../services/stock/python-bridge.js';
import { defineTool, type ToolDef } from '../pi/tool-adapter.js';
import { safe, formatYuan, isErrorResult } from './stock-format.js';

/** 板块与资金域：行业板块 + 资金流向 + 北向持股 */
export function createCapitalFlowToolDefs(): ToolDef[] {
  return [
    // ========================================
    // 工具: 列出行业板块
    // ========================================
    defineTool(
      'dogear__ListIndustries',
      '列出行业板块分类',
      '列出证监会行业分类（CSRC 一级/二级行业），用来查询"科技"、"消费"这类宽概念对应哪些细分分类名。\n' +
      '返回的每个 name 字段带分类代码前缀（如"J66货币金融服务"、"C27医药制造业"），可直接作为 dogear__ScreenStocks 的 industry 参数（精确等值匹配）。\n' +
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
          output += '\n\n以上分类名可直接作为 dogear__ScreenStocks 的 industry 参数（精确等值匹配）。';

          return { content: [{ type: 'text' as const, text: output }] };
        } catch (error) {
          return isErrorResult(`列出行业板块失败: ${error}`);
        }
      }
    ),

    // ========================================
    // 工具: 行业对比
    // ========================================
    defineTool(
      'dogear__CompareIndustry',
      '个股与行业对比',
      '将个股与同行业其他股票对比，显示行业均值/中位数/排名。\n' +
      '数据源: baostock 行业快照（证监会行业分类），与 dogear__ScreenStocks 同口径。\n' +
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
          return isErrorResult(`行业对比失败: ${error}`);
        }
      }
    ),

    // ========================================
    // 工具: 资金流向
    // ========================================
    defineTool(
      'dogear__GetFundFlow',
      '查询资金流向',
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
          return isErrorResult(`获取资金流向失败: ${error}`);
        }
      }
    ),

    // ========================================
    // 工具: 北向资金持股
    // ========================================
    defineTool(
      'dogear__GetNorthboundHolding',
      '查询北向资金持股',
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
          return isErrorResult(`获取北向资金持股失败: ${error}`);
        }
      }
    ),
  ];
}
