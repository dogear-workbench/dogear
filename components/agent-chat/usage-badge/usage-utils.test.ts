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
test('formatTokens 千分位缩写', () => {
  expect(formatTokens(15632)).toBe('15.6k');
  expect(formatTokens(900000)).toBe('900k');
});
test('cacheHitRate = cacheRead / (input+cacheRead)', () => {
  expect(cacheHitRate({ inputTokens: 100, cacheReadInputTokens: 900 } as any)).toBeCloseTo(0.9);
});
