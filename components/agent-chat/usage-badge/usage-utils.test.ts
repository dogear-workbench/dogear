import { test, expect } from 'bun:test';
import { resolveContextLimit, formatTokens, cacheHitRate, currentContextSize } from './usage-utils.ts';

test('1M 模式上限 900k 且带 1M 标签', () => {
  const r = resolveContextLimit({ contextWindow: 200000 } as any, true);
  expect(r.limit).toBe(900000); expect(r.label).toBe('1M');
});
test('普通模式取 modelUsage.contextWindow', () => {
  const r = resolveContextLimit({ contextWindow: 200000 } as any, false);
  expect(r.limit).toBe(200000);
});
test('contextWindow 缺失返回 limit=0（UI 据此不画进度条）', () => {
  const r = resolveContextLimit({ contextWindow: 0 } as any, false);
  expect(r.limit).toBe(0);
});
test('formatTokens 千分位缩写', () => {
  expect(formatTokens(15632)).toBe('15.6k');
  expect(formatTokens(900000)).toBe('900k');
});
test('cacheHitRate = cacheRead / (input+cacheRead)', () => {
  expect(cacheHitRate({ inputTokens: 100, cacheReadInputTokens: 900 } as any)).toBeCloseTo(0.9);
});
test('currentContextSize = input + cacheRead + cacheCreation', () => {
  expect(currentContextSize({ inputTokens: 100, cacheReadInputTokens: 900, cacheCreationInputTokens: 10 } as any)).toBe(1010);
});
