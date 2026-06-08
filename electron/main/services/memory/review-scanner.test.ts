import { test, expect } from 'bun:test';
import { isReviewStale } from './review-scanner.ts';
import type { ReviewCard } from './review-store.ts';

function card(reviewedAt: string): ReviewCard {
  return { reviewedAt, coveredCount: 1, items: [] };
}

test('无复盘卡 → 脏', () => {
  expect(isReviewStale(null, '2026-06-07T00:00:00Z')).toBe(true);
});
test('最新摘要卡晚于上次复盘 → 脏', () => {
  expect(isReviewStale(card('2026-06-06T00:00:00Z'), '2026-06-07T00:00:00Z')).toBe(true);
});
test('最新摘要卡不晚于上次复盘 → 跳过', () => {
  expect(isReviewStale(card('2026-06-07T00:00:00Z'), '2026-06-06T00:00:00Z')).toBe(false);
});
test('无摘要卡（latest 为 null）→ 跳过', () => {
  expect(isReviewStale(card('2026-06-07T00:00:00Z'), null)).toBe(false);
});
test('无卡且无摘要卡 → 跳过', () => {
  expect(isReviewStale(null, null)).toBe(false);
});
