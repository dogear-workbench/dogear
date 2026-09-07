import net from 'node:net';
import type { Page } from 'patchright';
import { getBrowserManager, type BrowserTaskMeta } from './browser-manager.js';
import {
  parseGoogleSerp,
  parseDdgSerp,
  parseBingSerp,
  type ParsedSerpItem,
  type SerpParseFn,
} from './serp-parsers.js';
import { runSiteAttempt, SITE_SEARCH_CONFIG, type SiteSearchId } from './site-search.js';

export type SearchEngineId = 'google' | 'ddg' | 'bing';
export type SearchEngineConfig = 'auto' | SearchEngineId;
export type SearchTarget = SearchEngineId | SiteSearchId;

export type SearchErrorClass = 'empty_query' | 'parse_empty' | 'timeout' | 'browser_crash';

export interface SearchResultItem {
  rank: number;
  title: string;
  url: string;
  snippet: string;
  meta?: string;
}

export interface SearchDegradation {
  from: SearchTarget;
  to: SearchTarget;
  reason: string;
}

export type SearchOutcome =
  | {
      ok: true;
      engine: SearchTarget;
      query: string;
      results: SearchResultItem[];
      degradations: SearchDegradation[];
    }
  | {
      ok: false;
      engine: SearchTarget;
      query: string;
      errorClass: SearchErrorClass;
      message: string;
      degradations: SearchDegradation[];
    };

export type SearchAction = 'navigate' | 'wait' | 'observe' | 'parse';

export interface SearchActionEvent {
  taskMeta: BrowserTaskMeta;
  action: SearchAction;
  url?: string;
  detail?: string;
  result?: string;
}

export type OnSearchAction = (event: SearchActionEvent) => void;

export interface SearchSerpUrls {
  google?: string;
  ddg?: string;
  bing?: string;
  reddit?: string;
  zhihu?: string;
}

export interface SearchWebOptions {
  engine?: SearchEngineConfig;
  site?: SiteSearchId;
  maxResults?: number;
  proxyServer?: string;
  taskMeta?: BrowserTaskMeta;
  onAction?: OnSearchAction;
  serpUrls?: SearchSerpUrls;
}

const TASK_TIMEOUT_MS = 60_000;
const GOTO_TIMEOUT_MS = 15_000;
const PROBE_TIMEOUT_MS = 2_000;
export const DEFAULT_MAX_RESULTS = 8;
export const MAX_RESULTS_LIMIT = 15;

const SERP_URL_TEMPLATES: Record<SearchEngineId, string> = {
  google: 'https://www.google.com/search?q={q}',
  ddg: 'https://html.duckduckgo.com/html/?q={q}',
  bing: 'https://cn.bing.com/search?q={q}',
};

const ENGINE_LABELS: Record<SearchTarget, string> = {
  google: 'Google',
  ddg: 'DuckDuckGo',
  bing: 'Bing',
  reddit: 'Reddit',
  zhihu: '知乎',
};

const PARSE_FNS: Record<SearchEngineId, SerpParseFn> = {
  google: parseGoogleSerp,
  ddg: parseDdgSerp,
  bing: parseBingSerp,
};

export function clampMaxResults(maxResults?: number): number {
  if (maxResults === undefined || Number.isNaN(maxResults)) return DEFAULT_MAX_RESULTS;
  return Math.min(Math.max(Math.floor(maxResults), 1), MAX_RESULTS_LIMIT);
}

function parseProxyEndpoint(proxyServer: string): { host: string; port: number } | null {
  const raw = proxyServer.trim().replace(/^[a-z]+:\/\//i, '');
  const idx = raw.lastIndexOf(':');
  if (idx <= 0) return null;
  const host = raw.slice(0, idx);
  const port = Number(raw.slice(idx + 1));
  if (!host || !Number.isInteger(port) || port <= 0 || port > 65535) return null;
  return { host, port };
}

export function probeProxyServer(proxyServer: string, timeoutMs = PROBE_TIMEOUT_MS): Promise<boolean> {
  const endpoint = parseProxyEndpoint(proxyServer);
  if (!endpoint) return Promise.resolve(false);
  return new Promise((resolve) => {
    let settled = false;
    const done = (ok: boolean) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(ok);
    };
    const socket = net.connect({ host: endpoint.host, port: endpoint.port });
    socket.setTimeout(timeoutMs, () => done(false));
    socket.once('connect', () => done(true));
    socket.once('error', () => done(false));
  });
}

function buildSerpUrl(engine: SearchEngineId, query: string, override?: SearchSerpUrls): string {
  const template = override?.[engine] ?? SERP_URL_TEMPLATES[engine];
  return template.replace('{q}', encodeURIComponent(query));
}

type EngineFailureKind = 'verification_page' | 'proxy_unreachable' | 'parse_empty' | 'nav_failed';

interface EngineAttempt {
  ok: boolean;
  items?: ParsedSerpItem[];
  reason?: string;
  failureKind?: EngineFailureKind;
}

type EmitFn = (event: Omit<SearchActionEvent, 'taskMeta'>) => void;

async function runEngineAttempt(
  engine: SearchEngineId,
  page: Page,
  query: string,
  serpUrls: SearchSerpUrls | undefined,
  emit: EmitFn,
  remainingMs: number,
): Promise<EngineAttempt> {
  const url = buildSerpUrl(engine, query, serpUrls);
  const label = ENGINE_LABELS[engine];
  emit({ action: 'navigate', url, detail: `导航到 ${label} 搜索结果页` });
  try {
    await page.goto(url, {
      waitUntil: 'domcontentloaded',
      timeout: Math.min(GOTO_TIMEOUT_MS, Math.max(1_000, remainingMs)),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    emit({ action: 'navigate', url, detail: message, result: 'nav_failed' });
    if (engine === 'ddg') {
      return {
        ok: false,
        failureKind: 'proxy_unreachable',
        reason: `DDG 连接失败（代理不可用或网络异常）：${message}`,
      };
    }
    return { ok: false, failureKind: 'nav_failed', reason: `${label} 导航失败：${message}` };
  }

  if (engine === 'google' && page.url().includes('/sorry/')) {
    emit({
      action: 'observe',
      url: page.url(),
      detail: 'Google 返回验证页，可在浏览器窗口人工完成验证（profile 会记住）',
      result: 'verification_page',
    });
    return {
      ok: false,
      failureKind: 'verification_page',
      reason: 'Google 返回验证页（/sorry/），已触发人机验证',
    };
  }

  emit({ action: 'parse', url: page.url(), detail: `开始解析 ${label} 搜索结果` });
  let items: ParsedSerpItem[];
  try {
    items = await page.evaluate(PARSE_FNS[engine]);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    emit({ action: 'parse', url: page.url(), detail: message, result: 'parse_empty' });
    return { ok: false, failureKind: 'parse_empty', reason: `${label} 结果解析异常：${message}` };
  }
  if (items.length === 0) {
    emit({
      action: 'parse',
      url: page.url(),
      detail: `${label} 结果解析为空（页面改版或无结果）`,
      result: 'parse_empty',
    });
    return { ok: false, failureKind: 'parse_empty', reason: `${label} 搜索结果解析为空` };
  }
  emit({
    action: 'parse',
    url: page.url(),
    detail: `${label} 解析成功：${items.length} 条结果`,
    result: `count=${items.length}`,
  });
  return { ok: true, items };
}

/**
 * 浏览器搜索：引擎编排（auto 代理探测 / 降级链 Google → DDG → Bing）+ 验证页检测 + SERP 解析。
 * 传 site 时先走站内引擎（reddit/zhihu），失败自动降级 site: 通用链，原因记入 degradations。
 * 不 throw，错误归类在返回值里；三级全失败才整体失败。
 */
export async function searchWeb(query: string, options?: SearchWebOptions): Promise<SearchOutcome> {
  const trimmed = query.trim();
  if (!trimmed) {
    return {
      ok: false,
      engine: 'bing',
      query,
      errorClass: 'empty_query',
      message: '搜索关键词为空',
      degradations: [],
    };
  }
  const maxResults = clampMaxResults(options?.maxResults);
  const engineConfig: SearchEngineConfig = options?.engine ?? 'auto';
  const manager = getBrowserManager();
  const taskMeta: BrowserTaskMeta = options?.taskMeta ?? { kind: 'agent' };
  const onAction = options?.onAction;
  const emit: EmitFn = (event) => {
    const full: SearchActionEvent = { taskMeta, ...event };
    if (onAction) onAction(full);
    else console.debug('[browser-search]', JSON.stringify(full));
  };

  const startAt = Date.now();
  const remainingMs = () => TASK_TIMEOUT_MS - (Date.now() - startAt);

  const chain = await buildEngineChain(engineConfig, options?.proxyServer, emit);
  const degradations: SearchDegradation[] = [];
  let effectiveQuery = trimmed;

  try {
    emit({ action: 'wait', detail: '等待浏览器实例' });
    const acquirePromise = manager.acquire(taskMeta);
    acquirePromise.catch(() => {});
    const acquired = await Promise.race([
      acquirePromise.then((lease) => ({ kind: 'acquired' as const, lease })),
      new Promise<{ kind: 'expired' }>((resolve) =>
        setTimeout(() => resolve({ kind: 'expired' }), Math.max(1, remainingMs())),
      ),
    ]);
    if (acquired.kind === 'expired') {
      void acquirePromise.then((l) => l.release()).catch(() => {});
      emit({ action: 'wait', detail: '等待浏览器实例', result: 'timeout' });
      return {
        ok: false,
        engine: chain[chain.length - 1],
        query: trimmed,
        errorClass: 'timeout',
        message: `等待浏览器实例超时（任务上限 ${TASK_TIMEOUT_MS / 1000} 秒，含排队时间）`,
        degradations,
      };
    }

    const lease = acquired.lease;
    const page = lease.page;
    try {
      const site = options?.site;
      if (site) {
        if (remainingMs() <= 0) {
          return {
            ok: false,
            engine: site,
            query: trimmed,
            errorClass: 'timeout',
            message: `搜索任务超时（任务上限 ${TASK_TIMEOUT_MS / 1000} 秒）`,
            degradations,
          };
        }
        const siteAttempt = await runSiteAttempt(
          site,
          page,
          trimmed,
          options?.serpUrls?.[site],
          emit,
          remainingMs(),
        );
        if (siteAttempt.ok) {
          const results = siteAttempt.items.slice(0, maxResults).map((item, idx) => ({
            rank: idx + 1,
            title: item.title,
            url: item.url,
            snippet: item.snippet,
            ...(item.meta ? { meta: item.meta } : {}),
          }));
          return { ok: true, engine: site, query: trimmed, results, degradations };
        }
        const siteConfig = SITE_SEARCH_CONFIG[site];
        effectiveQuery = `${trimmed} site:${siteConfig.domain}`;
        degradations.push({ from: site, to: chain[0], reason: siteAttempt.reason });
        emit({
          action: 'observe',
          detail: `${siteConfig.label} 站内搜索失败，降级为通用搜索「${effectiveQuery}」：${siteAttempt.reason}`,
          result: 'degrade',
        });
      }
      for (let i = 0; i < chain.length; i++) {
        const engine = chain[i];
        if (remainingMs() <= 0) {
          return {
            ok: false,
            engine,
            query: effectiveQuery,
            errorClass: 'timeout',
            message: `搜索任务超时（任务上限 ${TASK_TIMEOUT_MS / 1000} 秒）`,
            degradations,
          };
        }
        const attempt = await runEngineAttempt(
          engine,
          page,
          effectiveQuery,
          options?.serpUrls,
          emit,
          remainingMs(),
        );
        if (attempt.ok && attempt.items) {
          const results = attempt.items.slice(0, maxResults).map((item, idx) => ({
            rank: idx + 1,
            title: item.title,
            url: item.url,
            snippet: item.snippet,
          }));
          return { ok: true, engine, query: effectiveQuery, results, degradations };
        }
        const next = chain[i + 1];
        if (!next) {
          const errorClass: SearchErrorClass =
            attempt.failureKind === 'nav_failed' && remainingMs() <= 0 ? 'timeout' : 'parse_empty';
          const message =
            attempt.failureKind === 'parse_empty'
              ? `所有搜索引擎均未能解析出结果（${degradations
                  .map((d) => `${ENGINE_LABELS[d.from]}：${d.reason}`)
                  .join('；')}；${ENGINE_LABELS[engine]}：${attempt.reason}）。建议换用其他引擎，或降级用 dogear__browser__navigate + observe_page 手动探索`
              : `所有搜索引擎均失败：${attempt.reason}。可降级用 dogear__browser__navigate + observe_page 手动探索`;
          return {
            ok: false,
            engine,
            query: effectiveQuery,
            errorClass,
            message,
            degradations,
          };
        }
        degradations.push({ from: engine, to: next, reason: attempt.reason ?? '未知原因' });
        emit({
          action: 'observe',
          detail: `${ENGINE_LABELS[engine]} 失败，降级到 ${ENGINE_LABELS[next]}：${attempt.reason}`,
          result: 'degrade',
        });
      }
      return {
        ok: false,
        engine: chain[chain.length - 1],
        query: effectiveQuery,
        errorClass: 'parse_empty',
        message: '搜索引擎链为空，无法执行搜索',
        degradations,
      };
    } finally {
      lease.release();
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (err instanceof Error && err.name === 'TimeoutError') {
      emit({ action: 'wait', detail: message, result: 'timeout' });
      return {
        ok: false,
        engine: chain[chain.length - 1],
        query: effectiveQuery,
        errorClass: 'timeout',
        message: `浏览器搜索任务超时：${message}`,
        degradations,
      };
    }
    emit({ action: 'observe', detail: message, result: 'browser_crash' });
    return {
      ok: false,
      engine: chain[chain.length - 1],
      query: effectiveQuery,
      errorClass: 'browser_crash',
      message: `浏览器搜索失败：${message}`,
      degradations,
    };
  }
}

async function buildEngineChain(
  engineConfig: SearchEngineConfig,
  proxyServer: string | undefined,
  emit: EmitFn,
): Promise<SearchEngineId[]> {
  if (engineConfig === 'bing') return ['bing'];
  if (engineConfig === 'ddg') return ['ddg', 'bing'];
  if (engineConfig === 'google') return ['google', 'ddg', 'bing'];
  const proxy = (proxyServer ?? '').trim();
  if (!proxy) {
    emit({ action: 'observe', detail: '未配置代理，auto 引擎直接使用 Bing', result: 'no_proxy' });
    return ['bing'];
  }
  emit({ action: 'observe', detail: `探测代理连通性：${proxy}`, result: 'probing' });
  const proxyOk = await probeProxyServer(proxy);
  emit({
    action: 'observe',
    detail: proxyOk ? '代理可用，从 Google 开始搜索' : '代理不可用，跳过代理引擎直接使用 Bing',
    result: proxyOk ? 'proxy_ok' : 'proxy_unreachable',
  });
  return proxyOk ? ['google', 'ddg', 'bing'] : ['bing'];
}
