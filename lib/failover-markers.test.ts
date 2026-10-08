import { describe, expect, test } from 'bun:test';
import {
  FAILOVER_CONTINUE_SENTINEL,
  isQuotaErrorText,
  isFailoverContinueMessage,
  stripFailoverContinueSentinel,
  hasFailoverTakeover,
} from './failover-markers';

describe('isQuotaErrorText', () => {
  test('命中主进程同款关键词（大小写不敏感）', () => {
    expect(isQuotaErrorText('429 rate_limit_exceeded')).toBeTrue();
    expect(isQuotaErrorText('API quota exceeded')).toBeTrue();
    expect(isQuotaErrorText('账户余额不足')).toBeTrue();
    expect(isQuotaErrorText('Rate Limit for requests')).toBeTrue();
  });

  test('非 quota 错误不命中', () => {
    expect(isQuotaErrorText('500 Internal Server Error')).toBeFalse();
    expect(isQuotaErrorText('network timeout')).toBeFalse();
    expect(isQuotaErrorText('')).toBeFalse();
  });
});

describe('failover 续跑哨兵', () => {
  const prompt = `${FAILOVER_CONTINUE_SENTINEL}你因供应商费率限制中断，模型已切换为 X。`;

  test('isFailoverContinueMessage 只认前缀', () => {
    expect(isFailoverContinueMessage(prompt)).toBeTrue();
    expect(isFailoverContinueMessage('你因供应商费率限制中断，模型已切换为 X。')).toBeFalse();
    expect(isFailoverContinueMessage('')).toBeFalse();
  });

  test('strip 剥掉哨兵不显示', () => {
    expect(stripFailoverContinueSentinel(prompt)).toBe('你因供应商费率限制中断，模型已切换为 X。');
  });
});

describe('hasFailoverTakeover 接管窗口', () => {
  test('notice 在错误后 60s 内到达视为接管', () => {
    expect(hasFailoverTakeover([{ at: 1000 }], 0)).toBeTrue();
    expect(hasFailoverTakeover([{ at: 59_999 }], 0)).toBeTrue();
  });

  test('notice 早于错误（2s 容差内除外）或迟到超过 60s 不算接管', () => {
    expect(hasFailoverTakeover([{ at: -3000 }], 0)).toBeFalse();
    expect(hasFailoverTakeover([{ at: -2000 }], 0)).toBeTrue();
    expect(hasFailoverTakeover([{ at: 60_000 }], 0)).toBeFalse();
  });

  test('无 notice 不接管；多条 notice 任一命中即可', () => {
    expect(hasFailoverTakeover(undefined, 0)).toBeFalse();
    expect(hasFailoverTakeover([], 0)).toBeFalse();
    expect(hasFailoverTakeover([{ at: 5 }, { at: 999_999 }], 0)).toBeTrue();
  });
});
