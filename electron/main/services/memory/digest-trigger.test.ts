import { test, expect } from 'bun:test';
import { classifyOutcome, whenDigestIdle } from './digest-trigger.js';

test('有 error 判为 error', () => {
  expect(classifyOutcome({ saved: false }, 'boom')).toBe('error');
  expect(classifyOutcome({ saved: false, error: 'x' })).toBe('error');
});
test('saved=true 判为 saved', () => {
  expect(classifyOutcome({ saved: true })).toBe('saved');
});
test('saved=false 且无 error 判为 no-card', () => {
  expect(classifyOutcome({ saved: false })).toBe('no-card');
});

test('队列空闲时 whenDigestIdle 立即 resolve', async () => {
  await whenDigestIdle(); // 无任务时应立即完成，不挂起
  expect(true).toBe(true);
});
