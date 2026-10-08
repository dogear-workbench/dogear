import type { BrowserTaskMeta } from './browser-task-meta.js';
import type { FetchFailureContext } from './embedded/fetch-page.js';

export type ReadArticleErrorClass = 'need_login' | 'timeout' | 'parse_empty' | 'browser_crash';

export interface BrowserArticleMeta {
  url: string;
  title: string;
  author: string | null;
  siteName: string | null;
  excerpt: string | null;
  wordCount: number;
  language: string | null;
  content: string;
  qualityHint?: string;
}

export type ReadArticleResult =
  | { ok: true; meta: BrowserArticleMeta }
  | {
      ok: false;
      errorClass: ReadArticleErrorClass;
      message: string;
      /** 失败时页面保留在内嵌 tab 的探索上下文（need_login/parse_empty 等场景非空） */
      failure?: FetchFailureContext;
    };

export type BrowserArticleAction = 'navigate' | 'wait' | 'click' | 'observe' | 'parse';

export interface BrowserArticleActionEvent {
  taskMeta: BrowserTaskMeta;
  action: BrowserArticleAction;
  url?: string;
  detail?: string;
  result?: string;
}

export type OnBrowserArticleAction = (event: BrowserArticleActionEvent) => void;

export type ArticleEmitFn = (event: Omit<BrowserArticleActionEvent, 'taskMeta'>) => void;

export interface ReadArticleWithBrowserOptions {
  taskMeta?: BrowserTaskMeta;
  onAction?: OnBrowserArticleAction;
  /** 内嵌宿主 workspace（决定持久 partition/登录态），agent 场景必传，缺省落独立抓取工作区 */
  workspaceId?: string;
}
