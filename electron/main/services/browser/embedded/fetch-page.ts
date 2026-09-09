import type { EmbeddedBrowserManager } from './embedded-browser-manager.js';
import { waitTabReady } from './navigate.js';
import { presentRecordToCompanion } from './presentation.js';
import type { EmbeddedTabRecord } from './types.js';

const FETCH_NAV_TIMEOUT_MS = 20_000;

export const DEFAULT_FETCH_WORKSPACE_ID = 'embedded-fetch';

export const SUGGESTED_FETCH_FALLBACK_TOOLS = ['dogear__browser__observe_page', 'dogear__browser__read_text'] as const;

/**
 * search/readArticle 快档失败时的结构化上下文：页面保留在 tab 里给 agent 探索。
 * pageAvailable=false 表示页面停在错误页（nav_failed），观察无意义。
 */
export interface FetchFailureContext {
  pageAvailable: boolean;
  tabId: string | null;
  url: string | null;
  pageState: string | null;
  suggestedNextTools: string[];
  hint?: string;
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function isTimeoutError(err: unknown): boolean {
  return err instanceof Error && /超时/.test(err.message);
}

/** 导航失败（含超时）：url 为失败时刻的 tab.url，供调用方做跳转后判定（如 Reddit 登录页） */
export class FetchNavError extends Error {
  readonly url: string;

  constructor(message: string, url: string) {
    super(message);
    this.url = url;
  }
}

export async function loadFetchTab(tab: EmbeddedTabRecord, url: string, timeoutMs = FETCH_NAV_TIMEOUT_MS): Promise<string> {
  const contents = tab.view.webContents;
  let settled = false;
  const fail = (message: string) => {
    if (settled) return;
    settled = true;
    throw new FetchNavError(message, tab.url);
  };
  const nav = contents.loadURL(url).catch((err) => {
    if (settled) return undefined;
    const message = err instanceof Error ? err.message : String(err);
    fail(`导航失败：${message}`);
    return undefined;
  });
  const timer = sleep(timeoutMs).then(() => {
    fail(`页面加载超时（${Math.round(timeoutMs / 1000)}s），导航未完成`);
  });
  try {
    await Promise.race([nav, timer]);
  } finally {
    settled = true;
    nav.catch(() => {});
    timer.catch(() => {});
  }
  await waitTabReady(tab, timeoutMs);
  return tab.url;
}

export async function evalInTab<R>(tab: EmbeddedTabRecord, fn: (...args: never[]) => R, arg?: unknown): Promise<R> {
  const argsSource = arg === undefined ? '' : JSON.stringify(arg);
  return (await tab.view.webContents.executeJavaScript(`(${fn.toString()})(${argsSource})`)) as R;
}

export async function getTabHtml(tab: EmbeddedTabRecord): Promise<string> {
  return tab.view.webContents.executeJavaScript('document.documentElement.outerHTML');
}

const clickBySelectorFn = new Function(`return (sel) => {
  const el = document.querySelector(sel);
  if (!el) return false;
  el.click();
  return true;
}`)() as (sel: string) => boolean;

export async function clickBySelector(tab: EmbeddedTabRecord, selector: string): Promise<boolean> {
  return evalInTab(tab, clickBySelectorFn, selector);
}

export function closeFetchTab(manager: EmbeddedBrowserManager, tabId: string | null, holderId: string): void {
  if (!tabId) return;
  manager.release(tabId, holderId);
  manager.closeTab(tabId);
}

/** 失败保留页交给 agent：promote 为当前 agent tab 并释放服务持有（TTL 兜底回收） */
export function promoteFetchTab(manager: EmbeddedBrowserManager, tabId: string | null, holderId: string): void {
  if (!tabId) return;
  manager.promoteToAgentTab(tabId);
  manager.release(tabId, holderId);
}

/** 验证页/登录页递到用户面前：挂 companion 页面视图区（无面板时全屏兑底） */
export function presentTabWindow(manager: EmbeddedBrowserManager, tab: EmbeddedTabRecord): void {
  presentRecordToCompanion(manager, tab);
}

export function buildFetchFailure(
  tab: EmbeddedTabRecord | null,
  pageState: string | null,
  pageAvailable: boolean,
  hint?: string,
): FetchFailureContext | undefined {
  if (!tab) return undefined;
  return {
    pageAvailable,
    tabId: tab.tabId,
    url: tab.url,
    pageState,
    suggestedNextTools: [...SUGGESTED_FETCH_FALLBACK_TOOLS],
    ...(hint ? { hint } : {}),
  };
}

/** readArticle 等声明式流程的页面原语集合：与 Patchright Page 的使用面一一对应 */
export interface FetchPageOps {
  url(): string;
  state(): string;
  evaluate<R>(fn: (...args: never[]) => R, arg?: unknown): Promise<R>;
  content(): Promise<string>;
  click(selector: string): Promise<boolean>;
  waitForTimeout(ms: number): Promise<void>;
  presentWindow(): void;
}

export function createFetchPageOps(manager: EmbeddedBrowserManager, tab: EmbeddedTabRecord): FetchPageOps {
  return {
    url: () => tab.url,
    state: () => tab.state,
    evaluate: (fn, arg) => evalInTab(tab, fn, arg),
    content: () => getTabHtml(tab),
    click: (selector) => clickBySelector(tab, selector),
    waitForTimeout: (ms) => sleep(ms),
    presentWindow: () => presentTabWindow(manager, tab),
  };
}
