/**
 * 公司公告 MCP Server 工具
 *
 * 提供 2 个工具，允许 Agent 查询股票的公司公告列表并读取全文：
 *   - ListAnnouncements  — 拉取公告元数据列表（标题/日期/类型/PDF直链）
 *   - ReadAnnouncement   — 读取指定公告全文（PDF 解析为 markdown，本地懒缓存）
 *
 * 数据源：巨潮资讯网（cninfo.com.cn），详见 announcement-service.ts。
 * 网络请求经过共享 rateLimiter 防护，无需在工具层额外限流。
 */

import { z } from 'zod';
import { listAnnouncements, readAnnouncement } from '../../services/stock/index.js';
import type { AnnouncementType } from '../../services/stock/index.js';
import { registerToolGroup } from './tool-registry.js';
import { defineTool, type ToolDef } from '../pi/tool-adapter.js';

// ============================================================
// 常量
// ============================================================

const ANNOUNCEMENT_TYPES = ['annual', 'quarterly', 'semi_annual', 'interim', 'ipo', 'other'] as const;

/** 公告列表默认/最大返回条数 */
const DEFAULT_LIST_LIMIT = 20;
const MAX_LIST_LIMIT = 50;

const TYPE_LABELS: Record<AnnouncementType, string> = {
  annual: '年报',
  semi_annual: '半年报',
  quarterly: '季报',
  interim: '临时公告',
  ipo: '首发',
  other: '其他',
};

// ============================================================
// 工具创建函数
// ============================================================

/**
 * 创建公司公告工具中立定义（ToolDef[]）
 * @returns ToolDef 数组
 */
export function createAnnouncementToolDefs(): ToolDef[] {
  return [
    // ========================================
    // 工具 1: 查询公告列表
    // ========================================
    defineTool(
      'ListAnnouncements',
      '查询指定股票在巨潮资讯网（cninfo.com.cn）披露的公司公告列表，返回标题、日期、类型和原始 PDF 直链（url）。\n' +
      '使用场景：用户询问某只股票"最近有什么公告""财报什么时候发的""有没有增发/回购公告"等，需要先拉列表看有哪些公告再决定是否深挖某一条。\n' +
      '参数说明：\n' +
      '- code：股票代码（如 "600519"），必填。\n' +
      '- market：市场代码 sh/sz/bj，可选——不传时会根据股票代码前缀自动推断，推断失败（罕见的新代码段）会在返回的错误信息里提示你显式传入。\n' +
      '- since：起始日期（YYYY-MM-DD），只返回该日期及以后披露的公告；不传则不限制起始时间，按 limit 从最新往前取。\n' +
      '- types：公告类型过滤，取值 annual（年报）/semi_annual（半年报）/quarterly（季报）/ipo（首发上市）/interim（临时公告）/other（其他），可传多个；不传则不过滤类型。\n' +
      '- limit：返回条数上限，默认 20，最多 50。\n' +
      '返回值是 markdown 列表，每条含日期、类型、标题、url。**这里返回的 url 是唯一合法的公告地址**——如果用户想看某条公告的具体内容，调用 ReadAnnouncement 工具时必须把这里的 url 原样复制过去，不要自己拼接、修改域名或路径，否则会被拒绝（只允许 static.cninfo.com.cn 域名）。',
      z.object({
        code: z.string().describe('股票代码（如 "600519"）'),
        market: z.enum(['sh', 'sz', 'bj']).optional().describe('市场代码（sh=沪市 sz=深市 bj=北交所）。不传时自动按代码前缀推断'),
        since: z.string().optional().describe('起始日期 YYYY-MM-DD，只返回该日期及以后的公告；不传则不限制'),
        types: z.array(z.enum(ANNOUNCEMENT_TYPES)).optional().describe('公告类型过滤，可传多个；不传则返回所有类型'),
        limit: z.number().min(1).max(MAX_LIST_LIMIT).default(DEFAULT_LIST_LIMIT).describe(`返回条数上限，默认 ${DEFAULT_LIST_LIMIT}，最多 ${MAX_LIST_LIMIT}`),
      }),
      async (args) => {
        const result = await listAnnouncements(args.code, args.market, {
          since: args.since,
          types: args.types as AnnouncementType[] | undefined,
          limit: args.limit,
        });

        if (!result.ok) {
          return {
            content: [{ type: 'text' as const, text: `错误：${result.error}` }],
            isError: true,
          };
        }

        if (result.data.length === 0) {
          return {
            content: [{ type: 'text' as const, text: `未查询到 ${args.code} 符合条件的公告。` }],
          };
        }

        const marketLabel = result.data[0]?.market ?? args.market ?? '';
        const lines = result.data.map((item) =>
          `- ${item.date} [${TYPE_LABELS[item.type]}] ${item.title} (${item.url})`
        );

        return {
          content: [{
            type: 'text' as const,
            text: `${args.code}（${marketLabel}）公告列表（共 ${result.data.length} 条）：\n\n${lines.join('\n')}\n\n` +
              '如需查看某条公告全文，调用 ReadAnnouncement 并把上面对应的 url、market 原样传入。',
          }],
        };
      }
    ),

    // ========================================
    // 工具 2: 读取公告全文
    // ========================================
    defineTool(
      'ReadAnnouncement',
      '读取一条公司公告的全文内容（PDF 解析为 markdown 文本，含标题、正文、表格）。首次读取会现下载 PDF 并解析，可能耗时几秒到十几秒；解析结果会缓存到本地，同一条公告再次读取会直接命中缓存、几乎瞬间返回。\n' +
      '使用场景：用户看完 ListAnnouncements 返回的列表后，想深入了解某一条具体公告的内容（如"看下最新那条年报说了什么""这条业绩预告写了啥"）。\n' +
      '参数说明：\n' +
      '- url：公告的 PDF 直链，**必须是 ListAnnouncements 返回结果中某一条的 url 字段，原样复制粘贴**，不要手动拼接、猜测或修改——出于安全考虑只接受 static.cninfo.com.cn 域名，其他地址会被拒绝并返回错误。\n' +
      '- code：股票代码，必须和该条公告所属股票一致（用于定位本地缓存目录）。\n' +
      '- market：市场代码 sh/sz/bj，必须和该条公告所属市场一致——直接使用 ListAnnouncements 该条结果里的 market 字段值，本工具不做自动推断，传错会导致缓存目录错位。\n' +
      '返回值是该公告的 markdown 全文。**注意**：年报/半年报等长公告解析后文本可能非常长（几千到上万字），请根据实际长度自行判断是否需要分段消化或只摘取用户关心的部分，不要不假思索地把全部内容塞进后续分析。',
      z.object({
        url: z.string().describe('公告 PDF 直链，必须原样取自 ListAnnouncements 返回结果的 url 字段'),
        code: z.string().describe('股票代码（如 "600519"），需与该公告所属股票一致'),
        market: z.enum(['sh', 'sz', 'bj']).describe('市场代码，需与该公告所属市场一致（取自 ListAnnouncements 该条结果的 market 字段）'),
      }),
      async (args) => {
        const result = await readAnnouncement(args.url, args.code, args.market);

        if (!result.ok) {
          return {
            content: [{ type: 'text' as const, text: `错误：${result.error}` }],
            isError: true,
          };
        }

        const cacheNote = result.data.fromCache
          ? `缓存命中，缓存时间 ${result.data.cachedAt}`
          : '首次抓取并解析完成';

        return {
          content: [{
            type: 'text' as const,
            text: `公告全文（${cacheNote}）：\n\n${result.data.markdown}`,
          }],
        };
      }
    ),
  ];
}

registerToolGroup({
  server: 'dogear-stock-announcement',
  label: '公司公告',
  create: createAnnouncementToolDefs,
});
