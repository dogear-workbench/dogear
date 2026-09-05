export interface ParsedSerpItem {
  title: string;
  url: string;
  snippet: string;
}

export type SerpParseFn = () => ParsedSerpItem[];

export const parseGoogleSerp = new Function(`return () => {
  const AD_RE = /赞助商广告|sponsored/i;
  const SNIPPET_SELECTORS = ['[data-sncf]', '.VwiC3b', '[data-content-feature]', 'div[style*="-webkit-line-clamp"]'];
  const pickBlocks = (selectors) => {
    for (const sel of selectors) {
      const found = Array.from(document.querySelectorAll(sel));
      if (found.length > 0) return found;
    }
    return [];
  };
  const urlOf = (block, h3) => {
    if (h3) {
      const inner = h3.querySelector('a[href]');
      if (inner && inner.href) return inner.href;
      const wrapper = h3.closest('a[href]');
      if (wrapper && wrapper.href) return wrapper.href;
    }
    for (const a of block.querySelectorAll('a[href]')) {
      if (/^https?:/i.test(a.href)) return a.href;
    }
    return '';
  };
  const snippetOf = (block) => {
    for (const sel of SNIPPET_SELECTORS) {
      const el = block.querySelector(sel);
      const text = el ? (el.textContent || '').trim() : '';
      if (text) return text;
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
  for (const block of pickBlocks(['#search div.g', '#rso div.g', 'main div.g', 'div.g'])) {
    const blockText = (block.innerText || '').slice(0, 400);
    if (AD_RE.test(blockText)) continue;
    const h3 = block.querySelector('h3');
    const title = h3 ? (h3.textContent || '').trim() : '';
    if (!title) continue;
    const url = urlOf(block, h3);
    if (!url || !/^https?:/i.test(url) || seen.has(url)) continue;
    seen.add(url);
    items.push({ title, url, snippet: snippetOf(block) });
  }
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
  for (const block of pickBlocks(['div.result', 'article.result', 'div.web-result'])) {
    if (block.classList.contains('result--ad')) continue;
    const link =
      block.querySelector('a.result__a[href]') ||
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
    const snippet = snippetEl ? (snippetEl.textContent || '').trim() : '';
    items.push({ title, url, snippet });
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
