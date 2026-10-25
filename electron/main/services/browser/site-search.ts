/**
 * 站内搜索尝试（reddit/zhihu 纯 HTTP 快档）
 *
 * reddit 走 old.reddit 服务端渲染页直接 DOM 解析；zhihu 优先提取 script#js-initialData
 * 的状态 JSON 提卡片，DOM 解析兜底。纯 HTTP 无登录态：登录敏感的空结果/重定向按原样
 * 归类失败原因，由上层降级为 site: 通用搜索。
 */
import { parseHTML } from 'linkedom';
import {
  extractZhihuInitialData,
  extractZhihuStateCards,
  parseRedditSerp,
  parseZhihuSerp,
  type ParsedSerpItem,
} from './serp-parsers.js';
import { fetchSerpHtml, SerpFetchError } from './serp-http.js';

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

const SITE_FETCH_TIMEOUT_MS = 15_000;

export type SiteFailureKind = 'nav_failed' | 'parse_empty';

export type SiteAttempt =
  | { ok: true; items: ParsedSerpItem[] }
  | { ok: false; failureKind: SiteFailureKind; reason: string };

export interface SiteAttemptEvent {
  action: 'navigate' | 'observe' | 'parse';
  url?: string;
  detail?: string;
  result?: string;
}

export type SiteEmit = (event: SiteAttemptEvent) => void;

function buildSiteUrl(site: SiteSearchId, query: string, override?: string): string {
  return (override ?? SITE_SEARCH_CONFIG[site].urlTemplate).replace('{q}', encodeURIComponent(query));
}

function refineEmptyReason(site: SiteSearchId, bodyText: string, label: string): string {
  if (site === 'zhihu' && bodyText.includes('未搜索到相关内容')) {
    return `${label} 返回空结果（未登录时知乎可能不返回搜索内容）`;
  }
  return `${label} 搜索结果解析为空（页面改版或无结果）`;
}

export async function runSiteAttempt(
  site: SiteSearchId,
  query: string,
  urlOverride: string | undefined,
  emit: SiteEmit,
  remainingMs: number,
  proxyServer?: string,
): Promise<SiteAttempt> {
  const config = SITE_SEARCH_CONFIG[site];
  const url = buildSiteUrl(site, query, urlOverride);
  emit({ action: 'navigate', url, detail: `抓取 ${config.label} 站内搜索结果页` });
  let html = '';
  let finalUrl = url;
  try {
    const fetched = await fetchSerpHtml(url, {
      proxyServer,
      timeoutMs: Math.min(SITE_FETCH_TIMEOUT_MS, Math.max(1_000, remainingMs)),
    });
    html = fetched.html;
    finalUrl = fetched.url;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    emit({ action: 'navigate', url, detail: message, result: 'nav_failed' });
    const redirectedToLogin = site === 'reddit' && err instanceof SerpFetchError && /\/login/.test(err.url);
    const cause = redirectedToLogin
      ? '未登录，站内搜索被重定向到登录页（纯 HTTP 通道无登录态）'
      : '网络或代理异常';
    return {
      ok: false,
      failureKind: 'nav_failed',
      reason: `${config.label} 站内抓取失败（${cause}）：${message}`,
    };
  }

  const { document } = parseHTML(html);
  const bodyText = document.body ? (document.body.textContent || '') : '';

  if (site === 'zhihu') {
    emit({ action: 'parse', url: finalUrl, detail: '提取知乎初始状态数据' });
    const stateItems = extractZhihuStateCards(extractZhihuInitialData(document));
    if (stateItems && stateItems.length > 0) {
      emit({
        action: 'parse',
        url: finalUrl,
        detail: `知乎状态数据解析成功：${stateItems.length} 条结果`,
        result: `count=${stateItems.length}`,
      });
      return { ok: true, items: stateItems };
    }
  }

  emit({ action: 'parse', url: finalUrl, detail: `开始解析 ${config.label} 搜索结果` });
  let items: ParsedSerpItem[];
  try {
    items = site === 'reddit' ? parseRedditSerp(document, finalUrl) : parseZhihuSerp(document, finalUrl);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    emit({ action: 'parse', url: finalUrl, detail: message, result: 'parse_empty' });
    return { ok: false, failureKind: 'parse_empty', reason: `${config.label} 结果解析异常：${message}` };
  }
  if (items.length === 0) {
    const reason = refineEmptyReason(site, bodyText, config.label);
    emit({ action: 'parse', url: finalUrl, detail: `${config.label} ${reason}`, result: 'parse_empty' });
    return { ok: false, failureKind: 'parse_empty', reason };
  }
  emit({
    action: 'parse',
    url: finalUrl,
    detail: `${config.label} 解析成功：${items.length} 条结果`,
    result: `count=${items.length}`,
  });
  return { ok: true, items };
}
