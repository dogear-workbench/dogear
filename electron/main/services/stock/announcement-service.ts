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
import crypto from 'crypto';
import fs from 'fs/promises';
import electron from 'electron';
import { safeJsonWrite, safeJsonRead } from '../safe-json.js';
import { rateLimiter } from './rate-limiter.js';
import { parseAnnouncementPdf } from './python-bridge.js';

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

/** 公告全文（解析后的 markdown），readAnnouncement 的返回数据 */
export interface AnnouncementDetail {
  url: string;
  markdown: string;
  cachedAt: string;
  fromCache: boolean;
}

/** 缓存索引条目（index.json 中的一条） */
export interface CachedAnnouncementEntry {
  url: string;
  title: string;
  type: AnnouncementType;
  date: string;
  hash: string;
  cachedAt: string;
}

/** 公告列表当天缓存中的单条条目（不含 code/market，由 AnnouncementListCache 顶层统一携带） */
export interface CachedAnnouncementListItem {
  url: string;
  title: string;
  type: AnnouncementType;
  date: string;
}

/** 公告列表当天缓存文件结构（`list.{YYYY-MM-DD}.json`） */
interface AnnouncementListCache {
  cachedAt: string;
  market: Market;
  code: string;
  range: { since: string; until: string; limit: number };
  items: CachedAnnouncementListItem[];
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
/** orgId 映射表重抓冷却：未命中时映射表若比这更新，判定该股票确实不存在而非未同步 */
const ORG_MAP_REFRESH_COOLDOWN_MS = 24 * 60 * 60 * 1000;

function getConfigDir(): string {
  if (process.env.DOGEAR_CONFIG_DIR) return process.env.DOGEAR_CONFIG_DIR;
  if (app?.isPackaged) {
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

/**
 * 查询股票对应的巨潮 orgId；本地未命中时懒重抓一次（可能是新上市未同步），仍未命中返回 null。
 *
 * 未命中不能无条件重抓：错代码 / 指数 / 港股这类"本来就不在表里"的查询会把两个全市场接口
 * 打满。映射表若是 24h 内拉的就认定"真没这只股"，直接返回 null。用文件的 updatedAt 判断而
 * 非内存变量，跨进程重启同样有效。
 */
async function getOrgId(code: string): Promise<string | null> {
  const file = await ensureOrgIdMap();
  const hit = file.map[code];
  if (hit) return hit.orgId;

  const age = Date.now() - Date.parse(file.updatedAt);
  if (Number.isFinite(age) && age < ORG_MAP_REFRESH_COOLDOWN_MS) return null;

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

/** 服务端 category 参数固定传空：当天首次拉全量缓存不做类型预过滤，类型过滤统一交给本地 filterCachedAnnouncements */
async function fetchAnnouncementPage(
  code: string,
  orgId: string,
  market: Market,
  pageNum: number,
  seDate: string,
): Promise<CninfoQueryResponse> {
  const params = new URLSearchParams({
    stock: `${code},${orgId}`,
    tabName: 'fulltext',
    pageSize: String(PAGE_SIZE),
    pageNum: String(pageNum),
    column: marketToColumn(market),
    category: '',
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
    { key: `cninfo:list:${code}:${seDate}:${pageNum}`, cacheTtlMs: 60_000 },
  );
}

/** 按 seDate 翻页拉取公告列表，最多凑够 limit 条，不做类型过滤（留给调用方本地过滤） */
async function fetchAnnouncementItems(
  code: string,
  orgId: string,
  market: Market,
  seDate: string,
  limit: number,
): Promise<CachedAnnouncementListItem[]> {
  const collected: CachedAnnouncementListItem[] = [];

  for (let pageNum = 1; pageNum <= MAX_PAGES; pageNum++) {
    const page = await fetchAnnouncementPage(code, orgId, market, pageNum, seDate);
    const items = page.announcements ?? [];

    for (const item of items) {
      collected.push({
        url: `http://static.cninfo.com.cn/${item.adjunctUrl}`,
        title: item.announcementTitle,
        type: inferType(item.announcementType),
        date: extractDate(item.adjunctUrl, item.announcementTime),
      });

      if (collected.length >= limit) break;
    }

    if (collected.length >= limit) break;
    if (items.length < PAGE_SIZE) break; // 已到最后一页
  }

  return collected.slice(0, limit);
}

// ============================================================
// 公告列表当天缓存
// ============================================================

/** 当天首次拉取时使用的宽范围：覆盖绝大多数查询，之后同天所有 opts 组合走本地过滤 */
const WIDE_RANGE_MONTHS = 6;
const WIDE_FETCH_LIMIT = 100;

/** 本地时区 YYYY-MM-DD，用作缓存 key（与 UTC 的 toISOString 会有跨日误差，故手动拼接） */
function localDateKey(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function todayDateKey(): string {
  return localDateKey(new Date());
}

function monthsAgoDateKey(months: number): string {
  const d = new Date();
  d.setMonth(d.getMonth() - months);
  return localDateKey(d);
}

function getAnnouncementListCachePath(market: Market, code: string, dateKey: string): string {
  return path.join(getStorageDir(market, code), `list.${dateKey}.json`);
}

/** 读当天公告列表缓存；文件不存在是正常情况（当天首次调用），只有解析失败才打日志 */
async function readAnnouncementListCache(
  market: Market,
  code: string,
  dateKey: string,
): Promise<AnnouncementListCache | null> {
  const filePath = getAnnouncementListCachePath(market, code, dateKey);
  try {
    const raw = await fs.readFile(filePath, 'utf-8');
    return JSON.parse(raw) as AnnouncementListCache;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
    console.warn('[AnnouncementListCache] 读缓存失败，当作未命中:', err);
    return null;
  }
}

/** 写盘失败只打日志，不影响本次已经拿到的返回结果；顺带清掉往日残留，避免每天一个文件无限堆积 */
async function writeAnnouncementListCache(cache: AnnouncementListCache, dateKey: string): Promise<void> {
  const dir = getStorageDir(cache.market, cache.code);
  const filePath = getAnnouncementListCachePath(cache.market, cache.code, dateKey);
  try {
    await safeJsonWrite(filePath, cache);
  } catch (err) {
    console.warn('[AnnouncementListCache] 写缓存失败，不影响本次返回:', err);
    return;
  }

  const keep = path.basename(filePath);
  try {
    const entries = await fs.readdir(dir);
    await Promise.all(
      entries
        .filter((name) => name.startsWith('list.') && name.endsWith('.json') && name !== keep)
        .map((name) => fs.unlink(path.join(dir, name)).catch(() => {})),
    );
  } catch (err) {
    console.warn('[AnnouncementListCache] 清理旧缓存失败，不影响本次返回:', err);
  }
}

/** 对当天缓存的全量列表做本地过滤（since/until/types/limit），Step 3 预热服务复用 */
export function filterCachedAnnouncements(
  items: CachedAnnouncementListItem[],
  opts: ListAnnouncementsOpts,
): CachedAnnouncementListItem[] {
  let filtered = items;
  if (opts.since) filtered = filtered.filter((x) => x.date >= opts.since!);
  if (opts.until) filtered = filtered.filter((x) => x.date <= opts.until!);
  if (opts.types && opts.types.length > 0) filtered = filtered.filter((x) => opts.types!.includes(x.type));
  return filtered.slice(0, opts.limit ?? 20);
}

function toAnnouncements(items: CachedAnnouncementListItem[], code: string, market: Market): Announcement[] {
  return items.map((item) => ({ ...item, code, market }));
}

/**
 * 拉取指定股票的公告列表，按"当天 key"缓存：当天首次调用忽略 opts，拉近 6 个月 × 100 条全量写盘；
 * 之后同天内的所有 opts 组合都用这份全量数据本地过滤。若请求的 since 早于缓存覆盖范围，视为缓存不完整，
 * 改用能覆盖该 since 的范围重新真调并覆写当天缓存。
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

  const today = todayDateKey();

  try {
    const cached = await readAnnouncementListCache(resolvedMarket, code, today);
    if (cached && (!opts.since || opts.since >= cached.range.since)) {
      return { ok: true, data: toAnnouncements(filterCachedAnnouncements(cached.items, opts), code, resolvedMarket) };
    }

    const orgId = await getOrgId(code);
    if (!orgId) {
      return { ok: false, error: `未找到股票代码 ${code} 对应的巨潮 orgId` };
    }

    const wideSince = monthsAgoDateKey(WIDE_RANGE_MONTHS);
    const since = opts.since && opts.since < wideSince ? opts.since : wideSince;
    const limit = Math.max(WIDE_FETCH_LIMIT, opts.limit ?? 0);
    const seDate = `${since}~${today}`;

    const items = await fetchAnnouncementItems(code, orgId, resolvedMarket, seDate, limit);

    await writeAnnouncementListCache(
      {
        cachedAt: new Date().toISOString(),
        market: resolvedMarket,
        code,
        range: { since, until: today, limit },
        items,
      },
      today,
    );

    return { ok: true, data: toAnnouncements(filterCachedAnnouncements(items, opts), code, resolvedMarket) };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, error: `巨潮公告查询失败: ${message}` };
  }
}

// ============================================================
// 公告全文抓取 + 懒缓存
// ============================================================

/** 单份公告 PDF 大小上限，超出视为异常公告拒绝下载 */
const MAX_PDF_SIZE_BYTES = 30 * 1024 * 1024;

function getStorageDir(market: Market, code: string): string {
  return path.join(getConfigDir(), 'stocks', 'announcements', `${market}${code}`);
}

function hashUrl(url: string): string {
  return crypto.createHash('sha256').update(url).digest('hex').slice(0, 16);
}

/** 只允许巨潮静态资源域名，防止 readAnnouncement 被喂任意 URL 当 SSRF 跳板 */
function validateCninfoUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'http:' && parsed.hostname === 'static.cninfo.com.cn';
  } catch {
    return false;
  }
}

function getIndexPath(dir: string): string {
  return path.join(dir, 'index.json');
}

async function readIndex(dir: string): Promise<CachedAnnouncementEntry[]> {
  return safeJsonRead<CachedAnnouncementEntry[]>(getIndexPath(dir), []);
}

async function writeIndex(dir: string, entries: CachedAnnouncementEntry[]): Promise<void> {
  await safeJsonWrite(getIndexPath(dir), entries);
}

async function readCachedMarkdown(mdPath: string): Promise<string | null> {
  try {
    return await fs.readFile(mdPath, 'utf-8');
  } catch {
    return null;
  }
}

/**
 * 下载公告 PDF 到本地。边下载边计数，超出 MAX_PDF_SIZE_BYTES 立即中止并删除半成品文件。
 * 失败（含超限）交由外层 rateLimiter 的指数退避重试机制处理。
 */
async function downloadPdf(url: string, targetPath: string): Promise<void> {
  try {
    await rateLimiter.execute<void>(
      async () => {
        const resp = await fetch(url);
        if (!resp.ok || !resp.body) {
          throw new Error(`下载公告 PDF 失败: HTTP ${resp.status}`);
        }

        const contentLength = resp.headers.get('content-length');
        if (contentLength && Number(contentLength) > MAX_PDF_SIZE_BYTES) {
          throw new Error(`公告 PDF 大小超出上限（${MAX_PDF_SIZE_BYTES / 1024 / 1024}MB）`);
        }

        const reader = resp.body.getReader();
        const fileHandle = await fs.open(targetPath, 'w');
        let total = 0;
        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            total += value.byteLength;
            if (total > MAX_PDF_SIZE_BYTES) {
              throw new Error(`公告 PDF 大小超出上限（${MAX_PDF_SIZE_BYTES / 1024 / 1024}MB）`);
            }
            await fileHandle.write(value);
          }
        } finally {
          await fileHandle.close();
        }
      },
      { key: `cninfo:pdf:${url}` },
    );
  } catch (err) {
    await fs.unlink(targetPath).catch(() => { /* 半成品文件可能不存在，忽略 */ });
    throw err;
  }
}

/**
 * 读取公告全文。命中本地缓存直接返回 markdown；未命中则下载 PDF → Python 解析 → 写缓存。
 * @param meta Step 2 listAnnouncements 结果里对应条目的元数据（title/type/date），用于写 index.json；
 *             不传时 index 里对应字段留空/other，不影响 markdown 正文读取。
 */
export async function readAnnouncement(
  url: string,
  code: string,
  market: Market,
  meta?: Pick<Announcement, 'title' | 'type' | 'date'>,
): Promise<{ ok: true; data: AnnouncementDetail } | { ok: false; error: string }> {
  if (!validateCninfoUrl(url)) {
    return { ok: false, error: `不允许的公告 URL（仅支持 static.cninfo.com.cn）: ${url}` };
  }

  try {
    const dir = getStorageDir(market, code);
    await fs.mkdir(dir, { recursive: true });

    const hash = hashUrl(url);
    const pdfPath = path.join(dir, `${hash}.pdf`);
    const mdPath = path.join(dir, `${hash}.md`);

    const cachedMarkdown = await readCachedMarkdown(mdPath);
    if (cachedMarkdown !== null) {
      const entries = await readIndex(dir);
      const entry = entries.find((e) => e.hash === hash);
      return {
        ok: true,
        data: {
          url,
          markdown: cachedMarkdown,
          cachedAt: entry?.cachedAt ?? new Date().toISOString(),
          fromCache: true,
        },
      };
    }

    await downloadPdf(url, pdfPath);

    const parsed = await parseAnnouncementPdf(pdfPath);
    if (!parsed.ok) {
      return { ok: false, error: `公告解析失败: ${parsed.error}` };
    }

    const cachedAt = new Date().toISOString();
    await fs.writeFile(mdPath, parsed.data.markdown, 'utf-8');

    const entries = await readIndex(dir);
    const nextEntries = entries.filter((e) => e.hash !== hash);
    nextEntries.push({
      url,
      title: meta?.title ?? '',
      type: meta?.type ?? 'other',
      date: meta?.date ?? '',
      hash,
      cachedAt,
    });
    await writeIndex(dir, nextEntries);

    return { ok: true, data: { url, markdown: parsed.data.markdown, cachedAt, fromCache: false } };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, error: `读取公告全文失败: ${message}` };
  }
}

/** 清空某只股票的公告缓存目录（PDF + markdown + index.json 全部删除） */
export async function clearAnnouncementCache(
  market: Market,
  code: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    await fs.rm(getStorageDir(market, code), { recursive: true, force: true });
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}
