import type { SearchEngineId } from './browser-search-types.js';
import { parseHTML } from 'linkedom';

export interface ParsedSerpItem {
  title: string;
  url: string;
  snippet: string;
  meta?: string;
}

type SerpDocument = ReturnType<typeof parseHTML>['document'];
type SerpElement = NonNullable<ReturnType<SerpDocument['querySelector']>>;

/** linkedom 的 href 属性不做绝对化，统一按页面 URL 解析为绝对地址 */
function absHref(el: SerpElement, baseUrl: string): string {
  const raw = el.getAttribute('href') || '';
  if (!raw) return '';
  try {
    return new URL(raw, baseUrl).href;
  } catch {
    return raw;
  }
}

function pickBlocks(document: SerpDocument, selectors: string[]): SerpElement[] {
  for (const sel of selectors) {
    const found = Array.from(document.querySelectorAll(sel));
    if (found.length > 0) return found;
  }
  return [];
}

export function parseGoogleSerp(document: SerpDocument, baseUrl: string): ParsedSerpItem[] {
  const AD_RE = /赞助商广告|sponsored/i;
  const GOOGLE_SELF_RE = /^https?:\/\/([a-z0-9-]+\.)?google\./i;
  const SNIPPET_SELECTORS = ['[data-sncf]', '.VwiC3b', '[data-content-feature]', 'div[style*="-webkit-line-clamp"]'];
  const urlOf = (block: SerpElement, h3: SerpElement): string => {
    const wrapA = h3.closest('a[href]');
    if (wrapA) {
      const href = absHref(wrapA, baseUrl);
      if (href) return href;
    }
    const inner = h3.querySelector('a[href]');
    if (inner) {
      const href = absHref(inner, baseUrl);
      if (href) return href;
    }
    for (const a of block.querySelectorAll('a[href]')) {
      const href = absHref(a, baseUrl);
      if (/^https?:/i.test(href)) return href;
    }
    return '';
  };
  const snippetOf = (block: SerpElement): string => {
    for (const scope of [block, block.parentElement]) {
      if (!scope) continue;
      for (const sel of SNIPPET_SELECTORS) {
        const el = scope.querySelector(sel);
        const text = el ? (el.textContent || '').trim() : '';
        if (text) return text;
      }
    }
    let best = '';
    for (const el of block.querySelectorAll('div, p, span')) {
      if (el.tagName === 'A' || el.querySelector('a[href]')) continue;
      const text = (el.textContent || '').trim();
      if (text.length > best.length) best = text;
    }
    return best.slice(0, 300);
  };
  const items: ParsedSerpItem[] = [];
  const seenBlocks = new Set<SerpElement>();
  const seenUrls = new Set<string>();
  const pushBlock = (block: SerpElement | null) => {
    if (!block || seenBlocks.has(block)) return;
    seenBlocks.add(block);
    const blockText = (block.textContent || '').slice(0, 400);
    if (AD_RE.test(blockText)) return;
    const h3 = block.querySelector('h3');
    if (!h3) return;
    const title = (h3.textContent || '').trim();
    if (!title) return;
    const url = urlOf(block, h3);
    if (!url || !/^https?:/i.test(url) || GOOGLE_SELF_RE.test(url) || seenUrls.has(url)) return;
    seenUrls.add(url);
    items.push({ title, url, snippet: snippetOf(block) });
  };
  for (const block of pickBlocks(document, ['#search div.g', '#rso div.g', 'main div.g', 'div.g'])) pushBlock(block);
  const h3Blocks = new Set<SerpElement>();
  for (const h3 of document.querySelectorAll('#search h3, #rso h3, main h3')) {
    const block = h3.closest('div[data-hveid]') || h3.parentElement;
    if (block) h3Blocks.add(block);
  }
  for (const block of h3Blocks) pushBlock(block);
  return items;
}

export function parseDdgSerp(document: SerpDocument, baseUrl: string): ParsedSerpItem[] {
  const AD_HINT_RE = /y\.js|ad_domain|duck\.co/i;
  const decodeUddg = (raw: string): string => {
    const m = /[?&]uddg=([^&]+)/.exec(raw);
    if (!m) return '';
    try {
      return decodeURIComponent(m[1]);
    } catch {
      return '';
    }
  };
  const items: ParsedSerpItem[] = [];
  const seen = new Set<string>();
  for (const block of pickBlocks(document, ['article[data-testid="result"]', 'li[data-layout]', 'div.result', 'article.result', 'div.web-result'])) {
    if (block.classList.contains('result--ad')) continue;
    const link =
      block.querySelector('a.result__a[href]') ||
      block.querySelector('a[data-testid="result-title-a"][href]') ||
      block.querySelector('h2 a[href]') ||
      block.querySelector('a.result__url[href]');
    if (!link) continue;
    let raw = link.getAttribute('href') || '';
    if (AD_HINT_RE.test(raw)) continue;
    if (raw.startsWith('//')) raw = 'https:' + raw;
    let url = decodeUddg(raw) || raw;
    if (url.startsWith('/')) url = 'https://duckduckgo.com' + url;
    if (!/^https?:/i.test(url) || seen.has(url)) continue;
    const title = (link.textContent || '').trim();
    if (!title) continue;
    seen.add(url);
    const snippetEl = block.querySelector('.result__snippet');
    let snippet = snippetEl ? (snippetEl.textContent || '').trim() : '';
    if (!snippet) {
      for (const el of block.querySelectorAll('div, p, span')) {
        if (el.tagName === 'A' || el.querySelector('a[href]')) continue;
        const text = (el.textContent || '').trim();
        if (text.length > snippet.length) snippet = text;
      }
      snippet = snippet.slice(0, 300);
    }
    items.push({ title, url, snippet });
  }
  return items;
}

export function parseRedditSerp(document: SerpDocument, baseUrl: string): ParsedSerpItem[] {
  const norm = (t: string | null | undefined): string => (t || '').replace(/\s+/g, ' ').trim();
  const metaPartsOf = (block: SerpElement): string[] => {
    const parts: string[] = [];
    const sub = block.querySelector('a.search-subreddit-link') || block.querySelector('.search-result-meta a[href*="/r/"]');
    const subText = sub ? norm(sub.textContent) : '';
    if (subText) parts.push('r/' + subText.replace(/^r\//i, ''));
    const score = block.querySelector('.search-score');
    if (score) parts.push(norm(score.textContent));
    const comments = block.querySelector('.search-comments');
    if (comments) parts.push(norm(comments.textContent));
    const time = block.querySelector('time');
    const timeText = time ? (time.getAttribute('title') || time.getAttribute('datetime') || norm(time.textContent)) : '';
    if (timeText) parts.push(timeText);
    return parts;
  };
  const items: ParsedSerpItem[] = [];
  const seen = new Set<string>();
  for (const block of pickBlocks(document, ['div.search-result-link', 'div.search-result'])) {
    const link = block.querySelector('a.search-title[href]') || block.querySelector('a.search-link[href]') || block.querySelector('a[href]');
    if (!link) continue;
    const url = absHref(link, baseUrl);
    if (!/^https?:/i.test(url) || seen.has(url)) continue;
    const title = norm(link.textContent);
    if (!title) continue;
    seen.add(url);
    const body = block.querySelector('.search-result-body');
    const snippet = body ? norm(body.textContent).slice(0, 300) : '';
    const parts = metaPartsOf(block);
    const item: ParsedSerpItem = { title, url, snippet };
    if (parts.length > 0) item.meta = parts.join(' · ');
    items.push(item);
  }
  return items;
}

export function parseZhihuSerp(document: SerpDocument, baseUrl: string): ParsedSerpItem[] {
  const norm = (t: string | null | undefined): string => (t || '').replace(/\s+/g, ' ').trim();
  const stripHtml = (t: string | null | undefined): string => norm(String(t || '').replace(/<[^>]*>/g, ' '));
  const voteOf = (block: SerpElement): string => {
    const metaEl = block.querySelector('meta[itemprop="upvoteCount"]');
    const raw = metaEl ? norm(metaEl.getAttribute('content')) : '';
    if (raw) return '赞同 ' + raw;
    const button = block.querySelector('.VoteButton--up');
    if (button) {
      const text = norm(button.textContent).replace(/^赞同\s*/, '');
      return text ? '赞同 ' + text : '赞同';
    }
    return '';
  };
  const authorOf = (block: SerpElement): string => {
    const el =
      block.querySelector('.AuthorInfo-name .UserLink-link') ||
      block.querySelector('.AuthorInfo-name') ||
      block.querySelector('.UserLink-link');
    return el ? norm(el.textContent) : '';
  };
  const items: ParsedSerpItem[] = [];
  const seen = new Set<string>();
  for (const block of pickBlocks(document, ['div.SearchResult-Card', '.ContentItem'])) {
    const link = block.querySelector('.ContentItem-title a[href]') || block.querySelector('h2 a[href]');
    if (!link) continue;
    const url = absHref(link, baseUrl);
    if (!/^https?:/i.test(url) || seen.has(url)) continue;
    const title = norm(link.textContent);
    if (!title) continue;
    seen.add(url);
    const rich =
      block.querySelector('.RichContent-inner .RichText') ||
      block.querySelector('.RichText') ||
      block.querySelector('.RichContent-inner');
    const snippet = rich ? stripHtml(rich.textContent).slice(0, 300) : '';
    const parts: string[] = [];
    const author = authorOf(block);
    if (author) parts.push(author);
    const vote = voteOf(block);
    if (vote) parts.push(vote);
    const item: ParsedSerpItem = { title, url, snippet };
    if (parts.length > 0) item.meta = parts.join(' · ');
    items.push(item);
  }
  return items;
}

export function parseBingSerp(document: SerpDocument, baseUrl: string): ParsedSerpItem[] {
  const items: ParsedSerpItem[] = [];
  const seen = new Set<string>();
  for (const block of pickBlocks(document, ['#b_results li.b_algo', 'li.b_algo'])) {
    if (block.classList.contains('b_ad') || block.classList.contains('b_ans')) continue;
    const link = block.querySelector('h2 a[href]') || block.querySelector('a[href]');
    if (!link) continue;
    const url = absHref(link, baseUrl);
    if (!/^https?:/i.test(url) || seen.has(url)) continue;
    const h2 = block.querySelector('h2');
    const title = h2 ? (h2.textContent || '').trim() : '';
    if (!title) continue;
    seen.add(url);
    let snippet = '';
    for (const sel of ['.b_caption p', 'p.b_lineclamp2', '.b_caption', 'p']) {
      const el = block.querySelector(sel);
      const text = el ? (el.textContent || '').trim() : '';
      if (text) {
        snippet = text;
        break;
      }
    }
    items.push({ title, url, snippet });
  }
  return items;
}

/** 知乎搜索页初始状态数据（script#js-initialData 的 JSON 文本），无该节点或 JSON 非法返回 null */
export function extractZhihuInitialData(document: SerpDocument): unknown {
  const el = document.querySelector('#js-initialData');
  const raw = el ? (el.textContent || '').trim() : '';
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

/** 遍历知乎初始状态 JSON 提取结果卡片（answer/article/post/zvideo）；无对象或无卡片返回 null */
export function extractZhihuStateCards(state: unknown): ParsedSerpItem[] | null {
  if (!state || typeof state !== 'object') return null;
  const norm = (t: unknown): string => (t == null ? '' : String(t)).replace(/\s+/g, ' ').trim();
  const stripHtml = (t: unknown): string => norm(String(t || '').replace(/<[^>]*>/g, ' '));
  const CARD_TYPES: Record<string, number> = { answer: 1, article: 1, post: 1, zvideo: 1 };
  const MAX_NODES = 20000;
  const MAX_CARDS = 50;
  const cards: ParsedSerpItem[] = [];
  const visited = new Set<unknown>();
  let nodeCount = 0;
  const pushCard = (raw: unknown) => {
    if (!raw || typeof raw !== 'object' || cards.length >= MAX_CARDS) return;
    const obj = raw as Record<string, unknown>;
    const type = typeof obj.type === 'string' ? obj.type : '';
    if (!CARD_TYPES[type]) return;
    const question = obj.question as Record<string, unknown> | undefined;
    const title = norm(obj.title) || (question ? norm(question.title) : '');
    if (!title) return;
    let url = '';
    if (type === 'article' || type === 'post') url = 'https://zhuanlan.zhihu.com/p/' + obj.id;
    else if (question && question.id != null) url = 'https://www.zhihu.com/question/' + question.id + '/answer/' + obj.id;
    else if (typeof obj.url === 'string') url = obj.url;
    if (!url || !/^https?:/i.test(url)) return;
    const author = obj.author as Record<string, unknown> | undefined;
    const parts: string[] = [];
    if (author && norm(author.name)) parts.push(norm(author.name));
    if (typeof obj.voteupCount === 'number') parts.push('赞同 ' + obj.voteupCount);
    cards.push({ title, url, snippet: stripHtml(obj.excerpt || obj.content).slice(0, 300), meta: parts.join(' · ') });
  };
  const visit = (node: unknown, depth: number) => {
    if (nodeCount > MAX_NODES || cards.length >= MAX_CARDS) return;
    if (!node || typeof node !== 'object' || depth > 8 || visited.has(node)) return;
    visited.add(node);
    nodeCount++;
    if (Array.isArray(node)) {
      for (const child of node) visit(child, depth + 1);
      return;
    }
    const obj = node as Record<string, unknown>;
    if (obj.object && typeof obj.object === 'object') pushCard(obj.object);
    pushCard(node);
    for (const key of Object.keys(obj)) visit(obj[key], depth + 1);
  };
  visit(state, 0);
  if (cards.length === 0) return null;
  const seenUrls = new Set<string>();
  return cards.filter((c) => !seenUrls.has(c.url) && seenUrls.add(c.url));
}
