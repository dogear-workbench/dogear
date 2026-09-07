import type { CDPSession, Page } from 'patchright';
import {
  extractZhihuStateCards,
  parseRedditSerp,
  parseZhihuSerp,
  type ParsedSerpItem,
} from './serp-parsers.js';

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

async function readZhihuState(page: Page): Promise<ParsedSerpItem[] | null> {
  // patchright 的 page.evaluate 落在隔离世界，读不到页面脚本写入的 window 全局，必须 CDP 直连主世界
  let cdp: CDPSession | null = null;
  try {
    cdp = await page.context().newCDPSession(page);
    const result = await cdp.send('Runtime.evaluate', {
      expression: `(${extractZhihuStateCards.toString()})()`,
      returnByValue: true,
    });
    if (result.exceptionDetails) return null;
    const value = result.result.value;
    return Array.isArray(value) ? value : null;
  } catch {
    return null;
  } finally {
    await cdp?.detach().catch(() => {});
  }
}

export async function runSiteAttempt(
  site: SiteSearchId,
  page: Page,
  query: string,
  urlOverride: string | undefined,
  emit: SiteEmit,
  remainingMs: number,
): Promise<SiteAttempt> {
  const config = SITE_SEARCH_CONFIG[site];
  const url = buildSiteUrl(site, query, urlOverride);
  emit({ action: 'navigate', url, detail: `导航到 ${config.label} 站内搜索结果页` });
  try {
    await page.goto(url, {
      waitUntil: 'domcontentloaded',
      timeout: Math.min(GOTO_TIMEOUT_MS, Math.max(1_000, remainingMs)),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    emit({ action: 'navigate', url, detail: message, result: 'nav_failed' });
    return {
      ok: false,
      failureKind: 'nav_failed',
      reason: `${config.label} 站内导航失败（网络或代理异常）：${message}`,
    };
  }

  if (site === 'zhihu') {
    emit({ action: 'wait', url, detail: '等待知乎搜索结果渲染' });
    await page
      .waitForSelector('.SearchResult-Card, .ContentItem', {
        timeout: Math.min(ZHIHU_RENDER_TIMEOUT_MS, Math.max(1_000, remainingMs)),
      })
      .catch(() => {});
    await page.waitForTimeout(300).catch(() => {});
    const stateItems = await readZhihuState(page);
    if (stateItems && stateItems.length > 0) {
      emit({
        action: 'parse',
        url: page.url(),
        detail: `知乎状态数据解析成功：${stateItems.length} 条结果`,
        result: `count=${stateItems.length}`,
      });
      return { ok: true, items: stateItems };
    }
  }

  emit({ action: 'parse', url: page.url(), detail: `开始解析 ${config.label} 搜索结果` });
  let items: ParsedSerpItem[];
  try {
    items = await page.evaluate(site === 'reddit' ? parseRedditSerp : parseZhihuSerp);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    emit({ action: 'parse', url: page.url(), detail: message, result: 'parse_empty' });
    return { ok: false, failureKind: 'parse_empty', reason: `${config.label} 结果解析异常：${message}` };
  }
  if (items.length === 0) {
    emit({
      action: 'parse',
      url: page.url(),
      detail: `${config.label} 结果解析为空（页面改版或无结果）`,
      result: 'parse_empty',
    });
    return { ok: false, failureKind: 'parse_empty', reason: `${config.label} 搜索结果解析为空` };
  }
  emit({
    action: 'parse',
    url: page.url(),
    detail: `${config.label} 解析成功：${items.length} 条结果`,
    result: `count=${items.length}`,
  });
  return { ok: true, items };
}
