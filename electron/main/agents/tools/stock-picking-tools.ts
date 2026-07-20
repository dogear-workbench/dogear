/**
 * 选股预热 MCP Server 工具
 *
 * 提供 1 个工具：
 *   - PreheatCandidatePool — 硬筛候选池 + 财报/信号/公告标题全池预热，一次调用产出完整候选池数据
 *
 * 后续 Step 4 会在本文件追加 RankCandidates（综合评分排序）。
 */

import { createSdkMcpServer, tool } from '@anthropic-ai/claude-agent-sdk';
import { z } from 'zod';
import { preheatCandidatePool } from '../../services/stock/preheat-service.js';
import type { PreheatResult } from '../../services/stock/preheat-service.js';
import { registerTools } from './tool-registry.js';

// 注册工具元数据到 registry
registerTools([
  {
    name: 'PreheatCandidatePool',
    description: '硬筛候选池 + 财报/信号/公告标题全池预热，一次调用产出完整候选池数据',
    server: 'dogear-stock-picking',
    category: 'stock',
  },
]);

// ============================================================
// 辅助函数
// ============================================================

function safe(val: number | null | undefined, digits = 2): string {
  if (val === null || val === undefined || Number.isNaN(val)) return '-';
  return val.toFixed(digits);
}

function formatPreheatOutput(result: PreheatResult): string {
  const { candidates, status, elapsedMs } = result;
  const elapsedSec = (elapsedMs / 1000).toFixed(1);

  if (candidates.length === 0) {
    return `## 候选池预热结果\n\n硬筛后候选池为空，请放宽筛选条件（行业/价格/PE/市值）。\n\n**耗时**：${elapsedSec}s`;
  }

  let output = '## 候选池预热结果\n\n';
  output += `**硬筛后**：${status.total} 只 | ` +
    `**财报命中**：${status.financialsHit}/${status.total}（另拉取 ${status.financialsFetched}） | ` +
    `**信号成功**：${status.signalsSuccess}/${status.total} | ` +
    `**公告成功**：${status.announcementsSuccess}/${status.total} | ` +
    `**耗时**：${elapsedSec}s\n\n`;

  output += '| 代码 | 名称 | 现价 | 涨跌 | PE | PB | ROE | 净利同比(年) | 净利同比(最近期) | 信号数 | 公告数 |\n';
  output += '|---|---|---|---|---|---|---|---|---|---|---|\n';
  for (const c of candidates) {
    output += `| ${c.code} | ${c.name} | ${safe(c.price)} | ${safe(c.changePercent)}% | ${safe(c.pe)} | ${safe(c.pb)} | ` +
      `${safe(c.roe)}% | ${safe(c.netProfitYoY)}% | ${safe(c.netProfitYoYQuarter)}% | ${c.signals.length} | ${c.announcements.length} |\n`;
  }

  const withFailures = candidates.filter((c) => c.failures.length > 0);
  if (withFailures.length > 0) {
    output += '\n### 数据缺口\n\n';
    for (const c of withFailures) {
      output += `- ${c.code}（${c.name}）：${c.failures.join(', ')} 维度拉取失败\n`;
    }
  }

  output += '\n### 结构化数据（供 RankCandidates）\n\n';
  output += '```json\n';
  output += JSON.stringify({ candidates }, null, 2);
  output += '\n```\n';

  return output;
}

// ============================================================
// 工具创建函数
// ============================================================

export function createStockPickingTools() {
  return createSdkMcpServer({
    name: 'dogear-stock-picking',
    version: '1.0.0',
    tools: [
      // ========================================
      // 工具: 候选池硬筛 + 全池预热
      // ========================================
      tool(
        'PreheatCandidatePool',
        '一次调用完成"硬筛候选池 + 全池数据预热"：先按行业/价格/PE/市值等条件全市场硬筛，' +
        '合并多个行业的结果并去重、按 PE 升序排序后截断到 limit，再并发预热每只候选的财报（ROE/净利同比）、' +
        '技术信号（近期 MACD 金叉/KDJ 超卖等）、公告标题三类数据。\n' +
        '使用场景: 选股类需求的第一步，替代"先 ScreenStocks 再逐只调 GetFinancials/DetectSignals/ListAnnouncements"的低效循环。\n' +
        '返回: markdown 表格（可读展示）+ 一个 JSON 代码块（候选池结构化数据，供后续 RankCandidates 直接使用）。\n' +
        '注意: 预热预算约 40 秒，limit 越大耗时越长；单只单维度失败不会中断整池，会体现在返回结果的"数据缺口"里。',
        {
          industries: z.array(z.string()).min(1)
            .describe('CSRC 行业分类名列表（带分类代码前缀，如"C39计算机、通信和其他电子设备制造业"），不确定名称先调 ListIndustries 查询真实值域；传多个行业会分别硬筛后合并去重'),
          price_min: z.number().optional().describe('最低价格'),
          price_max: z.number().optional().describe('最高价格'),
          pe_min: z.number().optional().describe('最低市盈率'),
          pe_max: z.number().optional().describe('最高市盈率'),
          market_cap_min: z.number().optional().describe('最低总市值（亿元）；当前数据源无股本数据，该条件多数情况下不生效'),
          market_cap_max: z.number().optional().describe('最高总市值（亿元）；当前数据源无股本数据，该条件多数情况下不生效'),
          exclude_negative_pe: z.boolean().default(true).describe('是否排除亏损股（PE<0），默认排除'),
          exclude_st: z.boolean().default(true).describe('是否排除 ST/*ST 股票，默认排除'),
          limit: z.number().min(1).max(100).default(50).describe('候选池上限，默认 50，最大 100'),
          signal_lookback: z.number().min(1).max(30).default(7).describe('信号检测回看天数，默认 7'),
          announcement_since: z.string().optional().describe('公告起始日期 YYYY-MM-DD，不传默认近 30 天'),
        },
        async (args) => {
          try {
            const result = await preheatCandidatePool(
              {
                industries: args.industries,
                priceMin: args.price_min,
                priceMax: args.price_max,
                peMin: args.pe_min,
                peMax: args.pe_max,
                marketCapMin: args.market_cap_min,
                marketCapMax: args.market_cap_max,
                excludeNegativePe: args.exclude_negative_pe,
                excludeSt: args.exclude_st,
              },
              {
                limit: args.limit,
                wantSignalLookback: args.signal_lookback,
                wantAnnouncementSince: args.announcement_since,
              },
            );

            return {
              content: [{ type: 'text' as const, text: formatPreheatOutput(result) }],
            };
          } catch (error) {
            return {
              content: [{
                type: 'text' as const,
                text: `候选池预热失败: ${error instanceof Error ? error.message : String(error)}`,
              }],
              isError: true,
            };
          }
        }
      ),
    ],
  });
}
