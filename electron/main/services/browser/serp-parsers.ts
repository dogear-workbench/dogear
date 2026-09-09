export interface ParsedSerpItem {
  title: string;
  url: string;
  snippet: string;
  meta?: string;
}

export type SerpParseFn = () => ParsedSerpItem[];

export const parseGoogleSerp = new Function(`return () => {
  const AD_RE = /赞助商广告|sponsored/i;
  const GOOGLE_SELF_RE = /^https?:\\/\\/([a-z0-9-]+\\.)?google\\./i;
  const SNIPPET_SELECTORS = ['[data-sncf]', '.VwiC3b', '[data-content-feature]', 'div[style*="-webkit-line-clamp"]'];
  const pickBlocks = (selectors) => {
    for (const sel of selectors) {
      const found = Array.from(document.querySelectorAll(sel));
      if (found.length > 0) return found;
    }
    return [];
  };
  const urlOf = (block, h3) => {
    const wrapA = h3.closest('a[href]');
    if (wrapA && wrapA.href) return wrapA.href;
    const inner = h3.querySelector('a[href]');
    if (inner && inner.href) return inner.href;
    for (const a of block.querySelectorAll('a[href]')) {
      if (/^https?:/i.test(a.href)) return a.href;
    }
    return '';
  };
  const snippetOf = (block) => {
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
  const items = [];
  const seen = new Set();
  const pushBlock = (block) => {
    if (!block || seen.has(block)) return;
    seen.add(block);
    const blockText = (block.innerText || '').slice(0, 400);
    if (AD_RE.test(blockText)) return;
    const h3 = block.querySelector && block.querySelector('h3');
    if (!h3) return;
    const title = (h3.textContent || '').trim();
    if (!title) return;
    const url = urlOf(block, h3);
    if (!url || !/^https?:/i.test(url) || GOOGLE_SELF_RE.test(url) || seen.has(url)) return;
    seen.add(url);
    items.push({ title, url, snippet: snippetOf(block) });
  };
  for (const block of pickBlocks(['#search div.g', '#rso div.g', 'main div.g', 'div.g'])) pushBlock(block);
  const h3Blocks = new Set();
  for (const h3 of document.querySelectorAll('#search h3, #rso h3, main h3')) {
    const block = h3.closest('div[data-hveid]') || h3.parentElement;
    if (block) h3Blocks.add(block);
  }
  for (const block of h3Blocks) pushBlock(block);
  return items;
}`)() as SerpParseFn;

export const parseDdgSerp = new Function(`return () => {
  const AD_HINT_RE = /y\\.js|ad_domain|duck\\.co/i;
  const pickBlocks = (selectors) => {
    for (const sel of selectors) {
      const found = Array.from(document.querySelectorAll(sel));
      if (found.length > 0) return found;
    }
    return [];
  };
  const decodeUddg = (raw) => {
    const m = /[?&]uddg=([^&]+)/.exec(raw);
    if (!m) return '';
    try {
      return decodeURIComponent(m[1]);
    } catch (e) {
      return '';
    }
  };
  const items = [];
  const seen = new Set();
  for (const block of pickBlocks(['article[data-testid="result"]', 'li[data-layout]', 'div.result', 'article.result', 'div.web-result'])) {
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
}`)() as SerpParseFn;

export const parseRedditSerp = new Function(`return () => {
  const norm = (t) => (t || '').replace(/\\s+/g, ' ').trim();
  const pickBlocks = (selectors) => {
    for (const sel of selectors) {
      const found = Array.from(document.querySelectorAll(sel));
      if (found.length > 0) return found;
    }
    return [];
  };
  const metaPartsOf = (block) => {
    const parts = [];
    const sub = block.querySelector('a.search-subreddit-link') || block.querySelector('.search-result-meta a[href*="/r/"]');
    const subText = sub ? norm(sub.textContent) : '';
    if (subText) parts.push('r/' + subText.replace(/^r\\//i, ''));
    const score = block.querySelector('.search-score');
    if (score) parts.push(norm(score.textContent));
    const comments = block.querySelector('.search-comments');
    if (comments) parts.push(norm(comments.textContent));
    const time = block.querySelector('time');
    const timeText = time ? (time.getAttribute('title') || time.getAttribute('datetime') || norm(time.textContent)) : '';
    if (timeText) parts.push(timeText);
    return parts;
  };
  const items = [];
  const seen = new Set();
  for (const block of pickBlocks(['div.search-result-link', 'div.search-result'])) {
    const link = block.querySelector('a.search-title[href]') || block.querySelector('a.search-link[href]') || block.querySelector('a[href]');
    if (!link) continue;
    const url = link.href || '';
    if (!/^https?:/i.test(url) || seen.has(url)) continue;
    const title = norm(link.textContent);
    if (!title) continue;
    seen.add(url);
    const body = block.querySelector('.search-result-body');
    const snippet = body ? norm(body.textContent).slice(0, 300) : '';
    const parts = metaPartsOf(block);
    const item = { title, url, snippet };
    if (parts.length > 0) item.meta = parts.join(' · ');
    items.push(item);
  }
  return items;
}`)() as SerpParseFn;

export const parseZhihuSerp = new Function(`return () => {
  const norm = (t) => (t || '').replace(/\\s+/g, ' ').trim();
  const stripHtml = (t) => norm(String(t || '').replace(/<[^>]*>/g, ' '));
  const pickBlocks = (selectors) => {
    for (const sel of selectors) {
      const found = Array.from(document.querySelectorAll(sel));
      if (found.length > 0) return found;
    }
    return [];
  };
  const voteOf = (block) => {
    const metaEl = block.querySelector('meta[itemprop="upvoteCount"]');
    const raw = metaEl ? norm(metaEl.getAttribute('content')) : '';
    if (raw) return '赞同 ' + raw;
    const button = block.querySelector('.VoteButton--up');
    if (button) {
      const text = norm(button.textContent).replace(/^赞同\\s*/, '');
      return text ? '赞同 ' + text : '赞同';
    }
    return '';
  };
  const authorOf = (block) => {
    const el = block.querySelector('.AuthorInfo-name .UserLink-link') || block.querySelector('.AuthorInfo-name') || block.querySelector('.UserLink-link');
    return el ? norm(el.textContent) : '';
  };
  const items = [];
  const seen = new Set();
  for (const block of pickBlocks(['div.SearchResult-Card', '.ContentItem'])) {
    const link = block.querySelector('.ContentItem-title a[href]') || block.querySelector('h2 a[href]');
    if (!link) continue;
    const url = link.href || '';
    if (!/^https?:/i.test(url) || seen.has(url)) continue;
    const title = norm(link.textContent);
    if (!title) continue;
    seen.add(url);
    const rich = block.querySelector('.RichContent-inner .RichText') || block.querySelector('.RichText') || block.querySelector('.RichContent-inner');
    const snippet = rich ? stripHtml(rich.textContent).slice(0, 300) : '';
    const parts = [];
    const author = authorOf(block);
    if (author) parts.push(author);
    const vote = voteOf(block);
    if (vote) parts.push(vote);
    const item = { title, url, snippet };
    if (parts.length > 0) item.meta = parts.join(' · ');
    items.push(item);
  }
  return items;
}`)() as SerpParseFn;

export const parseBingSerp = new Function(`return () => {
  const pickBlocks = (selectors) => {
    for (const sel of selectors) {
      const found = Array.from(document.querySelectorAll(sel));
      if (found.length > 0) return found;
    }
    return [];
  };
  const items = [];
  const seen = new Set();
  for (const block of pickBlocks(['#b_results li.b_algo', 'li.b_algo'])) {
    if (block.classList.contains('b_ad') || block.classList.contains('b_ans')) continue;
    const link = block.querySelector('h2 a[href]') || block.querySelector('a[href]');
    if (!link) continue;
    const url = link.href || '';
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
}`)() as SerpParseFn;

export const extractZhihuStateCards = new Function(`return () => {
  const state = window.__INITIAL_STATE__;
  if (!state || typeof state !== 'object') return null;
  const norm = (t) => (t == null ? '' : String(t)).replace(/\\s+/g, ' ').trim();
  const stripHtml = (t) => norm(String(t || '').replace(/<[^>]*>/g, ' '));
  const CARD_TYPES = { answer: 1, article: 1, post: 1, zvideo: 1 };
  const MAX_NODES = 20000;
  const MAX_CARDS = 50;
  const cards = [];
  const visited = new Set();
  let nodeCount = 0;
  const pushCard = (obj) => {
    if (!obj || typeof obj !== 'object' || cards.length >= MAX_CARDS) return;
    if (!obj.type || !CARD_TYPES[obj.type]) return;
    const title = norm(obj.title) || (obj.question ? norm(obj.question.title) : '');
    if (!title) return;
    let url = '';
    if (obj.type === 'article' || obj.type === 'post') url = 'https://zhuanlan.zhihu.com/p/' + obj.id;
    else if (obj.question && obj.question.id != null) url = 'https://www.zhihu.com/question/' + obj.question.id + '/answer/' + obj.id;
    else if (typeof obj.url === 'string') url = obj.url;
    if (!url || !/^https?:/i.test(url)) return;
    const parts = [];
    if (obj.author && norm(obj.author.name)) parts.push(norm(obj.author.name));
    if (typeof obj.voteupCount === 'number') parts.push('赞同 ' + obj.voteupCount);
    cards.push({ title, url, snippet: stripHtml(obj.excerpt || obj.content).slice(0, 300), meta: parts.join(' · ') });
  };
  const visit = (node, depth) => {
    if (nodeCount > MAX_NODES || cards.length >= MAX_CARDS) return;
    if (!node || typeof node !== 'object' || depth > 8 || visited.has(node)) return;
    visited.add(node);
    nodeCount++;
    if (Array.isArray(node)) {
      for (const child of node) visit(child, depth + 1);
      return;
    }
    if (node.object && typeof node.object === 'object') pushCard(node.object);
    pushCard(node);
    for (const key of Object.keys(node)) visit(node[key], depth + 1);
  };
  visit(state, 0);
  if (cards.length === 0) return null;
  const seenUrls = new Set();
  return cards.filter((c) => !seenUrls.has(c.url) && seenUrls.add(c.url));
}`)() as () => ParsedSerpItem[] | null;
