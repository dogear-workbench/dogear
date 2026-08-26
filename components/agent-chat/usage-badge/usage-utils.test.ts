import { test, expect } from 'bun:test';
import { resolveContext, formatTokens, cacheHitRate } from './usage-utils.ts';
import type { ContextSnapshot } from '@/types/usage';

function snap(over: Partial<ContextSnapshot> = {}): ContextSnapshot {
  return {
    turnIndex: 0, timestamp: 0, totalTokens: 34000, maxTokens: 200000,
    percentage: 17, model: 'claude-opus-4-7', categories: [], ...over,
  };
}

test('resolveContext 用快照的 totalTokens/maxTokens 按 used/limit 重算占比', () => {
  const r = resolveContext(snap());
  expect(r.used).toBe(34000);
  expect(r.limit).toBe(200000);
  expect(Math.round(r.percentage)).toBe(17);
  expect(r.label).toBe('200k');
  expect(r.nearCompact).toBe(false);
});
test('resolveContext maxTokens 缺失只给 used、不画进度', () => {
  const r = resolveContext(snap({ maxTokens: 0 }));
  expect(r.used).toBe(34000);
  expect(r.limit).toBe(0);
  expect(r.label).toBe('');
  expect(r.nearCompact).toBe(false);
});
test('resolveContext 无快照返回 used=null', () => {
  expect(resolveContext(undefined).used).toBeNull();
});
test('resolveContext 占用超过 autoCompactPercent 时 nearCompact=true', () => {
  const r = resolveContext(snap({ totalTokens: 170_000, percentage: 85 }), 80);
  expect(Math.round(r.percentage)).toBe(85);
  expect(r.nearCompact).toBe(true);
});
test('resolveContext 自定义阈值生效（90 时 85% 尚未接近压缩）', () => {
  const r = resolveContext(snap({ totalTokens: 170_000 }), 90);
  expect(r.nearCompact).toBe(false);
});
test('formatTokens 阶梯单位缩写', () => {
  expect(formatTokens(15632)).toBe('15.6k');
  expect(formatTokens(900000)).toBe('900k');
  expect(formatTokens(1_234_567)).toBe('1.23M');
  expect(formatTokens(1_200_000)).toBe('1.2M');
  expect(formatTokens(100_000_000)).toBe('100M');
  expect(formatTokens(1_234_567_890)).toBe('1.23G');
  expect(formatTokens(2_000_000_000)).toBe('2G');
});
test('cacheHitRate = cacheRead / (input+cacheRead)', () => {
  expect(cacheHitRate({ inputTokens: 100, cacheReadInputTokens: 900 } as any)).toBeCloseTo(0.9);
});
