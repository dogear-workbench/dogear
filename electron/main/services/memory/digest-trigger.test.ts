import { test, expect } from 'bun:test';
import { classifyOutcome } from './digest-trigger.js';

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
