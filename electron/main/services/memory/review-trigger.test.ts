import { test, expect } from 'bun:test';
import { classifyReviewOutcome, getReviewActivity } from './review-trigger.ts';

test('error 优先', () => {
  expect(classifyReviewOutcome({ saved: true }, 'boom')).toBe('error');
  expect(classifyReviewOutcome({ error: 'x' })).toBe('error');
});
test('saved → saved', () => {
  expect(classifyReviewOutcome({ saved: true })).toBe('saved');
});
test('未保存 → no-card', () => {
  expect(classifyReviewOutcome({ saved: false })).toBe('no-card');
});
test('初始活动为空闲', () => {
  const a = getReviewActivity();
  expect(a.current).toBeNull();
  expect(a.queueDepth).toBe(0);
});
