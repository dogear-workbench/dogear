import type { FetchPageOps } from './embedded/fetch-page.js';

export interface PageTextStats {
  container: number;
  body: number;
  passwords: number;
}

export const mainTextLength = (stats: PageTextStats) => Math.max(stats.container, stats.body);

export const measureTextFn = new Function(`return () => {
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

export async function measureText(page: FetchPageOps): Promise<PageTextStats | null> {
  try {
    return await page.evaluate(measureTextFn);
  } catch {
    return null;
  }
}
