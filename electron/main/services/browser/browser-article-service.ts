import type { Page } from 'patchright';
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
const MAX_PAGER_PAGES = 20;
const PAGER_SETTLE_MS = 8_000;
const EXPAND_ATTR = 'data-dogear-expand';
const PAGER_ATTR = 'data-dogear-pager';
const EXPAND_TEXTS = ['展开', '全文', '更多', '阅读全文', '继续阅读'];
const PAGER_TEXTS = ['下一页', '下页', 'next'];
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
  const SKIP_TAGS = { SCRIPT: 1, STYLE: 1, NOSCRIPT: 1, TEMPLATE: 1 };
  const visCache = new Map();
  const selfVisible = (el) => {
    let v = visCache.get(el);
    if (v === undefined) {
      if (SKIP_TAGS[el.tagName]) {
        v = false;
      } else {
        const style = window.getComputedStyle(el);
        const rect = el.getBoundingClientRect();
        v = style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0;
      }
      visCache.set(el, v);
    }
    return v;
  };
  const isVisible = (el) => {
    let cur = el;
    while (cur) {
      if (!selfVisible(cur)) return false;
      cur = cur.parentElement;
    }
    return true;
  };
  const visibleTextLength = (root) => {
    let total = 0;
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
      acceptNode: (node) => {
        const p = node.parentElement;
        return p && SKIP_TAGS[p.tagName] ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT;
      },
    });
    while (walker.nextNode()) {
      const el = walker.currentNode.parentElement;
      if (el && isVisible(el)) total += (walker.currentNode.nodeValue || '').replace(/\\s+/g, '').length;
    }
    return total;
  };
  let container = 0;
  document.querySelectorAll('article, main, [role="main"], #content, .content').forEach((el) => {
    container = Math.max(container, visibleTextLength(el));
  });
  return {
    container,
    body: visibleTextLength(document.body),
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

interface ExpandOutcome {
  candidates: number;
  expanded: boolean;
}

async function tryExpand(
  page: Page,
  baseLen: number,
  budgetMs: number,
  emit: EmitFn,
): Promise<ExpandOutcome> {
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
      if (stats && mainTextLength(stats) > baseLen) return { candidates: labels.length, expanded: true };
      await page.waitForTimeout(POLL_INTERVAL_MS);
    }
  }
  return { candidates: labels.length, expanded: false };
}

const markPagerFn = new Function(`return ({ texts }) => {
  document.querySelectorAll('[${PAGER_ATTR}]').forEach((el) => el.removeAttribute('${PAGER_ATTR}'));
  const visible = (el) => {
    const style = window.getComputedStyle(el);
    const rect = el.getBoundingClientRect();
    return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0;
  };
  let marked = 0;
  for (const el of Array.from(document.querySelectorAll('button, a, [role="button"]'))) {
    if (marked >= 1) break;
    const text = (el.textContent || '').trim().toLowerCase();
    if (text.length === 0 || text.length > 20) continue;
    if (!texts.some((t) => text.includes(t))) continue;
    if (!visible(el)) continue;
    el.setAttribute('${PAGER_ATTR}', '0');
    marked++;
  }
  return marked;
}`)() as (arg: { texts: string[] }) => number;

const clearPagerFn = new Function(`return () => {
  document.querySelectorAll('[${PAGER_ATTR}]').forEach((el) => el.removeAttribute('${PAGER_ATTR}'));
}`)() as () => void;

const pagerDisabledFn = new Function(`return () => {
  const el = document.querySelector('[${PAGER_ATTR}="0"]');
  if (!el) return true;
  if (el.disabled === true) return true;
  if (el.getAttribute('aria-disabled') === 'true') return true;
  const cls = el.getAttribute('class') || '';
  return /(^|\\s)(disabled|is-disabled)\\b/i.test(cls);
}`)() as () => boolean;

async function markPagerCandidates(page: Page): Promise<number> {
  try {
    return await page.evaluate(markPagerFn, { texts: PAGER_TEXTS });
  } catch {
    return 0;
  }
}

async function clearPagerMarks(page: Page): Promise<void> {
  await page.evaluate(clearPagerFn).catch(() => {});
}

async function isPagerDisabled(page: Page): Promise<boolean> {
  try {
    return await page.evaluate(pagerDisabledFn);
  } catch {
    return true;
  }
}

async function waitForPagerSettle(page: Page, urlBeforeClick: string, deadline: number): Promise<boolean> {
  const settleDeadline = Math.min(Date.now() + PAGER_SETTLE_MS, deadline);
  let navWaited = false;
  let lastLen = -1;
  let stableRounds = 0;
  while (Date.now() < settleDeadline) {
    if (!navWaited && page.url() !== urlBeforeClick) {
      navWaited = true;
      await page.waitForLoadState('domcontentloaded', { timeout: 10_000 }).catch(() => {});
    }
    const stats = await measureText(page);
    const len = stats ? mainTextLength(stats) : -1;
    if (len > 0 && len === lastLen) {
      stableRounds++;
      if (stableRounds >= 2) return true;
    } else {
      stableRounds = 0;
    }
    lastLen = len;
    if (Date.now() >= settleDeadline) break;
    await page.waitForTimeout(POLL_INTERVAL_MS).catch(() => {});
  }
  return false;
}

const blockFingerprint = (block: string) => block.replace(/\s+/g, '');

function mergePagedPages(pages: ParsedArticleData[]): ParsedArticleData {
  const pageSets = pages.map((page) => {
    const set = new Set<string>();
    for (const block of page.content.split(/\n{2,}/)) {
      const fp = blockFingerprint(block);
      if (fp) set.add(fp);
    }
    return set;
  });
  const seen = new Set<string>();
  const blocks: string[] = [];
  pages.forEach((page, pi) => {
    for (const block of page.content.split(/\n{2,}/)) {
      const fp = blockFingerprint(block);
      if (!fp) continue;
      const crossPage = pageSets.some((set, sj) => sj !== pi && set.has(fp));
      if (crossPage) {
        if (seen.has(fp)) continue;
        seen.add(fp);
      }
      blocks.push(block.trim());
    }
  });
  const content = blocks.join('\n\n');
  return { ...pages[0], content, wordCount: content.replace(/\s+/g, '').length };
}

interface PagerLoopOutcome {
  pages: ParsedArticleData[];
  incomplete: { collected: number; attempted: number } | null;
  finalUrl: string;
}

async function capturePageArticle(page: Page): Promise<ParsedArticleData | null> {
  try {
    const html = await page.content();
    return parseArticleHtml(html, page.url());
  } catch {
    return null;
  }
}

async function runPagerLoop(page: Page, deadline: number, emit: EmitFn): Promise<PagerLoopOutcome> {
  const pages: ParsedArticleData[] = [];
  const seen = new Set<string>();
  let incomplete: PagerLoopOutcome['incomplete'] = null;
  let first = true;

  while (true) {
    if (Date.now() >= deadline) {
      incomplete = { collected: pages.length, attempted: pages.length + 1 };
      break;
    }
    const current = await capturePageArticle(page);
    if (!current) break;
    let added = 0;
    for (const block of current.content.split(/\n{2,}/)) {
      const fp = blockFingerprint(block);
      if (!fp || seen.has(fp)) continue;
      seen.add(fp);
      added++;
    }
    if (!first && added === 0) break;
    pages.push(current);
    emit({
      action: 'parse',
      url: page.url(),
      detail: `第 ${pages.length} 页采集完成，新增 ${added} 块`,
      result: `page=${pages.length}`,
    });
    first = false;

    const pagerCount = await markPagerCandidates(page);
    if (pagerCount === 0) break;
    if (await isPagerDisabled(page)) break;
    if (pages.length >= MAX_PAGER_PAGES || Date.now() >= deadline) {
      incomplete = { collected: pages.length, attempted: pages.length + 1 };
      break;
    }

    const urlBeforeClick = page.url();
    try {
      await page.click(`[${PAGER_ATTR}="0"]`, {
        timeout: Math.min(CLICK_TIMEOUT_MS, Math.max(250, deadline - Date.now())),
      });
    } catch {
      break;
    }
    emit({ action: 'click', url: page.url(), detail: '点击「下一页」', result: 'clicked' });
    const settled = await waitForPagerSettle(page, urlBeforeClick, deadline);
    if (!settled) {
      incomplete = { collected: pages.length, attempted: pages.length + 1 };
      break;
    }
  }

  return { pages, incomplete, finalUrl: page.url() };
}

/**
 * 浏览器渲染解析文章：acquire → 导航 → 等渲染 → 登录墙检测 → 翻页拼接 / 展开启发式
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
      let parsed: ParsedArticleData;
      let finalUrl: string;
      let qualityHint: string | undefined;

      if ((await markPagerCandidates(page)) > 0) {
        emit({ action: 'observe', url: page.url(), detail: '命中「下一页」按钮，进入翻页拼接', result: 'pager' });
        const outcome = await runPagerLoop(page, startAt + TASK_TIMEOUT_MS, emit);
        await clearPagerMarks(page);
        finalUrl = outcome.finalUrl;
        if (outcome.pages.length === 0) {
          emit({
            action: 'parse',
            url: finalUrl,
            detail: '翻页采集未解析出正文',
            result: outcome.incomplete ? 'timeout' : 'parse_empty',
          });
          if (outcome.incomplete) return timeoutResult('任务超时');
          return {
            ok: false,
            errorClass: 'parse_empty',
            message: '浏览器渲染后仍无法解析出正文：翻页首页无可用内容',
          };
        }
        parsed = mergePagedPages(outcome.pages);
        if (outcome.incomplete) {
          qualityHint = `翻页未完成（已采集 ${outcome.incomplete.collected}/${outcome.incomplete.attempted} 页）`;
        }
        emit({
          action: 'parse',
          url: finalUrl,
          detail: `翻页拼接完成，共 ${outcome.pages.length} 页`,
          result: `pages=${outcome.pages.length}`,
        });
      } else {
        const { candidates, expanded } = await tryExpand(page, baseLen, Math.min(EXPAND_BUDGET_MS, remaining()), emit);
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
        finalUrl = page.url();
        emit({ action: 'parse', url: finalUrl, detail: `渲染后 DOM ${html.length} 字符，开始 Readability 解析` });

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
        if (candidates > 0 && !expanded) {
          qualityHint = '未能通过页面按钮展开全文，正文可能不完整';
        }
      }

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
