import type { Page } from 'playwright';
import { parseArticleHtml, type ParsedArticleData } from '../article-service.js';
import { getBrowserManager, type BrowserTaskMeta } from './browser-manager.js';

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
  | { ok: false; errorClass: ReadArticleErrorClass; message: string };

export type BrowserArticleAction = 'navigate' | 'wait' | 'click' | 'observe' | 'parse';

export interface BrowserArticleActionEvent {
  taskMeta: BrowserTaskMeta;
  action: BrowserArticleAction;
  url?: string;
  detail?: string;
  result?: string;
}

export type OnBrowserArticleAction = (event: BrowserArticleActionEvent) => void;

export interface ReadArticleWithBrowserOptions {
  taskMeta?: BrowserTaskMeta;
  onAction?: OnBrowserArticleAction;
}

type EmitFn = (event: Omit<BrowserArticleActionEvent, 'taskMeta'>) => void;

const TASK_TIMEOUT_MS = 60_000;
const GOTO_TIMEOUT_MS = 25_000;
const CONTENT_WAIT_MS = 15_000;
const EXPAND_BUDGET_MS = 15_000;
const POLL_INTERVAL_MS = 500;
const CONTENT_READY_THRESHOLD = 200;
const EMPTY_TEXT_THRESHOLD = 100;
const MAX_EXPAND_CLICKS = 3;
const MAX_EXPAND_CANDIDATES = 5;
const EXPAND_SETTLE_MS = 2_500;
const CLICK_TIMEOUT_MS = 2_000;
const EXPAND_ATTR = 'data-dogear-expand';
const EXPAND_TEXTS = ['展开', '全文', '更多', '阅读全文', '继续阅读', '下一页'];
const LOGIN_HOST_PREFIXES = ['passport.', 'accounts.', 'login.'];
const LOGIN_PATH_RE = /^\/(login|signin|sign-in|auth)(\/|$)/;

interface PageTextStats {
  container: number;
  body: number;
  passwords: number;
}

function isLoginUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.toLowerCase();
    const pathName = parsed.pathname.toLowerCase();
    return LOGIN_HOST_PREFIXES.some((prefix) => host.startsWith(prefix)) || LOGIN_PATH_RE.test(pathName);
  } catch {
    return false;
  }
}

const mainTextLength = (stats: PageTextStats) => Math.max(stats.container, stats.body);

const measureTextFn = new Function(`return () => {
  const trimmed = (el) => (el && el.innerText ? el.innerText.replace(/\\s+/g, '') : '').length;
  let container = 0;
  document.querySelectorAll('article, main, [role="main"], #content, .content').forEach((el) => {
    container = Math.max(container, trimmed(el));
  });
  return {
    container,
    body: trimmed(document.body),
    passwords: document.querySelectorAll('input[type="password"]').length,
  };
}`)() as () => PageTextStats;

async function measureText(page: Page): Promise<PageTextStats | null> {
  try {
    return await page.evaluate(measureTextFn);
  } catch {
    return null;
  }
}

async function waitForContent(page: Page, budgetMs: number): Promise<number> {
  const deadline = Date.now() + Math.max(0, budgetMs);
  let last = 0;
  while (Date.now() < deadline) {
    const stats = await measureText(page);
    if (stats) {
      last = mainTextLength(stats);
      if (last > CONTENT_READY_THRESHOLD && stats.passwords === 0) return last;
    }
    if (Date.now() >= deadline) break;
    await page.waitForTimeout(POLL_INTERVAL_MS);
  }
  return last;
}

const markExpandFn = new Function(`return ({ texts, maxCandidates }) => {
  const marked = [];
  const textOf = (el) => (el.textContent || '').trim();
  const visible = (el) => {
    const style = window.getComputedStyle(el);
    const rect = el.getBoundingClientRect();
    return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0;
  };
  for (const el of Array.from(document.querySelectorAll('button, a, [role="button"]'))) {
    if (marked.length >= maxCandidates) break;
    const text = textOf(el);
    if (text.length === 0 || text.length > 20) continue;
    if (!texts.some((t) => text.includes(t))) continue;
    if (!visible(el)) continue;
    if (marked.some((m) => m === el || m.contains(el) || el.contains(m))) continue;
    el.setAttribute('${EXPAND_ATTR}', String(marked.length));
    marked.push(el);
  }
  return marked.map((el) => textOf(el));
}`)() as (arg: { texts: string[]; maxCandidates: number }) => string[];

const clearExpandFn = new Function(`return () => {
  document.querySelectorAll('[${EXPAND_ATTR}]').forEach((el) => el.removeAttribute('${EXPAND_ATTR}'));
}`)() as () => void;

async function markExpandCandidates(page: Page): Promise<string[]> {
  try {
    return await page.evaluate(markExpandFn, {
      texts: EXPAND_TEXTS,
      maxCandidates: MAX_EXPAND_CANDIDATES,
    });
  } catch {
    return [];
  }
}

async function clearExpandMarks(page: Page): Promise<void> {
  await page.evaluate(clearExpandFn).catch(() => {});
}

async function tryExpand(
  page: Page,
  baseLen: number,
  budgetMs: number,
  emit: EmitFn,
): Promise<boolean> {
  const labels = await markExpandCandidates(page);
  const deadline = Date.now() + Math.max(0, budgetMs);
  let clicked = 0;
  for (let i = 0; i < labels.length && clicked < MAX_EXPAND_CLICKS; i++) {
    if (Date.now() >= deadline) break;
    try {
      await page.click(`[${EXPAND_ATTR}="${i}"]`, { timeout: CLICK_TIMEOUT_MS });
    } catch {
      continue;
    }
    clicked++;
    emit({ action: 'click', url: page.url(), detail: `点击展开候选「${labels[i]}」`, result: 'clicked' });
    const settleDeadline = Date.now() + EXPAND_SETTLE_MS;
    while (Date.now() < settleDeadline && Date.now() < deadline) {
      const stats = await measureText(page);
      if (stats && mainTextLength(stats) > baseLen) return true;
      await page.waitForTimeout(POLL_INTERVAL_MS);
    }
  }
  return false;
}

/**
 * 浏览器渲染解析文章：acquire → 导航 → 等渲染 → 登录墙检测 → 展开启发式
 * → 渲染后 DOM 走 Readability 管线。不落盘、不 throw，错误归类在返回值里。
 * 任务级超时（含 acquire 排队时间）从函数入口起算。
 */
export async function readArticleWithBrowser(
  url: string,
  options?: ReadArticleWithBrowserOptions,
): Promise<ReadArticleResult> {
  const manager = getBrowserManager();
  const taskMeta: BrowserTaskMeta = options?.taskMeta ?? { kind: 'article' };
  const onAction = options?.onAction;
  const emit: EmitFn = (event) => {
    const full: BrowserArticleActionEvent = { taskMeta, ...event };
    if (onAction) onAction(full);
    else console.debug('[browser-article]', JSON.stringify(full));
  };

  const startAt = Date.now();
  const remaining = () => TASK_TIMEOUT_MS - (Date.now() - startAt);
  const expired = () => remaining() <= 0;
  const timeoutResult = (message: string): ReadArticleResult => ({
    ok: false,
    errorClass: 'timeout',
    message,
  });

  try {
    emit({ action: 'wait', url, detail: '等待浏览器实例' });
    const acquirePromise = manager.acquire(taskMeta);
    acquirePromise.catch(() => {});
    const acquired = await Promise.race([
      acquirePromise.then((lease) => ({ kind: 'acquired' as const, lease })),
      new Promise<{ kind: 'expired' }>((resolve) => setTimeout(() => resolve({ kind: 'expired' }), Math.max(1, remaining()))),
    ]);
    if (acquired.kind === 'expired') {
      void acquirePromise.then((l) => l.release()).catch(() => {});
      emit({ action: 'wait', url, detail: '等待浏览器实例', result: 'timeout' });
      return timeoutResult(`等待浏览器实例超时（任务上限 ${TASK_TIMEOUT_MS / 1000} 秒，含排队时间）`);
    }

    const lease = acquired.lease;
    const page = lease.page;
    try {
      emit({ action: 'navigate', url, detail: '开始导航' });
      await page.goto(url, {
        waitUntil: 'domcontentloaded',
        timeout: Math.min(GOTO_TIMEOUT_MS, Math.max(1_000, remaining())),
      });
      emit({ action: 'navigate', url: page.url(), detail: '导航完成', result: 'domcontentloaded' });

      if (expired()) return timeoutResult('任务超时');

      const waited = await waitForContent(page, Math.min(CONTENT_WAIT_MS, remaining()));
      emit({ action: 'wait', url: page.url(), detail: `渲染等待结束，正文字数 ${waited}`, result: String(waited) });

      if (expired()) return timeoutResult('任务超时');

      const stats = await measureText(page);
      const checkUrl = page.url();
      const urlWall = isLoginUrl(checkUrl);
      const domWall = !!stats && stats.passwords > 0 && stats.container < EMPTY_TEXT_THRESHOLD;
      if (urlWall || domWall) {
        emit({
          action: 'observe',
          url: checkUrl,
          detail: urlWall ? 'URL 命中登录页特征' : '页面出现密码输入框且无正文容器',
          result: 'need_login',
        });
        await manager.bringToFront().catch(() => {});
        return {
          ok: false,
          errorClass: 'need_login',
          message: `页面需要登录后才能读取：${checkUrl}。已将浏览器窗口置前，登录后可重试`,
        };
      }

      const baseLen = stats ? mainTextLength(stats) : waited;
      const expanded = await tryExpand(page, baseLen, Math.min(EXPAND_BUDGET_MS, remaining()), emit);
      const afterExpand = await measureText(page);
      const finalLen = afterExpand ? mainTextLength(afterExpand) : baseLen;
      emit({
        action: 'observe',
        url: page.url(),
        detail: expanded ? `展开成功，正文 ${baseLen} → ${finalLen} 字` : `展开尝试后正文未变长（${finalLen} 字）`,
        result: expanded ? 'expanded' : 'no_change',
      });
      await clearExpandMarks(page);

      if (expired()) return timeoutResult('任务超时');

      const html = await page.content();
      const finalUrl = page.url();
      emit({ action: 'parse', url: finalUrl, detail: `渲染后 DOM ${html.length} 字符，开始 Readability 解析` });

      let parsed: ParsedArticleData;
      try {
        parsed = parseArticleHtml(html, finalUrl);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        emit({ action: 'parse', url: finalUrl, detail: message, result: 'parse_empty' });
        return {
          ok: false,
          errorClass: 'parse_empty',
          message: `浏览器渲染后仍无法解析出正文：${message}`,
        };
      }

      const qualityHint = expanded ? undefined : '未能通过页面按钮展开全文，正文可能不完整';
      emit({ action: 'parse', url: finalUrl, detail: `解析成功：${parsed.title}`, result: `wordCount=${parsed.wordCount}` });
      return {
        ok: true,
        meta: {
          url: finalUrl,
          title: parsed.title,
          author: parsed.author,
          siteName: parsed.siteName,
          excerpt: qualityHint
            ? parsed.excerpt
              ? `${parsed.excerpt}（提示：${qualityHint}）`
              : `（提示：${qualityHint}）`
            : parsed.excerpt,
          wordCount: parsed.wordCount,
          language: parsed.language,
          content: parsed.content,
          ...(qualityHint ? { qualityHint } : {}),
        },
      };
    } finally {
      lease.release();
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if ((err instanceof Error && err.name === 'TimeoutError') || expired()) {
      emit({ action: 'wait', url, detail: message, result: 'timeout' });
      return timeoutResult(`浏览器解析任务超时：${message}`);
    }
    emit({ action: 'observe', url, detail: message, result: 'browser_crash' });
    return {
      ok: false,
      errorClass: 'browser_crash',
      message: `浏览器解析失败：${message}`,
    };
  }
}
