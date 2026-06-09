import { test, expect } from 'bun:test';
import { serializeReport, parseReport } from './review-store.ts';

test('报告 markdown + updatedAt 往返一致', () => {
  const md = '> 当前状态总结\n\n## 做了哪些（近 5 天）\n- 改了 X\n';
  const raw = serializeReport('2026-06-08T00:00:00.000Z', md);
  const doc = parseReport(raw);
  expect(doc.updatedAt).toBe('2026-06-08T00:00:00.000Z');
  expect(doc.markdown.trim()).toBe(md.trim());
});

test('无 frontmatter 时 updatedAt 为空串、正文原样', () => {
  const doc = parseReport('## 只有正文\n- a\n');
  expect(doc.updatedAt).toBe('');
  expect(doc.markdown).toContain('只有正文');
});
