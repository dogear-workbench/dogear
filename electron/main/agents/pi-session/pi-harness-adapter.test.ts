import { describe, expect, test } from 'bun:test';
import type { AgentEvent } from '@earendil-works/pi-durable';
import { CompactionFailureTracker, deriveCompactionSettings } from './pi-harness-adapter';

describe('deriveCompactionSettings', () => {
  test('32K 小窗口收紧到下限附近：预留不超过窗口一半', () => {
    const s = deriveCompactionSettings(32 * 1024);
    expect(s.enabled).toBe(true);
    expect(s.reserveTokens).toBe(4096);
    expect(s.keepRecentTokens).toBe(6144);
    expect(s.reserveTokens + s.keepRecentTokens).toBeLessThan(32 * 1024 / 2);
  });

  test('64K 窗口按比例推导', () => {
    const s = deriveCompactionSettings(64 * 1024);
    expect(s.reserveTokens).toBe(8192);
    expect(s.keepRecentTokens).toBe(9830);
  });

  test('128K 窗口≈上游默认值', () => {
    const s = deriveCompactionSettings(128 * 1024);
    expect(s.reserveTokens).toBe(16384);
    expect(s.keepRecentTokens).toBe(19661);
  });

  test('200K 及以上封顶=上游默认，大窗口行为与现状一致', () => {
    for (const window of [200 * 1024, 1024 * 1024, 2048 * 1024]) {
      const s = deriveCompactionSettings(window);
      expect(s.reserveTokens).toBe(16384);
      expect(s.keepRecentTokens).toBe(20000);
    }
  });

  test('极小窗口也保住下限', () => {
    const s = deriveCompactionSettings(8 * 1024);
    expect(s.reserveTokens).toBe(4096);
    expect(s.keepRecentTokens).toBe(6144);
  });
});

describe('CompactionFailureTracker', () => {
  const compactionEnd = (error?: string) =>
    ({ type: 'compaction_end', taskId: 1, reason: 'threshold', ...(error !== undefined ? { error } : {}) }) as unknown as AgentEvent;
  const summaryAppended = () =>
    ({ type: 'entry_appended', entry: { id: 9, kind: 'pi.compaction' } }) as unknown as AgentEvent;
  const otherAppended = () =>
    ({ type: 'entry_appended', entry: { id: 10, kind: 'pi.assistant' } }) as unknown as AgentEvent;
  const snapshot = (failure?: { error: string }) =>
    ({ type: 'snapshot', ...(failure !== undefined ? { compactionFailure: failure } : {}) }) as unknown as AgentEvent;

  test('compaction_end 带 error 置位；重复置位与无 error 终态不再翻转', () => {
    const t = new CompactionFailureTracker();
    expect(t.consume(compactionEnd('超时'))).toEqual({ failed: true, error: '超时' });
    expect(t.isFailed()).toBe(true);
    expect(t.consume(compactionEnd('再次失败'))).toBeUndefined();
    expect(t.consume(compactionEnd(undefined))).toBeUndefined();
    expect(t.isFailed()).toBe(true);
  });

  test('无前置失败时 summary 落盘与非压缩 entry 都不产生信号', () => {
    const t = new CompactionFailureTracker();
    expect(t.consume(summaryAppended())).toBeUndefined();
    expect(t.consume(otherAppended())).toBeUndefined();
    expect(t.isFailed()).toBe(false);
  });

  test('失败后 summary 落盘恢复；非压缩 entry 不影响持续态（中断/无可压缩留置语义）', () => {
    const t = new CompactionFailureTracker();
    t.consume(compactionEnd('超时'));
    expect(t.consume(otherAppended())).toBeUndefined();
    expect(t.isFailed()).toBe(true);
    expect(t.consume(summaryAppended())).toEqual({ failed: false });
    expect(t.isFailed()).toBe(false);
  });

  test('snapshot 对账：与当前态一致不翻转，不一致时双向校正', () => {
    const t = new CompactionFailureTracker();
    expect(t.consume(snapshot(undefined))).toBeUndefined();
    expect(t.consume(snapshot({ error: 'key 失效' }))).toEqual({ failed: true, error: 'key 失效' });
    expect(t.consume(snapshot({ error: 'key 失效' }))).toBeUndefined();
    expect(t.consume(snapshot(undefined))).toEqual({ failed: false });
    expect(t.isFailed()).toBe(false);
  });

  test('snapshot 对账覆盖事件路径置位后的恢复', () => {
    const t = new CompactionFailureTracker();
    t.consume(compactionEnd('超时'));
    expect(t.consume(snapshot({ error: '超时' }))).toBeUndefined();
    expect(t.consume(snapshot(undefined))).toEqual({ failed: false });
  });
});
