import net from 'node:net';
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
import { getEmbeddedBrowserManager } from './embedded/embedded-browser-manager.js';
import {
  buildFetchFailure,
  closeFetchTab,
  DEFAULT_FETCH_WORKSPACE_ID,
  evalInTab,
  isTimeoutError,
  loadFetchTab,
  presentTabWindow,
  promoteFetchTab,
  sleep,
} from './embedded/fetch-page.js';
import { resolvePageState } from './embedded/page-state.js';
import { readTabText } from './embedded/ax-observe.js';
import type { EmbeddedTabRecord } from './embedded/types.js';
import { raiseHumanIntervention } from './human-intervention.js';
import {
  detectSerpPresence,
  parseGoogleSerp,
  parseDdgSerp,
  parseBingSerp,
  type ParsedSerpItem,
  type SerpParseFn,
  type SerpPresenceResult,
} from './serp-parsers.js';
import { consumeSearch, navigateGate } from './site-policy.js';
import { runSiteAttempt, SITE_SEARCH_CONFIG, type SiteSearchId } from './site-search.js';

const TASK_TIMEOUT_MS = 60_000;
const GOTO_TIMEOUT_MS = 15_000;
const PROBE_TIMEOUT_MS = 2_000;

const PARSE_RETRY_INTERVAL_MS = 500;
const PARSE_RETRY_MAX = 6;

const SERP_EXPLORE_HINT =
  '页面有结果但结构化解析失败，页面已保留，请用 observe_page 观察 + click 点击结果链接 + read_text 读取内容继续探索';

async function probeSerpPresence(tab: EmbeddedTabRecord, engine: SearchEngineId): Promise<SerpPresenceResult | null> {
  try {
    return await Promise.race([
      evalInTab(tab, detectSerpPresence(engine)),
      sleep(PROBE_TIMEOUT_MS).then(() => null),
    ]);
  } catch {
    return null;
  }
}

function presenceExplorable(presence: SerpPresenceResult | null): boolean {
  if (!presence) return true;
  return presence.containerFound || presence.linkCount >= 3;
}

async function readTabTextSafely(tab: EmbeddedTabRecord): Promise<string | undefined> {
  if (tab.state === 'crashed' || tab.state === 'loading') return undefined;
  try {
    return (await readTabText(tab)).text;
  } catch {
    return undefined;
  }
}

async function evalInTabWithRetry(tab: EmbeddedTabRecord, fn: SerpParseFn, remainingMs: () => number): Promise<ParsedSerpItem[]> {
  let last: ParsedSerpItem[] = [];
  for (let attempt = 0; attempt <= PARSE_RETRY_MAX; attempt++) {
    last = await evalInTab(tab, fn);
    if (last.length > 0 || remainingMs() <= PARSE_RETRY_INTERVAL_MS) return last;
    await new Promise((resolve) => setTimeout(resolve, PARSE_RETRY_INTERVAL_MS));
  }
  return last;
}

const PARSE_FNS: Record<SearchEngineId, SerpParseFn> = {
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

type EmitFn = (event: { action: 'navigate' | 'wait' | 'observe' | 'parse'; url?: string; detail?: string; result?: string }) => void;

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
 * 浏览器搜索（内嵌宿主快档）：内嵌后台 tab 加载 SERP（持久 partition，Cookie 信誉积累）→ 就绪后
 * 就地执行 SERP parser。引擎链 auto（代理探测）→ Google → DDG → Bing，失败逐级降级；
 * 全链失败时结构化返回失败上下文（页面保留在 tab，agent 用 observe_page/read_text 探索），
 * 验证页还会把内嵌窗口挂到主窗口供人工过验证。传 site 先走站内引擎，失败降级 site: 通用链。
 * 不 throw，错误归类在返回值里。
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
  const manager = getEmbeddedBrowserManager();
  const workspaceId = options?.workspaceId || DEFAULT_FETCH_WORKSPACE_ID;
  const taskMeta: BrowserTaskMeta = options?.taskMeta ?? { kind: 'agent' };
  const conversationId = taskMeta.conversationId;
  const holderId = conversationId ? `search:${conversationId}` : 'search';
  const onAction = options?.onAction;
  const emit: EmitFn = (event) => {
    const full = { taskMeta, ...event };
    if (onAction) onAction(full);
    else console.debug('[browser-search]', JSON.stringify(full));
  };
  const startAt = Date.now();
  const remainingMs = () => TASK_TIMEOUT_MS - (Date.now() - startAt);
  const maxResults = clampMaxResults(options?.maxResults);
  const engineConfig: SearchEngineConfig = options?.engine ?? 'auto';

  const chain = await buildEngineChain(engineConfig, options?.proxyServer, emit);
  const degradations: SearchDegradation[] = [];
  let effectiveQuery = trimmed;
  let siteDomainFilter: string | null = null;
  const tabBox: { current: EmbeddedTabRecord | null } = { current: null };
  let presentedVerification = false;

  const ensureTab = async (url: string, timeoutMs: number): Promise<EmbeddedTabRecord> => {
    if (tabBox.current) {
      await loadFetchTab(tabBox.current, url, timeoutMs);
      return tabBox.current;
    }
    const snapshot = manager.openTab({ workspaceId, url, source: 'agent-opened', holderId, skipInitialLoad: true });
    const record = manager.getTabRecord(snapshot.tabId);
    if (!record) throw new Error('内嵌浏览器标签创建失败');
    tabBox.current = record;
    await loadFetchTab(record, url, timeoutMs);
    return record;
  };

  const failOutcome = (engine: SearchTarget, errorClass: SearchErrorClass, message: string): SearchOutcome => ({
    ok: false,
    engine,
    query: effectiveQuery,
    errorClass,
    message,
    degradations,
    failure: tabBox.current ? buildFetchFailure(tabBox.current, resolvePageState(tabBox.current), true) : undefined,
  });

  const presentVerification = (current: EmbeddedTabRecord) => {
    if (presentedVerification) return;
    presentedVerification = true;
    presentTabWindow(manager, current);
  };

  const finishEngineFailure = (engine: SearchEngineId, reason: string): SearchOutcome | null => {
    const next = chain[chain.indexOf(engine) + 1];
    if (!next) {
      const errorClass: SearchErrorClass = remainingMs() <= 0 ? 'timeout' : 'parse_empty';
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
    try {
      await manager.ensureWorkspaceProxy(workspaceId, options?.proxyServer);
    } catch (err) {
      emit({
        action: 'wait',
        detail: `代理配置失败，本次直连：${err instanceof Error ? err.message : String(err)}`,
        result: 'proxy_error',
      });
    }

    const site = options?.site;
    if (site) {
      if (remainingMs() <= 0) {
        return failOutcome(site, 'timeout', `搜索任务超时（任务上限 ${TASK_TIMEOUT_MS / 1000} 秒）`);
      }
      const siteAttempt = await runSiteAttempt(site, ensureTab, trimmed, options?.serpUrls?.[site], emit, remainingMs());
      if (siteAttempt.ok) {
        const results = siteAttempt.items.slice(0, maxResults).map((item, idx) => ({
          rank: idx + 1,
          title: item.title,
          url: item.url,
          snippet: item.snippet,
          ...(item.meta ? { meta: item.meta } : {}),
        }));
        closeFetchTab(manager, tabBox.current?.tabId ?? null, holderId);
        tabBox.current = null;
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

      emit({ action: 'navigate', url, detail: `导航到 ${ENGINE_LABELS[engine]} 搜索结果页` });
      try {
        await ensureTab(url, Math.min(GOTO_TIMEOUT_MS, Math.max(1_000, remainingMs())));
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        emit({ action: 'navigate', url, detail: message, result: 'nav_failed' });
        const reason =
          engine === 'ddg' && !isTimeoutError(err)
            ? `DDG 连接失败（代理不可用或网络异常）：${message}`
            : `${ENGINE_LABELS[engine]} ${message}`;
        const outcome = finishEngineFailure(engine, reason);
        if (outcome) return outcome;
        continue;
      }
      if (gate.isSearch) consumeSearch(conversationId);

      const current = tabBox.current!;
      const pageText = await readTabTextSafely(current);
      const pageState = resolvePageState(current, pageText);
      if (pageState === 'verification_required') {
        emit({
          action: 'observe',
          url: current.url,
          detail: '搜索引擎返回人机验证页，已在内嵌浏览器窗口呈现，可在窗口人工完成验证（profile 会记住）',
          result: 'verification_page',
        });
        presentVerification(current);
        raiseHumanIntervention({
          tabId: current.tabId,
          reason: 'verification_required',
          message: `${ENGINE_LABELS[engine]} 返回人机验证页，请在内嵌浏览器窗口完成验证后点「完成后继续」`,
          url: current.url,
          taskMeta,
        });
        manager.release(current.tabId, holderId);
        tabBox.current = null;
        const outcome = finishEngineFailure(engine, `${ENGINE_LABELS[engine]} 返回验证页（已触发人机验证）`);
        if (outcome) return outcome;
        continue;
      }
      if (pageState !== 'ready') {
        const outcome = finishEngineFailure(engine, `${ENGINE_LABELS[engine]} 页面状态异常（${pageState}）`);
        if (outcome) return outcome;
        continue;
      }

      emit({ action: 'parse', url: current.url, detail: `开始解析 ${ENGINE_LABELS[engine]} 搜索结果` });
      let items: ParsedSerpItem[] | null = null;
      let failureReason = '';
      try {
        const parsed = await evalInTabWithRetry(current, PARSE_FNS[engine], remainingMs);
        if (parsed.length === 0) {
          failureReason = `${ENGINE_LABELS[engine]} 搜索结果解析为空（页面改版或无结果）`;
          emit({ action: 'parse', url: current.url, detail: failureReason, result: 'parse_empty' });
        } else {
          items = parsed;
        }
      } catch (err) {
        failureReason = `${ENGINE_LABELS[engine]} 结果解析异常：${err instanceof Error ? err.message : String(err)}`;
        emit({ action: 'parse', url: current.url, detail: failureReason, result: 'parse_empty' });
      }

      if (!items) {
        const presence = await probeSerpPresence(current, engine);
        if (presenceExplorable(presence)) {
          const message = `${ENGINE_LABELS[engine]} 页面存在可探索结果，但结构化解析失败，页面已保留，请改用浏览器探索工具继续`;
          emit({ action: 'parse', url: current.url, detail: message, result: 'explorable_page' });
          return {
            ok: false,
            engine,
            query: effectiveQuery,
            errorClass: 'parse_empty',
            message,
            degradations,
            failure: buildFetchFailure(current, resolvePageState(current, pageText), true, SERP_EXPLORE_HINT),
          };
        }
      }

      if (items && siteDomainFilter) {
        const domain = siteDomainFilter;
        const kept = items.filter((item) => urlMatchesDomain(item.url, domain));
        if (kept.length === 0) {
          emit({
            action: 'parse',
            url: current.url,
            detail: `site:${domain} 域名过滤后无匹配结果（site: 语法被 ${ENGINE_LABELS[engine]} 忽略），视为该引擎失败`,
            result: 'parse_empty',
          });
          items = null;
          failureReason = `${ENGINE_LABELS[engine]} 结果经 site:${domain} 域名过滤后无匹配`;
        } else {
          if (kept.length < items.length) {
            emit({
              action: 'parse',
              url: current.url,
              detail: `site:${domain} 域名过滤：剔除 ${items.length - kept.length} 条非目标域结果`,
              result: `count=${kept.length}`,
            });
          }
          items = kept;
        }
      }
      if (items) {
        const results = items.slice(0, maxResults).map((item, idx) => ({
          rank: idx + 1,
          title: item.title,
          url: item.url,
          snippet: item.snippet,
        }));
        closeFetchTab(manager, current.tabId, holderId);
        tabBox.current = null;
        return { ok: true, engine, query: effectiveQuery, results, degradations };
      }
      const outcome = finishEngineFailure(engine, failureReason);
      if (outcome) return outcome;
    }
    return failOutcome(chain[chain.length - 1], 'parse_empty', '搜索引擎链为空，无法执行搜索');
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (isTimeoutError(err)) {
      emit({ action: 'wait', detail: message, result: 'timeout' });
      return failOutcome(chain[chain.length - 1], 'timeout', `浏览器搜索任务超时：${message}`);
    }
    emit({ action: 'observe', detail: message, result: 'browser_crash' });
    return failOutcome(chain[chain.length - 1], 'browser_crash', `浏览器搜索失败：${message}`);
  } finally {
    promoteFetchTab(manager, tabBox.current?.tabId ?? null, holderId);
  }
}
