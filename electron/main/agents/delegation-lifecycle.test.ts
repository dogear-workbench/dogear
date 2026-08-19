import { expect, test } from 'bun:test';
import { classifyChildCompletion } from './delegation-lifecycle.ts';

test('正常结束但未交付归为 no_delivery', () => {
  expect(classifyChildCompletion({ subtype: 'success' }, false)).toEqual({
    terminalReason: 'no_delivery',
    lastError: '会话结束但未交付',
  });
});

test('正常结束且已交付：无死因', () => {
  expect(classifyChildCompletion({ subtype: 'success' }, true)).toEqual({});
});

test('失败终态保留模型错误原因', () => {
  expect(classifyChildCompletion({
    subtype: 'failed',
    error: { kind: 'model', message: '模型请求失败' },
  }, false)).toEqual({
    terminalReason: 'failed',
    lastError: '模型请求失败',
  });
});

test('取消终态保留取消原因', () => {
  expect(classifyChildCompletion({
    subtype: 'cancelled',
    error: { kind: 'cancelled', message: '用户中断' },
  }, false)).toEqual({
    terminalReason: 'cancelled',
    lastError: '用户中断',
  });
});

test('缺少错误详情时使用稳定兜底文本', () => {
  expect(classifyChildCompletion({ subtype: 'failed' }, false)).toEqual({
    terminalReason: 'failed',
    lastError: '会话运行失败',
  });
});
