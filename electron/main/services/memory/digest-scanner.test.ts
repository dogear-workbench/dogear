import { test, expect } from 'bun:test';
import { isDirty } from './digest-scanner.ts';
import type { DigestCard } from './digest-store.ts';

function card(sourceMtime: number): DigestCard {
  return {
    sessionId: 's', title: 't', createdAt: '2026-01-01T00:00:00Z',
    sourceMtime, turnCount: 1, summary: '', items: [],
  };
}

test('无卡 → 脏', () => {
  expect(isDirty(null, 1000)).toBe(true);
});

test('mtime 变了 → 脏', () => {
  expect(isDirty(card(1000), 2000)).toBe(true);
});

test('mtime 一致 → 跳过', () => {
  expect(isDirty(card(1500), 1500)).toBe(false);
});
