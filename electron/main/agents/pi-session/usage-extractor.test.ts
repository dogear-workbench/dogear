import { describe, it, expect } from 'bun:test';
import type { AgentMessage } from '@earendil-works/pi-agent-core';
import type { AssistantMessage } from '@earendil-works/pi-ai';
import {
  createPiUsageAccumulator,
  accumulatePiUsage,
  estimateMessageBuckets,
  estimateTokens,
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

  it('estimateTokens: CJK ×1 + 其他 ×0.25 向上取整', () => {
    expect(estimateTokens('')).toBe(0);
    expect(estimateTokens('中文词汇')).toBe(4);
    expect(estimateTokens('abcdef')).toBe(2);
    expect(estimateTokens('中a')).toBe(2);
  });

  it('categories 按 totalTokens 等比缩放且合计恒等', () => {
    const snapshot = extractPiContextSnapshot(makeAssistant(), 0, () => 200000, [
      { name: '提示词·agent.md', tokens: 30 },
      { name: '消息·用户', tokens: 10 },
    ]);
    expect(snapshot!.totalTokens).toBe(140);
    expect(snapshot!.categories).toEqual([
      { name: '提示词·agent.md', tokens: 105 },
      { name: '消息·用户', tokens: 35 },
    ]);
  });

  it('round 残差并入最大桶，合计仍等于 totalTokens', () => {
    const snapshot = extractPiContextSnapshot(makeAssistant(), 0, () => 200000, [
      { name: 'a', tokens: 1 },
      { name: 'b', tokens: 1 },
      { name: 'c', tokens: 1 },
    ]);
    expect(snapshot!.categories).toEqual([
      { name: 'a', tokens: 46 },
      { name: 'b', tokens: 47 },
      { name: 'c', tokens: 47 },
    ]);
    const sum = snapshot!.categories.reduce((acc, c) => acc + c.tokens, 0);
    expect(sum).toBe(140);
  });

  it('composition 为空或 Σ=0 时 categories 留空（不除零）', () => {
    const none = extractPiContextSnapshot(makeAssistant(), 0, () => 200000);
    expect(none!.categories).toEqual([]);
    const empty = extractPiContextSnapshot(makeAssistant(), 0, () => 200000, []);
    expect(empty!.categories).toEqual([]);
    const zeroSum = extractPiContextSnapshot(makeAssistant(), 0, () => 200000, [
      { name: 'x', tokens: 0 },
    ]);
    expect(zeroSum!.categories).toEqual([]);
  });

  it('estimateMessageBuckets 按 user/assistant/toolResult 分桶', () => {
    const buckets = estimateMessageBuckets([
      { role: 'user', content: '你好', timestamp: 0 },
      {
        role: 'assistant',
        content: [
          { type: 'thinking', thinking: '思考' },
          { type: 'text', text: 'ok' },
          { type: 'toolCall', id: '1', name: 'Read', arguments: { file_path: 'a.ts' } },
        ],
      },
      {
        role: 'toolResult',
        toolCallId: '1',
        toolName: 'Read',
        content: [{ type: 'text', text: 'file content' }],
        isError: false,
        timestamp: 0,
      },
    ] as unknown as AgentMessage[]);
    expect(buckets.map((b) => b.name)).toEqual(['消息·用户', '消息·助手', '消息·工具结果']);
    expect(buckets[0].tokens).toBe(2);
    expect(buckets[1].tokens).toBeGreaterThan(0);
    expect(buckets[2].tokens).toBe(3);
  });

  it('estimateMessageBuckets: bashExecution/custom/compactionSummary 并入用户桶，excludeFromContext 跳过', () => {
    const buckets = estimateMessageBuckets([
      { role: 'compactionSummary', summary: '压缩摘要内容', tokensBefore: 0, timestamp: 0 },
      { role: 'custom', customType: 'x', content: '自定义', display: true, timestamp: 0 },
      { role: 'bashExecution', command: 'ls', output: 'out', exitCode: 0, cancelled: false, truncated: false, timestamp: 0 },
      { role: 'bashExecution', command: 'skip', output: '', exitCode: 0, cancelled: false, truncated: false, excludeFromContext: true, timestamp: 0 },
    ] as unknown as AgentMessage[]);
    expect(buckets[0].tokens).toBeGreaterThan(0);
    expect(buckets[1].tokens).toBe(0);
    expect(buckets[2].tokens).toBe(0);
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

describe('durationMs / durationApiMs', () => {
  it('单条消息：durationApiMs = durationMs，entry.durationMs = 首末差值', () => {
    const accum = createPiUsageAccumulator();
    accumulatePiUsage(accum, makeAssistant({ timestamp: 1000, durationMs: 2500 }));
    const entry = extractPiUsageEntry(accum, [], 0);
    expect(entry.durationApiMs).toBe(2500);
    expect(entry.durationMs).toBe(2500);
  });

  it('多轮串行：durationApiMs 求和，entry.durationMs 覆盖首次请求到末次响应（含中间间隔）', () => {
    const accum = createPiUsageAccumulator();
    accumulatePiUsage(accum, makeAssistant({ timestamp: 1000, durationMs: 2000 }));
    accumulatePiUsage(accum, makeAssistant({ timestamp: 8000, durationMs: 3000 }));
    const entry = extractPiUsageEntry(accum, [], 0);
    expect(entry.durationApiMs).toBe(5000);
    expect(entry.durationMs).toBe(10000);
  });

  it('durationMs 缺失（legacy 消息）时不产生负值，durationApiMs 保持 0', () => {
    const accum = createPiUsageAccumulator();
    accumulatePiUsage(accum, makeAssistant({ timestamp: 5000, durationMs: undefined }));
    const entry = extractPiUsageEntry(accum, [], 0);
    expect(entry.durationApiMs).toBe(0);
    expect(entry.durationMs).toBe(0);
  });

  it('时间戳乱序到达时取 min/max 包络', () => {
    const accum = createPiUsageAccumulator();
    accumulatePiUsage(accum, makeAssistant({ timestamp: 9000, durationMs: 1000 }));
    accumulatePiUsage(accum, makeAssistant({ timestamp: 1000, durationMs: 500 }));
    const entry = extractPiUsageEntry(accum, [], 0);
    expect(entry.durationApiMs).toBe(1500);
    expect(entry.durationMs).toBe(9000);
  });
});
