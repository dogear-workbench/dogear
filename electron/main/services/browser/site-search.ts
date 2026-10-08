import {
  extractZhihuStateCards,
  parseRedditSerp,
  parseZhihuSerp,
  type ParsedSerpItem,
} from './serp-parsers.js';
import { evalInTab, FetchNavError, sleep } from './embedded/fetch-page.js';
import type { EmbeddedTabRecord } from './embedded/types.js';

export type SiteSearchId = 'reddit' | 'zhihu';

export interface SiteSearchConfig {
  domain: string;
  label: string;
  urlTemplate: string;
}

export const SITE_SEARCH_CONFIG: Record<SiteSearchId, SiteSearchConfig> = {
  reddit: {
    domain: 'reddit.com',
    label: 'Reddit',
    urlTemplate: 'https://old.reddit.com/search?q={q}&sort=top&t=year',
  },
  zhihu: {
    domain: 'zhihu.com',
    label: '知乎',
    urlTemplate: 'https://www.zhihu.com/search?q={q}&type=content',
  },
};

const GOTO_TIMEOUT_MS = 15_000;
const ZHIHU_RENDER_TIMEOUT_MS = 8_000;
const ZHIHU_RENDER_POLL_MS = 300;

export type SiteFailureKind = 'nav_failed' | 'parse_empty';

export type SiteAttempt =
  | { ok: true; items: ParsedSerpItem[] }
  | { ok: false; failureKind: SiteFailureKind; reason: string };

export interface SiteAttemptEvent {
  action: 'navigate' | 'wait' | 'observe' | 'parse';
  url?: string;
  detail?: string;
  result?: string;
}

export type SiteEmit = (event: SiteAttemptEvent) => void;

function buildSiteUrl(site: SiteSearchId, query: string, override?: string): string {
  return (override ?? SITE_SEARCH_CONFIG[site].urlTemplate).replace('{q}', encodeURIComponent(query));
}

const hasZhihuEmptyNoticeFn = new Function(
  `return () => (document.body ? document.body.innerText.includes('未搜索到相关内容') : false)`,
)() as () => boolean;

const hasZhihuResultCardFn = new Function(
  `return () => !!document.querySelector('.SearchResult-Card, .ContentItem')`,
)() as () => boolean;

async function waitForZhihuRender(tab: EmbeddedTabRecord, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + Math.max(0, timeoutMs);
  while (Date.now() < deadline) {
    const found = await evalInTab(tab, hasZhihuResultCardFn).catch(() => false);
    if (found) return true;
    await sleep(ZHIHU_RENDER_POLL_MS);
  }
  return false;
}

async function readZhihuState(tab: EmbeddedTabRecord): Promise<ParsedSerpItem[] | null> {
  try {
    return await evalInTab(tab, extractZhihuStateCards);
  } catch {
    return null;
  }
}

async function refineEmptyReason(site: SiteSearchId, tab: EmbeddedTabRecord, label: string): Promise<string> {
  const loginHint = '可在浏览器面板人工登录该站点一次后重试（profile 会记住）';
  if (site === 'reddit' && /\/login\//.test(tab.url)) {
    return `${label} 未登录，站内搜索被重定向到登录页，${loginHint}`;
  }
  if (site === 'zhihu') {
    const emptyNotice = await evalInTab(tab, hasZhihuEmptyNoticeFn).catch(() => false);
    if (emptyNotice) {
      return `${label} 返回空结果（未登录时知乎可能不返回搜索内容），${loginHint}`;
    }
  }
  return `${label} 搜索结果解析为空（页面改版或无结果）`;
}

/** ensureTab 由编排层注入：首次调用打开抓取 tab，后续对同一 tab 重复导航（降级链共用） */
export type SiteEnsureTab = (url: string, timeoutMs: number) => Promise<EmbeddedTabRecord>;

export async function runSiteAttempt(
  site: SiteSearchId,
  ensureTab: SiteEnsureTab,
  query: string,
  urlOverride: string | undefined,
  emit: SiteEmit,
  remainingMs: number,
): Promise<SiteAttempt> {
  const config = SITE_SEARCH_CONFIG[site];
  const url = buildSiteUrl(site, query, urlOverride);
  emit({ action: 'navigate', url, detail: `导航到 ${config.label} 站内搜索结果页` });
  let tab: EmbeddedTabRecord;
  try {
    tab = await ensureTab(url, Math.min(GOTO_TIMEOUT_MS, Math.max(1_000, remainingMs)));
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    emit({ action: 'navigate', url, detail: message, result: 'nav_failed' });
    const redirectedToLogin = site === 'reddit' && err instanceof FetchNavError && /\/login\//.test(err.url);
    const cause = redirectedToLogin
      ? '导航被重定向到 Reddit 登录页（可能未登录）；可在浏览器面板人工登录该站点一次后重试（profile 会记住）'
      : '网络或代理异常';
    return {
      ok: false,
      failureKind: 'nav_failed',
      reason: `${config.label} 站内导航失败（${cause}）：${message}`,
    };
  }

  if (site === 'zhihu') {
    emit({ action: 'wait', url: tab.url, detail: '等待知乎搜索结果渲染' });
    await waitForZhihuRender(tab, Math.min(ZHIHU_RENDER_TIMEOUT_MS, Math.max(1_000, remainingMs)));
    await sleep(300);
    const stateItems = await readZhihuState(tab);
    if (stateItems && stateItems.length > 0) {
      emit({
        action: 'parse',
        url: tab.url,
        detail: `知乎状态数据解析成功：${stateItems.length} 条结果`,
        result: `count=${stateItems.length}`,
      });
      return { ok: true, items: stateItems };
    }
  }

  emit({ action: 'parse', url: tab.url, detail: `开始解析 ${config.label} 搜索结果` });
  let items: ParsedSerpItem[];
  try {
    items = await evalInTab(tab, site === 'reddit' ? parseRedditSerp : parseZhihuSerp);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    emit({ action: 'parse', url: tab.url, detail: message, result: 'parse_empty' });
    return { ok: false, failureKind: 'parse_empty', reason: `${config.label} 结果解析异常：${message}` };
  }
  if (items.length === 0) {
    const reason = await refineEmptyReason(site, tab, config.label);
    emit({
      action: 'parse',
      url: tab.url,
      detail: `${config.label} ${reason}`,
      result: 'parse_empty',
    });
    return { ok: false, failureKind: 'parse_empty', reason };
  }
  emit({
    action: 'parse',
    url: tab.url,
    detail: `${config.label} 解析成功：${items.length} 条结果`,
    result: `count=${items.length}`,
  });
  return { ok: true, items };
}
