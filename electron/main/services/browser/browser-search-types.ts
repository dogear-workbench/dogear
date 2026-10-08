import type { BrowserTaskMeta } from './browser-task-meta.js';
import type { FetchFailureContext } from './embedded/fetch-page.js';
import type { SiteSearchId } from './site-search.js';

export type SearchEngineId = 'google' | 'ddg' | 'bing';
export type SearchEngineConfig = 'auto' | SearchEngineId;
export type SearchTarget = SearchEngineId | SiteSearchId;

export type SearchErrorClass = 'empty_query' | 'parse_empty' | 'timeout' | 'nav_failed' | 'browser_crash';

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
      /** 全链失败但页面已保留在内嵌 tab 时的探索上下文（pageAvailable=true 表示可继续观察） */
      failure?: FetchFailureContext;
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
  /** 内嵌宿主 workspace（决定持久 partition/Cookie 信誉），agent 场景必传，缺省落独立抓取工作区 */
  workspaceId?: string;
}

export const DEFAULT_MAX_RESULTS = 8;
export const MAX_RESULTS_LIMIT = 15;

export const SERP_URL_TEMPLATES: Record<SearchEngineId, string> = {
  google: 'https://www.google.com/search?q={q}',
  ddg: 'https://duckduckgo.com/?q={q}',
  bing: 'https://cn.bing.com/search?q={q}',
};

export const ENGINE_LABELS: Record<SearchTarget, string> = {
  google: 'Google',
  ddg: 'DuckDuckGo',
  bing: 'Bing',
  reddit: 'Reddit',
  zhihu: '知乎',
};

export function clampMaxResults(maxResults?: number): number {
  if (maxResults === undefined || Number.isNaN(maxResults)) return DEFAULT_MAX_RESULTS;
  return Math.min(Math.max(Math.floor(maxResults), 1), MAX_RESULTS_LIMIT);
}

export function buildSerpUrl(engine: SearchEngineId, query: string, override?: SearchSerpUrls): string {
  const template = override?.[engine] ?? SERP_URL_TEMPLATES[engine];
  return template.replace('{q}', encodeURIComponent(query));
}
