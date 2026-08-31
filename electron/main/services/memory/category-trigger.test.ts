// category-trigger.ts 顶层 named import electron(BrowserWindow) 与 @egoist/tipc/main，
// bun 下真实 electron 是 CJS 路径字符串，named import 链接即失败；必须先 mock 再动态加载被测模块。
// electron/tipc stub 与 delegation 系共用同一份（delegation-test-mocks 顶层注册，幂等覆盖）。
import '../../agents/delegation-test-mocks.js';

const { classifyCategorizeOutcome } = await import('./category-trigger.ts');
const { TaskStatus } = await import('../../agents/task-types.ts');

import { test, expect } from 'bun:test';

test('cancelled 状态优先返回 cancelled', () => {
  expect(classifyCategorizeOutcome({ decisions: { match: 5 } }, undefined, TaskStatus.CANCELLED)).toBe('cancelled');
});

test('result.cancelled 也判 cancelled', () => {
  expect(classifyCategorizeOutcome({ cancelled: true })).toBe('cancelled');
});

test('error 字段或 result.error 都判 error', () => {
  expect(classifyCategorizeOutcome({ decisions: { match: 1 } }, 'fatal')).toBe('error');
  expect(classifyCategorizeOutcome({ error: 'fatal' })).toBe('error');
});

test('decisions 优先级 match > join > new > skip > error', () => {
  expect(classifyCategorizeOutcome({ decisions: { match: 1, join: 1, new: 1, skip: 1, error: 1 } })).toBe('match');
  expect(classifyCategorizeOutcome({ decisions: { join: 1, new: 1 } })).toBe('join');
  expect(classifyCategorizeOutcome({ decisions: { new: 1, skip: 1 } })).toBe('new');
  expect(classifyCategorizeOutcome({ decisions: { skip: 2 } })).toBe('skip');
  expect(classifyCategorizeOutcome({ decisions: { error: 2 } })).toBe('error');
});

test('decisions 全 0 或缺失 fallback skip', () => {
  expect(classifyCategorizeOutcome({ decisions: {} })).toBe('skip');
  expect(classifyCategorizeOutcome({})).toBe('skip');
  expect(classifyCategorizeOutcome(null)).toBe('skip');
});
