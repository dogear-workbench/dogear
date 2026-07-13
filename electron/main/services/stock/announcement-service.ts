/**
 * 公司公告服务 — AnnouncementService
 *
 * 数据源：巨潮资讯网（cninfo.com.cn）
 *   - 列表：POST /new/hisAnnouncement/query（服务端 pageSize 硬顶 30，需翻页）
 *   - orgId 映射：GET /new/data/szse_stock.json —— 命名具有历史遗留误导性，
 *     实测该文件已合并沪深京全市场（沪 600xxx/688xxx、深 000xxx/300xxx、京 8xxxxx/920xxx 均在内）；
 *     GET /new/data/bj_stock.json 作为冗余补充源双重校验
 *   - PDF：http://static.cninfo.com.cn/{adjunctUrl}
 *
 * announcementTime 是"北京时间 0 点"对应的 UTC 时间戳，直接转 ISO 日期会差一天，
 * 故优先从 adjunctUrl 路径（形如 finalpage/2026-06-22/xxx.PDF）里取日期。
 */
import path from 'path';
import electron from 'electron';
import { safeJsonWrite, safeJsonRead } from '../safe-json.js';
import { rateLimiter } from './rate-limiter.js';

const { app } = electron;

// ============================================================
// 类型定义（在文件内定义，避免 rootDir 限制；镜像自 types/stock.ts，
// 沿用本目录 stock-service.ts / stock-data-service.ts 的内联镜像惯例）
// ============================================================

export type AnnouncementType = 'annual' | 'quarterly' | 'semi_annual' | 'interim' | 'ipo' | 'other';

export interface Announcement {
  url: string;
  title: string;
  type: AnnouncementType;
  date: string;
  code: string;
  market: string;
}

export interface ListAnnouncementsOpts {
  since?: string;
  until?: string;
  types?: AnnouncementType[];
  limit?: number;
}

type Market = 'sh' | 'sz' | 'bj';

// ============================================================
// orgId 映射存储
// ============================================================

interface OrgMapEntry {
  orgId: string;
  name: string;
}

interface OrgMapFile {
  updatedAt: string;
  map: Record<string, OrgMapEntry>;
}

const EMPTY_ORG_MAP: OrgMapFile = { updatedAt: '', map: {} };

/** 巨潮全市场合并列表最小合理条数（实测约 6200+），低于此判定响应被截断/异常，不采信 */
const MIN_MERGED_LIST_SIZE = 5000;
/** 北交所补充列表最小合理条数 */
const MIN_BJ_LIST_SIZE = 100;

function getConfigDir(): string {
  if (app.isPackaged) {
    return path.join(app.getPath('userData'), '.dogear');
  }
  return path.join(process.cwd(), '.dogear');
}

function getOrgMapPath(): string {
  return path.join(getConfigDir(), 'stocks', 'cninfo-org-map.json');
}

/** 内存缓存，避免同进程内重复读盘 */
let orgMapCache: OrgMapFile | null = null;

interface CninfoStockListItem {
  code: string;
  orgId: string;
  zwjc: string;
}

async function fetchStockList(url: string, minSize: number): Promise<CninfoStockListItem[]> {
  return rateLimiter.execute<CninfoStockListItem[]>(
    async () => {
      const resp = await fetch(url);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const json: any = await resp.json();
      const list = json?.stockList;
      if (!Array.isArray(list) || list.length < minSize) {
        throw new Error(`巨潮股票列表响应异常（${url}），条数=${Array.isArray(list) ? list.length : 'N/A'}`);
      }
      return list;
    },
    { key: `cninfo:stocklist:${url}` },
  );
}

/** 从巨潮官网重新拉取全市场股票列表并落盘，返回合并后的 map */
async function refreshOrgIdMap(): Promise<OrgMapFile> {
  const [merged, bj] = await Promise.all([
    fetchStockList('http://www.cninfo.com.cn/new/data/szse_stock.json', MIN_MERGED_LIST_SIZE),
    fetchStockList('http://www.cninfo.com.cn/new/data/bj_stock.json', MIN_BJ_LIST_SIZE),
  ]);

  const map: Record<string, OrgMapEntry> = {};
  for (const item of [...merged, ...bj]) {
    map[item.code] = { orgId: item.orgId, name: item.zwjc };
  }

  const file: OrgMapFile = { updatedAt: new Date().toISOString(), map };
  await safeJsonWrite(getOrgMapPath(), file);
  orgMapCache = file;
  return file;
}

/** 确保 orgId 映射已加载：内存 → 本地文件 → 远程拉取，三级 fallback */
async function ensureOrgIdMap(): Promise<OrgMapFile> {
  if (orgMapCache && Object.keys(orgMapCache.map).length > 0) {
    return orgMapCache;
  }

  const cached = await safeJsonRead<OrgMapFile>(getOrgMapPath(), EMPTY_ORG_MAP);
  if (Object.keys(cached.map).length > 0) {
    orgMapCache = cached;
    return cached;
  }

  return refreshOrgIdMap();
}

/** 查询股票对应的巨潮 orgId；本地未命中时懒重抓一次（可能是新上市未同步），仍未命中返回 null */
async function getOrgId(code: string): Promise<string | null> {
  const file = await ensureOrgIdMap();
  const hit = file.map[code];
  if (hit) return hit.orgId;

  const refreshed = await refreshOrgIdMap();
  return refreshed.map[code]?.orgId ?? null;
}

// ============================================================
// 市场推断 / category 映射 / 类型反推
// ============================================================

const SH_PREFIXES = ['600', '601', '603', '605', '688', '689', '900'];
const SZ_PREFIXES = ['000', '001', '002', '003', '200', '201', '300', '301', '302'];
const BJ_PREFIXES = [
  '430', '830', '831', '832', '833', '834', '835', '836', '837', '838', '839',
  '870', '871', '872', '873', '920',
];

/** 从股票代码前缀推断所属市场，无法识别返回 null */
function inferMarket(code: string): Market | null {
  const prefix = code.slice(0, 3);
  if (SH_PREFIXES.includes(prefix)) return 'sh';
  if (SZ_PREFIXES.includes(prefix)) return 'sz';
  if (BJ_PREFIXES.includes(prefix)) return 'bj';
  return null;
}

/** market → 巨潮 hisAnnouncement/query 的 column 参数 */
function marketToColumn(market: Market): string {
  if (market === 'sh') return 'sse';
  if (market === 'sz') return 'szse';
  return 'bj';
}

/**
 * 已验证的巨潮 category 参数，仅覆盖定期报告三类。
 * IPO / 临时公告没有稳定可验证的官方分类 ID，交给 inferType 做客户端二次过滤兜底，
 * 正确性优先于服务端预过滤效率。
 */
const CATEGORY_IDS: Partial<Record<AnnouncementType, string[]>> = {
  annual: ['category_ndbg_szsh'],
  semi_annual: ['category_bndbg_szsh'],
  quarterly: ['category_yjdbg_szsh', 'category_sjdbg_szsh'],
};

/** 把类型枚举映射到巨潮 category 参数；混入未知类型时放弃服务端预过滤（返回空串），避免误伤 */
function categoryFilter(types?: AnnouncementType[]): string {
  if (!types || types.length === 0) return '';
  const ids: string[] = [];
  for (const t of types) {
    const mapped = CATEGORY_IDS[t];
    if (!mapped) return '';
    ids.push(...mapped);
  }
  return ids.join(';');
}

/** 从巨潮返回的 announcementType（"||" 分隔的层级分类编码）反推 AnnouncementType */
function inferType(cninfoCategory: string | null | undefined): AnnouncementType {
  if (!cninfoCategory) return 'other';
  const codes = cninfoCategory.split('||');
  if (codes.includes('010301')) return 'annual';
  if (codes.includes('010303')) return 'semi_annual';
  if (codes.includes('010305') || codes.includes('010307')) return 'quarterly';
  if (codes.includes('010123')) return 'ipo';
  return 'interim';
}

/**
 * 从 adjunctUrl（如 "finalpage/2026-06-22/xxx.PDF"）提取公告日期。
 * announcementTime 是北京时间 0 点对应的 UTC 时间戳，直接 toISOString() 会少一天，
 * 因此优先信任路径里的日期段，仅在格式异常时才 fallback 到时间戳 +8h 换算。
 */
function extractDate(adjunctUrl: string, fallbackTime: number): string {
  const match = adjunctUrl.match(/(\d{4}-\d{2}-\d{2})/);
  if (match) return match[1];
  return new Date(fallbackTime + 8 * 3600 * 1000).toISOString().slice(0, 10);
}

/** 拼装 seDate 参数（"since~until"），both 缺省时不传日期范围（不限时间，靠 limit/翻页上限兜底） */
function buildSeDate(opts: ListAnnouncementsOpts): string {
  if (!opts.since && !opts.until) return '';
  const since = opts.since ?? '1990-01-01';
  const until = opts.until ?? new Date().toISOString().slice(0, 10);
  return `${since}~${until}`;
}

// ============================================================
// 巨潮公告列表查询
// ============================================================

interface CninfoAnnouncementItem {
  announcementTitle: string;
  announcementTime: number;
  adjunctUrl: string;
  announcementType: string;
}

interface CninfoQueryResponse {
  announcements: CninfoAnnouncementItem[] | null;
}

/** 巨潮服务端硬顶，请求更大的 pageSize 也会被截断到 30 */
const PAGE_SIZE = 30;
/** 翻页安全上限，避免类型过滤命中率低时无限翻页 */
const MAX_PAGES = 10;

async function fetchAnnouncementPage(
  code: string,
  orgId: string,
  market: Market,
  pageNum: number,
  category: string,
  seDate: string,
): Promise<CninfoQueryResponse> {
  const params = new URLSearchParams({
    stock: `${code},${orgId}`,
    tabName: 'fulltext',
    pageSize: String(PAGE_SIZE),
    pageNum: String(pageNum),
    column: marketToColumn(market),
    category,
    plate: '',
    seDate,
    searchkey: '',
    secid: '',
    sortName: '',
    sortType: '',
    isHLtitle: 'true',
  });

  return rateLimiter.execute<CninfoQueryResponse>(
    async () => {
      const resp = await fetch('http://www.cninfo.com.cn/new/hisAnnouncement/query', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          Referer: 'http://www.cninfo.com.cn/new/commonUrl/pageOfSearch?url=disclosure/list/notice',
        },
        body: params.toString(),
      });
      return resp.json() as Promise<CninfoQueryResponse>;
    },
    { key: `cninfo:list:${code}:${category}:${seDate}:${pageNum}`, cacheTtlMs: 60_000 },
  );
}

/**
 * 拉取指定股票的公告列表。
 * @param code 股票代码，如 "600519"
 * @param market 市场，不传则从代码前缀推断；推断失败返回 error
 * @param opts since/until 日期过滤、types 类型过滤、limit 返回条数（默认 20）
 */
export async function listAnnouncements(
  code: string,
  market?: Market,
  opts: ListAnnouncementsOpts = {},
): Promise<{ ok: true; data: Announcement[] } | { ok: false; error: string }> {
  const resolvedMarket = market ?? inferMarket(code);
  if (!resolvedMarket) {
    return { ok: false, error: `无法识别股票代码 ${code} 所属市场，请显式传入 market` };
  }

  try {
    const orgId = await getOrgId(code);
    if (!orgId) {
      return { ok: false, error: `未找到股票代码 ${code} 对应的巨潮 orgId` };
    }

    const category = categoryFilter(opts.types);
    const seDate = buildSeDate(opts);
    const limit = opts.limit ?? 20;

    const collected: Announcement[] = [];

    for (let pageNum = 1; pageNum <= MAX_PAGES; pageNum++) {
      const page = await fetchAnnouncementPage(code, orgId, resolvedMarket, pageNum, category, seDate);
      const items = page.announcements ?? [];

      for (const item of items) {
        const type = inferType(item.announcementType);
        if (opts.types && opts.types.length > 0 && !opts.types.includes(type)) continue;

        collected.push({
          url: `http://static.cninfo.com.cn/${item.adjunctUrl}`,
          title: item.announcementTitle,
          type,
          date: extractDate(item.adjunctUrl, item.announcementTime),
          code,
          market: resolvedMarket,
        });

        if (collected.length >= limit) break;
      }

      if (collected.length >= limit) break;
      if (items.length < PAGE_SIZE) break; // 已到最后一页
    }

    return { ok: true, data: collected.slice(0, limit) };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, error: `巨潮公告查询失败: ${message}` };
  }
}
