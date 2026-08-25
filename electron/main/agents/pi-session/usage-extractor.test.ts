import { describe, it, expect } from 'bun:test';
import type { AssistantMessage } from '@earendil-works/pi-ai';
import {
  createPiUsageAccumulator,
  accumulatePiUsage,
  extractPiContextSnapshot,
  extractPiUsageEntry,
} from './usage-extractor.js';

function makeAssistant(overrides: Record<string, unknown> = {}): AssistantMessage {
  return {
    role: 'assistant',
    model: 'test-model',
    content: [],
    timestamp: Date.now(),
    stopReason: 'stop',
    usage: {
      input: 100,
      output: 20,
      cacheRead: 30,
      cacheWrite: 10,
      totalTokens: 160,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cacheWrite1h: 0, total: 0.001 },
    },
    ...overrides,
  } as AssistantMessage;
}

describe('extractPiContextSnapshot', () => {
  it('builds snapshot with input-side context tokens', () => {
    const snapshot = extractPiContextSnapshot(makeAssistant(), 3, () => 200000);
    expect(snapshot).not.toBeNull();
    expect(snapshot!.turnIndex).toBe(3);
    expect(snapshot!.totalTokens).toBe(140); // 100 + 30 + 10，不含 output
    expect(snapshot!.maxTokens).toBe(200000);
    expect(snapshot!.model).toBe('test-model');
  });

  it('returns null for message with errorMessage (失败轮不产 0% 假快照)', () => {
    const snapshot = extractPiContextSnapshot(
      makeAssistant({ stopReason: 'error', errorMessage: 'rate limit' }),
      0,
      () => 200000,
    );
    expect(snapshot).toBeNull();
  });

  it('returns null for message without usage', () => {
    expect(extractPiContextSnapshot(makeAssistant({ usage: undefined }), 0, () => 1)).toBeNull();
  });
});

describe('extractPiUsageEntry lastContextTokens', () => {
  it('attaches lastContextTokens when provided', () => {
    const accum = createPiUsageAccumulator();
    accumulatePiUsage(accum, makeAssistant());
    const entry = extractPiUsageEntry(accum, [], 5, undefined, undefined, 24703);
    expect(entry.turnIndex).toBe(5);
    expect(entry.lastContextTokens).toBe(24703);
  });

  it('omits lastContextTokens when not provided', () => {
    const accum = createPiUsageAccumulator();
    accumulatePiUsage(accum, makeAssistant());
    const entry = extractPiUsageEntry(accum, [], 0);
    expect(entry.lastContextTokens).toBeUndefined();
  });
});
