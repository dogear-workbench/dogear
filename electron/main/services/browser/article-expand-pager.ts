import { parseArticleHtml, type ParsedArticleData } from '../article-service.js';
import type { ArticleEmitFn } from './browser-article-types.js';
import { mainTextLength, measureText } from './article-text.js';
import { sleep, type FetchPageOps } from './embedded/fetch-page.js';

const POLL_INTERVAL_MS = 500;
const EXPAND_SETTLE_MS = 2_500;
const MAX_PAGER_PAGES = 20;
const PAGER_SETTLE_MS = 8_000;
const EXPAND_ATTR = 'data-dogear-expand';
const PAGER_ATTR = 'data-dogear-pager';
const EXPAND_TEXTS = ['展开', '全文', '更多', '阅读全文', '继续阅读'];
const PAGER_TEXTS = ['下一页', '下页', 'next'];
const MAX_EXPAND_CLICKS = 3;
const MAX_EXPAND_CANDIDATES = 5;

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

export interface ExpandOutcome {
  candidates: number;
  expanded: boolean;
}

export async function markExpandCandidates(page: FetchPageOps): Promise<string[]> {
  try {
    return await page.evaluate(markExpandFn, {
      texts: EXPAND_TEXTS,
      maxCandidates: MAX_EXPAND_CANDIDATES,
    });
  } catch {
    return [];
  }
}

export async function clearExpandMarks(page: FetchPageOps): Promise<void> {
  await page.evaluate(clearExpandFn).catch(() => {});
}

/** 展开候选逐个合成点击（内嵌后台 tab 无真实鼠标通道），正文变长即成功 */
export async function tryExpand(
  page: FetchPageOps,
  baseLen: number,
  budgetMs: number,
  emit: ArticleEmitFn,
): Promise<ExpandOutcome> {
  const labels = await markExpandCandidates(page);
  const deadline = Date.now() + Math.max(0, budgetMs);
  let clicked = 0;
  for (let i = 0; i < labels.length && clicked < MAX_EXPAND_CLICKS; i++) {
    if (Date.now() >= deadline) break;
    const clickedOk = await page.click(`[${EXPAND_ATTR}="${i}"]`).catch(() => false);
    if (!clickedOk) continue;
    clicked++;
    emit({ action: 'click', url: page.url(), detail: `点击展开候选「${labels[i]}」`, result: 'clicked' });
    const settleDeadline = Date.now() + EXPAND_SETTLE_MS;
    while (Date.now() < settleDeadline && Date.now() < deadline) {
      const stats = await measureText(page);
      if (stats && mainTextLength(stats) > baseLen) return { candidates: labels.length, expanded: true };
      await sleep(POLL_INTERVAL_MS);
    }
  }
  return { candidates: labels.length, expanded: false };
}

export async function markPagerCandidates(page: FetchPageOps): Promise<number> {
  try {
    return await page.evaluate(markPagerFn, { texts: PAGER_TEXTS });
  } catch {
    return 0;
  }
}

export async function clearPagerMarks(page: FetchPageOps): Promise<void> {
  await page.evaluate(clearPagerFn).catch(() => {});
}

async function isPagerDisabled(page: FetchPageOps): Promise<boolean> {
  try {
    return await page.evaluate(pagerDisabledFn);
  } catch {
    return true;
  }
}

async function waitForPagerSettle(page: FetchPageOps, urlBeforeClick: string, deadline: number): Promise<boolean> {
  const settleDeadline = Math.min(Date.now() + PAGER_SETTLE_MS, deadline);
  let navWaited = false;
  let lastLen = -1;
  let stableRounds = 0;
  while (Date.now() < settleDeadline) {
    if (!navWaited && page.url() !== urlBeforeClick) {
      navWaited = true;
      const navLimit = Date.now() + 10_000;
      while (Date.now() < navLimit && page.state() === 'loading') {
        await sleep(POLL_INTERVAL_MS);
      }
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
    await sleep(POLL_INTERVAL_MS);
  }
  return false;
}

const blockFingerprint = (block: string) => block.replace(/\s+/g, '');

export function mergePagedPages(pages: ParsedArticleData[]): ParsedArticleData {
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

export interface PagerLoopOutcome {
  pages: ParsedArticleData[];
  incomplete: { collected: number; attempted: number } | null;
  finalUrl: string;
}

async function capturePageArticle(page: FetchPageOps): Promise<ParsedArticleData | null> {
  try {
    const html = await page.content();
    return parseArticleHtml(html, page.url());
  } catch {
    return null;
  }
}

/** 点击「下一页」拼接多页正文：内容块指纹跨页去重，翻页失败/超时标记 incomplete */
export async function runPagerLoop(page: FetchPageOps, deadline: number, emit: ArticleEmitFn): Promise<PagerLoopOutcome> {
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
    const clicked = await page.click(`[${PAGER_ATTR}="0"]`).catch(() => false);
    if (!clicked) break;
    emit({ action: 'click', url: page.url(), detail: '点击「下一页」', result: 'clicked' });
    const settled = await waitForPagerSettle(page, urlBeforeClick, deadline);
    if (!settled) {
      incomplete = { collected: pages.length, attempted: pages.length + 1 };
      break;
    }
  }

  return { pages, incomplete, finalUrl: page.url() };
}
