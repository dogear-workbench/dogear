import { afterEach, describe, expect, test } from 'bun:test';
import { parseHTML } from 'linkedom';
import { collectDomLinksInPage } from './ax-observe.js';

type FakeRect = { width: number; height: number };

function installDoc(html: string, rect: FakeRect): Document {
  const { document } = parseHTML(html);
  for (const link of document.querySelectorAll('a')) {
    (link as unknown as { getBoundingClientRect: () => FakeRect }).getBoundingClientRect = () => rect;
  }
  (globalThis as { document?: Document }).document = document;
  return document;
}

afterEach(() => {
  delete (globalThis as { document?: Document }).document;
});

describe('collectDomLinksInPage', () => {
  test('收集可见 a[href] 的 text 与 href', () => {
    installDoc(
      '<html><body><a href="https://example.com/a">链接 A</a><a href="https://example.com/b">链接 B</a></body></html>',
      { width: 100, height: 20 },
    );
    expect(collectDomLinksInPage()).toEqual([
      { text: '链接 A', href: 'https://example.com/a' },
      { text: '链接 B', href: 'https://example.com/b' },
    ]);
  });

  test('零尺寸（不可见）链接跳过', () => {
    installDoc(
      '<html><body><a href="https://example.com/hidden">隐藏</a><a href="https://example.com/shown">可见</a></body></html>',
      { width: 0, height: 0 },
    );
    expect(collectDomLinksInPage()).toEqual([]);
  });

  test('同 href 去重、无文本链接跳过', () => {
    installDoc(
      '<html><body>' +
        '<a href="https://example.com/dup">第一次</a>' +
        '<a href="https://example.com/dup">第二次</a>' +
        '<a href="https://example.com/blank">   </a>' +
        '</body></html>',
      { width: 100, height: 20 },
    );
    expect(collectDomLinksInPage()).toEqual([{ text: '第一次', href: 'https://example.com/dup' }]);
  });

  test('文本截断到 60 字符、收集上限 30 个', () => {
    const long = '长'.repeat(100);
    const many = Array.from({ length: 35 }, (_, i) => `<a href="https://example.com/${i + 1}">链接 ${i + 1}</a>`).join('');
    installDoc(`<html><body><a href="https://example.com/long">${long}</a>${many}</body></html>`, {
      width: 100,
      height: 20,
    });
    const links = collectDomLinksInPage();
    expect(links).toHaveLength(30);
    expect(links[0].text).toBe('长'.repeat(60));
    expect(links[0].href).toBe('https://example.com/long');
    expect(links[1].href).toBe('https://example.com/1');
    expect(links[29].href).toBe('https://example.com/29');
  });
});
