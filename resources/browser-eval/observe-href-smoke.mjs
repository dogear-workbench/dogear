import assert from 'node:assert/strict';
import { observeFn } from '../../extension/src/dom-actions.js';

let elementsInDoc = [];
globalThis.document = {
  querySelectorAll(selector) {
    if (selector === '[data-dogear-ref]') return [];
    return elementsInDoc;
  },
};
globalThis.window = {
  innerHeight: 300,
  getComputedStyle: () => ({ display: 'block', visibility: 'visible', pointerEvents: 'auto' }),
};

const makeEl = ({ tag, attrs = {}, href, text = '' }) => ({
  tagName: tag.toUpperCase(),
  innerText: text,
  ...(href ? { href } : {}),
  getAttribute: (name) => attrs[name] ?? null,
  setAttribute() {},
  removeAttribute() {},
  getBoundingClientRect: () => ({ top: 150, left: 0, width: 10, height: 10 }),
});

const longUrl = 'https://example.com/path?token=' + 'a'.repeat(500);
elementsInDoc = [
  makeEl({ tag: 'a', text: '笔记详情', href: 'https://www.xiaohongshu.com/explore/abc123' }),
  makeEl({ tag: 'button', text: '收藏' }),
  makeEl({ tag: 'a', text: '超长链接', href: longUrl }),
  makeEl({ tag: 'div', attrs: { role: 'link' }, text: '伪链接' }),
];

const els = observeFn(null, null, 3).elements;
assert.equal(els.length, 4);
assert.equal(els[0].href, 'https://www.xiaohongshu.com/explore/abc123');
assert.equal('href' in els[1], false);
assert.equal(els[2].href.length, 401);
assert.ok(els[2].href.endsWith('…'));
assert.ok(longUrl.startsWith(els[2].href.slice(0, 400)));
assert.equal('href' in els[3], false);
assert.equal(els[0].ref, 'e1@3');
assert.equal(els[0].text, '笔记详情');
assert.equal(els[0].role, 'link');

console.log('observe-href-smoke: 9 PASS');
