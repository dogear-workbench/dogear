import { test, expect } from 'bun:test';
import { isReportStale } from './review-scanner.ts';
import type { ReportDoc } from './review-store.ts';

function report(updatedAt: string): ReportDoc {
  return { updatedAt, markdown: '' };
}

test('无摘要卡 → 不脏', () => {
  expect(isReportStale(null, null)).toBe(false);
  expect(isReportStale(report('2026-06-01T00:00:00Z'), null)).toBe(false);
});

test('有摘要卡但无报告 → 脏', () => {
  expect(isReportStale(null, '2026-06-07T00:00:00Z')).toBe(true);
});

test('最新摘要卡晚于报告 → 脏', () => {
  expect(isReportStale(report('2026-06-06T00:00:00Z'), '2026-06-07T00:00:00Z')).toBe(true);
});

test('最新摘要卡不晚于报告 → 不脏', () => {
  expect(isReportStale(report('2026-06-07T00:00:00Z'), '2026-06-07T00:00:00Z')).toBe(false);
});
