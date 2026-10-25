/**
 * SERP 纯 HTTP 抓取（主进程 net.fetch）
 *
 * 请求走独立 partition session（无 Cookie 积累），配置代理时 setProxy 到该 session
 * （auto 引擎链的代理语义由此承接）；UA 与文章抓取共用 DESKTOP_USER_AGENT。
 */
import { session } from 'electron';
import { DESKTOP_USER_AGENT } from '../article/fetch.js';

const SEARCH_PARTITION = 'dogear-serp-fetch';
export const SERP_FETCH_TIMEOUT_MS = 15_000;

export type SerpFetchErrorKind = 'timeout' | 'http' | 'network';

export class SerpFetchError extends Error {
  readonly kind: SerpFetchErrorKind;
  readonly status?: number;
  readonly url: string;

  constructor(kind: SerpFetchErrorKind, url: string, message: string, status?: number) {
    super(message);
    this.name = 'SerpFetchError';
    this.kind = kind;
    this.url = url;
    if (status !== undefined) this.status = status;
  }
}

export interface SerpFetchResult {
  html: string;
  /** 跟随重定向后的最终 URL（登录页重定向检测依赖它） */
  url: string;
  status: number;
}

let cachedProxyRules: string | null = null;

async function serpSession(proxyServer: string | undefined) {
  const s = session.fromPartition(SEARCH_PARTITION);
  const rules = (proxyServer ?? '').trim();
  if (cachedProxyRules !== rules) {
    await s.setProxy(rules ? { proxyRules: rules } : { mode: 'direct' });
    cachedProxyRules = rules;
  }
  return s;
}

function isAbortTimeout(err: unknown): boolean {
  return err instanceof Error && (err.name === 'TimeoutError' || err.name === 'AbortError');
}

export async function fetchSerpHtml(
  url: string,
  opts?: { proxyServer?: string; timeoutMs?: number },
): Promise<SerpFetchResult> {
  const timeoutMs = opts?.timeoutMs ?? SERP_FETCH_TIMEOUT_MS;
  let response: Response;
  try {
    response = await (await serpSession(opts?.proxyServer)).fetch(url, {
      headers: {
        'User-Agent': DESKTOP_USER_AGENT,
        'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
      },
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (err) {
    if (isAbortTimeout(err)) {
      throw new SerpFetchError('timeout', url, `请求超时（${Math.round(timeoutMs / 1000)}s），页面未返回`);
    }
    const message = err instanceof Error ? err.message : String(err);
    throw new SerpFetchError('network', url, `网络请求失败：${message}`);
  }
  if (!response.ok) {
    throw new SerpFetchError('http', response.url || url, `HTTP ${response.status} ${response.statusText}`, response.status);
  }
  let html: string;
  try {
    html = await response.text();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new SerpFetchError('network', response.url || url, `响应读取失败：${message}`);
  }
  return { html, url: response.url || url, status: response.status };
}
