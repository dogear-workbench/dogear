import net from 'node:net';
import { parseHTML } from 'linkedom';
import type { BrowserTaskMeta } from './browser-task-meta.js';
import {
  buildSerpUrl,
  clampMaxResults,
  ENGINE_LABELS,
  type OnSearchAction,
  type SearchDegradation,
  type SearchEngineConfig,
  type SearchEngineId,
  type SearchErrorClass,
  type SearchOutcome,
  type SearchTarget,
  type SearchWebOptions,
} from './browser-search-types.js';
import { fetchSerpHtml, SerpFetchError } from './serp-http.js';
import {
  parseGoogleSerp,
  parseDdgSerp,
  parseBingSerp,
  type ParsedSerpItem,
} from './serp-parsers.js';
import { consumeSearch, navigateGate } from './site-policy.js';
import { runSiteAttempt, SITE_SEARCH_CONFIG, type SiteSearchId } from './site-search.js';

const TASK_TIMEOUT_MS = 60_000;

const SERP_PARSE_FNS: Record<SearchEngineId, (document: ReturnType<typeof parseHTML>['document'], baseUrl: string) => ParsedSerpItem[]> = {
  google: parseGoogleSerp,
  ddg: parseDdgSerp,
  bing: parseBingSerp,
};

function urlMatchesDomain(url: string, domain: string): boolean {
  try {
    const host = new URL(url).hostname.toLowerCase();
    return host === domain || host.endsWith(`.${domain}`);
  } catch {
    return false;
  }
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

export function probeProxyServer(proxyServer: string, timeoutMs = 2_000): Promise<boolean> {
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

type EmitFn = (event: { action: 'navigate' | 'observe' | 'parse'; url?: string; detail?: string; result?: string }) => void;

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

/**
 * 网页搜索（纯 HTTP 快档）：主进程 net.fetch 抓取 SERP 页面 → linkedom 解析（serp-parsers）。
 * 引擎链 auto（代理探测）→ Google → DDG → Bing，失败逐级降级；纯 HTTP 无登录态与 JS 渲染，
 * 解析为空或请求失败时结构化返回失败上下文（不保留页面，由工具层提示导航搜索引擎页兜底）。
 * 传 site 先走站内引擎，失败降级 site: 通用链。不 throw，错误归类在返回值里。
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
  const taskMeta: BrowserTaskMeta = options?.taskMeta ?? { kind: 'agent' };
  const conversationId = taskMeta.conversationId;
  const onAction = options?.onAction;
  const emit: EmitFn = (event) => {
    const full = { taskMeta, ...event };
    if (onAction) onAction(full);
    else console.debug('[serp-search]', JSON.stringify(full));
  };
  const startAt = Date.now();
  const remainingMs = () => TASK_TIMEOUT_MS - (Date.now() - startAt);
  const maxResults = clampMaxResults(options?.maxResults);
  const engineConfig: SearchEngineConfig = options?.engine ?? 'auto';
  const proxyServer = options?.proxyServer;

  const chain = await buildEngineChain(engineConfig, proxyServer, emit);
  const degradations: SearchDegradation[] = [];
  let effectiveQuery = trimmed;
  let siteDomainFilter: string | null = null;

  const failOutcome = (engine: SearchTarget, errorClass: SearchErrorClass, message: string): SearchOutcome => ({
    ok: false,
    engine,
    query: effectiveQuery,
    errorClass,
    message,
    degradations,
  });

  const finishEngineFailure = (engine: SearchEngineId, reason: string, errorClassHint?: SearchErrorClass): SearchOutcome | null => {
    const next = chain[chain.indexOf(engine) + 1];
    if (!next) {
      const errorClass: SearchErrorClass = errorClassHint ?? (remainingMs() <= 0 ? 'timeout' : 'parse_empty');
      return failOutcome(engine, errorClass, `所有搜索引擎均失败：${reason}`);
    }
    degradations.push({ from: engine, to: next, reason });
    emit({
      action: 'observe',
      detail: `${ENGINE_LABELS[engine]} 失败，降级到 ${ENGINE_LABELS[next]}：${reason}`,
      result: 'degrade',
    });
    return null;
  };

  try {
    const site = options?.site;
    if (site) {
      if (remainingMs() <= 0) {
        return failOutcome(site, 'timeout', `搜索任务超时（任务上限 ${TASK_TIMEOUT_MS / 1000} 秒）`);
      }
      const siteAttempt = await runSiteAttempt(site, trimmed, options?.serpUrls?.[site], emit, remainingMs(), proxyServer);
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
      siteDomainFilter = siteConfig.domain;
      degradations.push({ from: site, to: chain[0], reason: siteAttempt.reason });
      emit({
        action: 'observe',
        detail: `${siteConfig.label} 站内搜索失败，降级为通用搜索「${effectiveQuery}」：${siteAttempt.reason}`,
        result: 'degrade',
      });
    }

    for (const engine of chain) {
      if (remainingMs() <= 0) {
        return failOutcome(engine, 'timeout', `搜索任务超时（任务上限 ${TASK_TIMEOUT_MS / 1000} 秒）`);
      }
      const url = buildSerpUrl(engine, effectiveQuery, options?.serpUrls);
      const gate = await navigateGate(conversationId, url);
      if ('blocked' in gate) {
        emit({ action: 'navigate', url, detail: gate.blocked, result: 'blocked' });
        return failOutcome(engine, 'nav_failed', gate.blocked);
      }

      emit({ action: 'navigate', url, detail: `请求 ${ENGINE_LABELS[engine]} 搜索结果页` });
      let html: string;
      let finalUrl = url;
      try {
        const fetched = await fetchSerpHtml(url, {
          proxyServer,
          timeoutMs: Math.min(15_000, Math.max(1_000, remainingMs())),
        });
        html = fetched.html;
        finalUrl = fetched.url;
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        emit({ action: 'navigate', url, detail: message, result: 'nav_failed' });
        const outcome = finishEngineFailure(
          engine,
          `${ENGINE_LABELS[engine]} ${message}`,
          err instanceof SerpFetchError && err.kind === 'timeout' ? 'timeout' : 'nav_failed',
        );
        if (outcome) return outcome;
        continue;
      }
      if (gate.isSearch) consumeSearch(conversationId);

      emit({ action: 'parse', url: finalUrl, detail: `开始解析 ${ENGINE_LABELS[engine]} 搜索结果` });
      let items: ParsedSerpItem[] = [];
      try {
        const { document } = parseHTML(html);
        items = SERP_PARSE_FNS[engine](document, finalUrl);
      } catch (err) {
        emit({
          action: 'parse',
          url: finalUrl,
          detail: `${ENGINE_LABELS[engine]} 结果解析异常：${err instanceof Error ? err.message : String(err)}`,
          result: 'parse_empty',
        });
      }

      if (items.length === 0) {
        const outcome = finishEngineFailure(engine, `${ENGINE_LABELS[engine]} 搜索结果解析为空（页面改版、无结果或反爬拦截）`);
        if (outcome) return outcome;
        continue;
      }

      if (siteDomainFilter) {
        const domain = siteDomainFilter;
        const kept = items.filter((item) => urlMatchesDomain(item.url, domain));
        if (kept.length === 0) {
          emit({
            action: 'parse',
            url: finalUrl,
            detail: `site:${domain} 域名过滤后无匹配结果（site: 语法被 ${ENGINE_LABELS[engine]} 忽略），视为该引擎失败`,
            result: 'parse_empty',
          });
          const outcome = finishEngineFailure(engine, `${ENGINE_LABELS[engine]} 结果经 site:${domain} 域名过滤后无匹配`);
          if (outcome) return outcome;
          continue;
        }
        if (kept.length < items.length) {
          emit({
            action: 'parse',
            url: finalUrl,
            detail: `site:${domain} 域名过滤：剔除 ${items.length - kept.length} 条非目标域结果`,
            result: `count=${kept.length}`,
          });
        }
        items = kept;
      }

      const results = items.slice(0, maxResults).map((item, idx) => ({
        rank: idx + 1,
        title: item.title,
        url: item.url,
        snippet: item.snippet,
      }));
      return { ok: true, engine, query: effectiveQuery, results, degradations };
    }
    return failOutcome(chain[chain.length - 1], 'parse_empty', '搜索引擎链为空，无法执行搜索');
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    emit({ action: 'observe', detail: message, result: 'error' });
    return failOutcome(chain[chain.length - 1], 'nav_failed', `搜索失败：${message}`);
  }
}
