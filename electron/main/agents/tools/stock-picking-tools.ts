import { z } from 'zod';
import { preheatLongTermPool } from '../../services/stock/long-term-preheat-service.js';
import type { LongTermPreheatResult, LongTermCandidateData } from '../../services/stock/long-term-preheat-service.js';
import { rankByLongTerm } from '../../services/stock/long-term-rank-service.js';
import type { RankByLongTermResult, LongTermWeights } from '../../services/stock/long-term-rank-service.js';
import { registerToolGroup } from './tool-registry.js';
import { defineTool, type ToolDef } from '../pi/tool-adapter.js';


// ============================================================
// 辅助函数
// ============================================================

function safeNum(val: number | null | undefined, digits = 1): string {
  if (val === null || val === undefined || Number.isNaN(val)) return '-';
  return val.toFixed(digits);
}

function formatLongTermOutput(result: Extract<LongTermPreheatResult, { ok: true }>): string {
  const { candidates, status, elapsedMs } = result;
  const elapsedSec = (elapsedMs / 1000).toFixed(1);

  const lines: string[] = [
    '## 长期候选池预热结果',
    '',
    `**硬筛后**：${status.total} 只 | **预检通过**：${status.afterPreflight} | **数据不足<3年**：${status.insufficientYears} | **周K失败**：${status.klineFailed} | **耗时**：${elapsedSec}s`,
    `**快照日**：${status.snapshotDate} | **完整5年财报**：${status.financialsFullYears} | **3-4年财报**：${status.financialsPartialYears}`,
  ];

  if (candidates.length === 0) {
    lines.push('', '候选池经过财报 + 周 K 过滤后为空，请放宽行业范围或检查数据可用性。');
    lines.push('', '### 结构化数据（供 RankByLongTerm）', '', '```json', JSON.stringify({ candidates: [] }, null, 2), '```');
    return lines.join('\n');
  }

  lines.push('');
  lines.push('| 代码 | 名称 | 行业 | 现价 | 年内位置 | ROE均值5y | 净利CAGR5y | 趋势状态 | 5年年报 |');
  lines.push('|---|---|---|---|---|---|---|---|---|');

  const hasDowngrade = candidates.some((c) => c.growthDowngrade);

  for (const c of candidates) {
    const cagrStr = c.netProfitCAGR5y !== null
      ? `${c.netProfitCAGR5y.toFixed(1)}%${c.growthDowngrade ? '^' : ''}`
      : '-';
    lines.push(
      `| ${c.code} | ${c.name} | ${c.industry} | ${safeNum(c.currentPrice)} | ${safeNum(c.yearPositionPct)}% | ${safeNum(c.roeMean5y)}% | ${cagrStr} | ${c.trendState} | ${c.reportYearsAvailable} |`,
    );
  }

  if (hasDowngrade) {
    lines.push('');
    lines.push('^ 净利数据不足 5 年 CAGR，已降级为 5 年净利同比均值');
  }

  // 数据缺口（来自 failuresByCategory）
  const failureCategories = Object.entries(status.failuresByCategory).filter(([, cnt]) => cnt > 0);
  if (failureCategories.length > 0 || status.insufficientYears > 0) {
    lines.push('');
    lines.push('### 数据缺口');
    if (status.insufficientYears > 0) {
      lines.push(`- 年报不足 3 年（已剔除）：${status.insufficientYears} 只`);
    }
    for (const [cat, cnt] of failureCategories) {
      lines.push(`- ${cat} 数据拉取失败（已剔除）：${cnt} 只`);
    }
  }

  lines.push('');
  lines.push('### 结构化数据（供 RankByLongTerm）');
  lines.push('');
  lines.push('```json');
  lines.push(JSON.stringify({ candidates }, null, 2));
  lines.push('```');

  return lines.join('\n');
}

// ============================================================
// 工具创建函数
// ============================================================

/**
 * 创建长期选股工具中立定义（ToolDef[]）
 * @returns ToolDef 数组
 */
export function createStockPickingToolDefs(): ToolDef[] {
  return [
    // ========================================
    // 工具: 长期候选池预热
    // ========================================
    defineTool(
      'PreheatLongTermPool',
      '5 年长期视角候选池预热。硬筛条件只吃行业 + 卫生条件（excludeNegativePe / excludeSt），' +
      '不看价格/PE/市值等短期估值条件。\n' +
      '执行链路：全市场行业硬筛 → 可获取性预检（1 期财报）→ 5 年年报（ROE均值/CAGR/稳定性）→ 周 K 趋势指标（MA26/MA52/年内位置）→ 完整性检查。\n' +
      'insufficientYears 是年报 <3 年的独立计数（与 failuresByCategory.financials 的技术失败分开统计）；两者都会从候选池剔除。\n' +
      '返回: markdown 展示表 + 结构化 JSON 代码块（candidates 数组，供 RankByLongTerm 直接使用）。\n' +
      '耗时预算: 单行业 limit=50 约 3-5 分钟；limit 上限 100 只；一次只传一个行业，多板块请分开多次调用（或派子会话并行），后续合并 candidates。',
      z.object({
        industries: z.array(z.string()).min(1)
          .describe('CSRC 行业分类名列表（带分类代码前缀，如"C27医药制造业"），不确定名称先调 ListIndustries 查询真实值域；传多个行业会分别硬筛后合并去重'),
        excludeNegativePe: z.boolean().default(true)
          .describe('是否排除亏损股（PE<0），默认排除'),
        excludeSt: z.boolean().default(true)
          .describe('是否排除 ST/*ST 股票，默认排除'),
        limit: z.number().min(1).max(100).default(50)
          .describe('候选池上限，默认 50，最大 100'),
      }),
      async (args) => {
        const result = await preheatLongTermPool(
          {
            industries: args.industries,
            excludeNegativePe: args.excludeNegativePe,
            excludeSt: args.excludeSt,
          },
          {
            limit: args.limit,
          },
        );

        if (!result.ok) {
          return {
            isError: true,
            content: [{ type: 'text' as const, text: result.error }],
          };
        }

        return {
          content: [{ type: 'text' as const, text: formatLongTermOutput(result) }],
        };
      },
    ),

    // ========================================
    // 工具: 长期综合评分排序
    // ========================================
    defineTool(
      'RankByLongTerm',
      '对 PreheatLongTermPool 的候选池按 4 维度长期指标打分排序：ROE 均值（盈利能力）/ 增长 CAGR（成长性）/ 长期趋势（周 K MA26/MA52 + 年内位置）/ 稳定性（ROE 变异系数 + 净利下滑年数）。\n' +
      '使用方法: 从 PreheatLongTermPool 返回结果的 JSON 代码块中取 candidates 数组，原样传入本工具。\n' +
      '权重可反复调整秒级重跑（如偏重 ROE 则 roeMean=0.4、growth=0.2、trend=0.2、stability=0.2）；不传 weights 则用默认均等权重（各 0.25）。\n' +
      '返回: markdown 排名表（含各维度得分 0-100 + 原始指标值）+ weightsApplied JSON（显示实际生效权重，含归零重分配说明）。',
      z.object({
        candidates: z.array(z.record(z.string(), z.any())).min(1)
          .describe('候选池数组，直接从 PreheatLongTermPool 结果的 JSON 代码块里取 candidates 字段原样复制'),
        weights: z.object({
          roeMean: z.number().min(0).optional().describe('ROE 均值权重，默认 0.25'),
          growth: z.number().min(0).optional().describe('增长 CAGR 权重，默认 0.25'),
          trend: z.number().min(0).optional().describe('长期趋势权重，默认 0.25'),
          stability: z.number().min(0).optional().describe('稳定性权重，默认 0.25'),
        }).optional()
          .describe('权重覆盖，默认均等（各 0.25）；自动归一化；某维度全池数据缺失时自动归零并重分配'),
        top: z.number().min(1).max(50).default(15)
          .describe('返回前 N 只，默认 15，最大 50'),
      }),
      async (args) => {
        try {
          const candidates = args.candidates as unknown as LongTermCandidateData[];
          const weights: LongTermWeights | undefined = args.weights
            ? {
              roeMean: args.weights.roeMean,
              growth: args.weights.growth,
              trend: args.weights.trend,
              stability: args.weights.stability,
            }
            : undefined;

          const result: RankByLongTermResult = rankByLongTerm({ candidates, weights, top: args.top });

          const weightsJson = JSON.stringify(result.weightsApplied, null, 2);
          const text = `${result.markdown}\n\n### 生效权重（weightsApplied）\n\n\`\`\`json\n${weightsJson}\n\`\`\``;

          return {
            content: [{ type: 'text' as const, text }],
          };
        } catch (error) {
          return {
            isError: true,
            content: [{
              type: 'text' as const,
              text: `长期评分排序失败: ${error instanceof Error ? error.message : String(error)}`,
            }],
          };
        }
      },
    ),
  ];
}

registerToolGroup({
  server: 'dogear-stock-picking',
  label: '候选池预热',
  create: createStockPickingToolDefs,
});
