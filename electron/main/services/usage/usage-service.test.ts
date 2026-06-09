import { describe, it, expect, afterAll, beforeAll } from 'bun:test';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import { randomUUID } from 'crypto';

// 不再 mock electron（bun 并发跑多文件时 mock.module 会与别的测试相互覆盖）。
// 改用 DOGEAR_CONFIG_DIR env 让 getConfigDir() 走 env 分支，与 session-paths.ts 对齐。
let tmpBase: string;
let prevEnv: string | undefined;

beforeAll(async () => {
  tmpBase = await fs.mkdtemp(path.join(os.tmpdir(), 'dogear-usage-test-'));
  prevEnv = process.env.DOGEAR_CONFIG_DIR;
  process.env.DOGEAR_CONFIG_DIR = tmpBase;
});

afterAll(async () => {
  if (prevEnv === undefined) delete process.env.DOGEAR_CONFIG_DIR;
  else process.env.DOGEAR_CONFIG_DIR = prevEnv;
  await fs.rm(tmpBase, { recursive: true, force: true });
});

import { appendEntry, appendCompactMarker, appendContext, readUsage, deleteUsage } from './usage-service.js';
import type { ConversationUsageEntry, CompactMarker, ContextSnapshot } from '../../types.js';

const TEST_ID = `__usage_test__${randomUUID()}`;
const CTX_ID = `__usage_ctx_test__${randomUUID()}`;

function makeEntry(overrides: Partial<ConversationUsageEntry> = {}): ConversationUsageEntry {
  return {
    uuid: 'test-uuid-1',
    turnIndex: 0,
    timestamp: Date.now(),
    durationMs: 100,
    durationApiMs: 90,
    numTurns: 1,
    isError: false,
    totalCostUsd: 0.001,
    usage: {
      inputTokens: 100,
      outputTokens: 50,
      cacheCreationInputTokens: 10,
      cacheReadInputTokens: 5,
    },
    modelUsage: {},
    toolCalls: [{ name: 'Bash', count: 2 }],
    ...overrides,
  };
}

describe('usage-service', () => {
  it('appends entries and compact marker, reads back correctly', async () => {
    await appendEntry(TEST_ID, makeEntry({
      uuid: 'e1', turnIndex: 0, totalCostUsd: 0.001,
      usage: { inputTokens: 100, outputTokens: 50, cacheCreationInputTokens: 10, cacheReadInputTokens: 5 },
      toolCalls: [{ name: 'Bash', count: 2 }],
    }));
    await appendEntry(TEST_ID, makeEntry({
      uuid: 'e2', turnIndex: 1, totalCostUsd: 0.002,
      usage: { inputTokens: 200, outputTokens: 80, cacheCreationInputTokens: 0, cacheReadInputTokens: 20 },
      toolCalls: [{ name: 'Read', count: 3 }],
    }));

    const marker: CompactMarker = {
      uuid: 'c1',
      timestamp: Date.now(),
      afterTurnIndex: 1,
      trigger: 'manual',
      preTokens: 12000,
    };
    await appendCompactMarker(TEST_ID, marker);

    const usage = await readUsage(TEST_ID);

    expect(usage.entries.length).toBe(2);
    expect(usage.compactMarkers.length).toBe(1);
    expect(usage.totals.turnCount).toBe(2);
    expect(usage.totals.inputTokens).toBe(300);          // 100 + 200
    expect(usage.totals.outputTokens).toBe(130);         // 50 + 80
    expect(usage.totals.cacheCreationInputTokens).toBe(10);
    expect(usage.totals.cacheReadInputTokens).toBe(25);  // 5 + 20
    expect(usage.totals.totalCostUsd).toBeCloseTo(0.003);
    expect(usage.totals.toolCallCount).toBe(5);          // 2 + 3

    // kind 字段不应泄漏到 entries / compactMarkers
    expect((usage.entries[0] as any).kind).toBeUndefined();
    expect((usage.compactMarkers[0] as any).kind).toBeUndefined();
  });

  it('appends context snapshots and reads back only the latest', async () => {
    const snap1: ContextSnapshot = {
      turnIndex: 0, timestamp: Date.now(), totalTokens: 12000, maxTokens: 200000,
      percentage: 6, model: 'claude-opus-4-7', categories: [{ name: 'messages', tokens: 8000 }],
    };
    const snap2: ContextSnapshot = {
      turnIndex: 1, timestamp: Date.now() + 1, totalTokens: 34000, maxTokens: 200000,
      percentage: 17, model: 'claude-opus-4-7', categories: [{ name: 'messages', tokens: 30000 }],
    };
    await appendEntry(CTX_ID, makeEntry({ uuid: 'ce1', turnIndex: 0 }));
    await appendContext(CTX_ID, snap1);
    await appendEntry(CTX_ID, makeEntry({ uuid: 'ce2', turnIndex: 1 }));
    await appendContext(CTX_ID, snap2);

    const usage = await readUsage(CTX_ID);

    expect(usage.entries.length).toBe(2);
    expect(usage.latestContext?.totalTokens).toBe(34000);   // 取最后一条
    expect(usage.latestContext?.turnIndex).toBe(1);
    expect((usage.latestContext as any)?.kind).toBeUndefined();
  });

  it('returns empty usage for nonexistent conversationId', async () => {
    const result = await readUsage('__nonexistent_conversation__');
    expect(result.entries.length).toBe(0);
    expect(result.totals.turnCount).toBe(0);
    expect(result.totals.inputTokens).toBe(0);
  });

  it('deleteUsage removes the file and readUsage returns empty afterward', async () => {
    await deleteUsage(TEST_ID);
    const after = await readUsage(TEST_ID);
    expect(after.entries.length).toBe(0);
    expect(after.totals.turnCount).toBe(0);
  });

  it('deleteUsage on nonexistent file does not throw', async () => {
    await expect(deleteUsage('__never_existed__')).resolves.toBeUndefined();
  });
});
