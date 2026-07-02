import { test, expect } from 'bun:test';
import { resolveContext, formatTokens, cacheHitRate } from './usage-utils.ts';
import type { ContextSnapshot } from '@/types/usage';

function snap(over: Partial<ContextSnapshot> = {}): ContextSnapshot {
  return {
    turnIndex: 0, timestamp: 0, totalTokens: 34000, maxTokens: 200000,
    percentage: 17, model: 'claude-opus-4-7', categories: [], ...over,
  };
}

test('resolveContext 用快照的 totalTokens/maxTokens/percentage', () => {
  const r = resolveContext(snap());
  expect(r.used).toBe(34000);
  expect(r.limit).toBe(200000);
  expect(r.percentage).toBe(17);
  expect(r.label).toBe('200k');
});
test('resolveContext percentage 缺失时按 used/limit 推算', () => {
  const r = resolveContext(snap({ percentage: 0 }));
  expect(Math.round(r.percentage)).toBe(17);
});
test('resolveContext maxTokens 缺失只给 used、不画进度', () => {
  const r = resolveContext(snap({ maxTokens: 0 }));
  expect(r.used).toBe(34000);
  expect(r.limit).toBe(0);
  expect(r.label).toBe('');
});
test('resolveContext 无快照返回 used=null', () => {
  expect(resolveContext(undefined).used).toBeNull();
});
test('resolveContext autoCompactWindow 把上限收窄到用户设定值并重算占比', () => {
  const r = resolveContext(snap({ maxTokens: 1_000_000, percentage: 3 }), 500_000);
  expect(r.limit).toBe(500_000);
  expect(r.label).toBe('500k');
  expect(Math.round(r.percentage)).toBe(7); // 34000 / 500_000
});
test('resolveContext autoCompactWindow 超过模型上限被截断到 rawLimit', () => {
  const r = resolveContext(snap({ maxTokens: 200_000 }), 900_000);
  expect(r.limit).toBe(200_000);
});
test('resolveContext autoCompactWindow=0 走 SDK 上限', () => {
  const r = resolveContext(snap(), 0);
  expect(r.limit).toBe(200_000);
  expect(r.percentage).toBe(17);
});
test('formatTokens 千分位缩写', () => {
  expect(formatTokens(15632)).toBe('15.6k');
  expect(formatTokens(900000)).toBe('900k');
});
test('cacheHitRate = cacheRead / (input+cacheRead)', () => {
  expect(cacheHitRate({ inputTokens: 100, cacheReadInputTokens: 900 } as any)).toBeCloseTo(0.9);
});
