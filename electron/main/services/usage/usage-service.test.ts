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

import { appendEntry, appendCompactMarker, appendContext, readUsage, readNextTurnIndex, deleteUsage } from './usage-service.js';
// applyUsageSummary 测试放在本文件而非独立 conversation-service 测试文件：bun 全量单进程时
// delegation 系列的 mock.module 会把 conversation-service 换成缺 applyUsageSummary 的部分 mock，
// 排在 delegation 之后加载的任何新测试文件都会文件级 SyntaxError（基线污染之一）；本文件已在既有失败集合内。
import { applyUsageSummary } from '../conversation-service.js';
import type { ConversationUsageEntry, ConversationIndex, CompactMarker, ContextSnapshot } from '../../types.js';

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
    toolActivity: { calls: [{ name: 'Bash', count: 2 }], totalCalls: 2 },
    ...overrides,
  };
}

describe('usage-service', () => {
  it('appends entries and compact marker, reads back correctly', async () => {
    await appendEntry(TEST_ID, makeEntry({
      uuid: 'e1', turnIndex: 0, totalCostUsd: 0.001,
      usage: { inputTokens: 100, outputTokens: 50, cacheCreationInputTokens: 10, cacheReadInputTokens: 5 },
    }));
    await appendEntry(TEST_ID, makeEntry({
      uuid: 'e2', turnIndex: 1, totalCostUsd: 0.002,
      usage: { inputTokens: 200, outputTokens: 80, cacheCreationInputTokens: 0, cacheReadInputTokens: 20 },
      toolActivity: { calls: [{ name: 'Read', count: 3 }], totalCalls: 3 },
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

describe('readNextTurnIndex', () => {
  it('returns last entry turnIndex + 1, skipping context/compact/garbage lines', async () => {
    const id = `__usage_turnidx_test__${randomUUID()}`;
    const file = path.join(tmpBase, 'usage', `${id}.jsonl`);
    await fs.mkdir(path.dirname(file), { recursive: true });
    const lines = [
      JSON.stringify({ kind: 'entry', turnIndex: 0 }),
      JSON.stringify({ kind: 'context', turnIndex: 0, totalTokens: 5 }),
      JSON.stringify({ kind: 'entry', turnIndex: 2 }),
      'not-json',
      JSON.stringify({ kind: 'compact', afterTurnIndex: 2 }),
    ];
    await fs.writeFile(file, lines.join('\n') + '\n', 'utf-8');

    expect(await readNextTurnIndex(id)).toBe(3);
  });

  it('returns 0 for nonexistent file or file without entries', async () => {
    expect(await readNextTurnIndex(`__no_such__${randomUUID()}`)).toBe(0);

    const id = `__usage_turnidx_empty__${randomUUID()}`;
    const file = path.join(tmpBase, 'usage', `${id}.jsonl`);
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, JSON.stringify({ kind: 'context', turnIndex: 7, totalTokens: 1 }) + '\n', 'utf-8');

    expect(await readNextTurnIndex(id)).toBe(0);
  });

  it('returns 0 for unsafe conversationId', async () => {
    expect(await readNextTurnIndex('../evil')).toBe(0);
  });
});

describe('applyUsageSummary lastContextSize 口径', () => {
  const workspaceId = 'ws-summary-test';
  const conversationId = randomUUID();

  async function writeConversationFile(): Promise<void> {
    const dir = path.join(tmpBase, 'workspaces', workspaceId);
    await fs.mkdir(dir, { recursive: true });
    const now = new Date().toISOString();
    const base: ConversationIndex = {
      id: conversationId,
      title: 'summary 测试会话',
      sessionId: null,
      workspaceId,
      parentConversationId: null,
      forkMessageSdkUuid: null,
      modelSelection: null,
      createdAt: now,
      updatedAt: now,
    };
    await fs.writeFile(
      path.join(dir, 'conversations.json'),
      JSON.stringify({ version: 2, conversations: { [conversationId]: base } }),
      'utf-8',
    );
  }

  async function readUsageSummary(): Promise<ConversationIndex['usageSummary']> {
    const raw = await fs.readFile(path.join(tmpBase, 'workspaces', workspaceId, 'conversations.json'), 'utf-8');
    return (JSON.parse(raw) as { conversations: Record<string, ConversationIndex> })
      .conversations[conversationId].usageSummary;
  }

  function makeSummaryEntry(overrides: Partial<ConversationUsageEntry> = {}): ConversationUsageEntry {
    return {
      ...makeEntry(),
      usage: {
        inputTokens: 87022,
        outputTokens: 8887,
        cacheCreationInputTokens: 0,
        cacheReadInputTokens: 146944,
      },
      ...overrides,
    };
  }

  it('uses entry.lastContextTokens（真实上下文）而非轮内累加值', async () => {
    await writeConversationFile();
    await applyUsageSummary(conversationId, makeSummaryEntry({ lastContextTokens: 24703 }));

    const summary = await readUsageSummary();
    expect(summary?.turnCount).toBe(1);
    expect(summary?.totalInputTokens).toBe(87022);
    expect(summary?.totalOutputTokens).toBe(8887);
    expect(summary?.totalCacheReadTokens).toBe(146944);
    expect(summary?.lastContextSize).toBe(24703);
  });

  it('falls back to legacy 累加口径 for entries without lastContextTokens', async () => {
    await applyUsageSummary(conversationId, makeSummaryEntry({
      usage: { inputTokens: 100, outputTokens: 10, cacheCreationInputTokens: 10, cacheReadInputTokens: 5 },
    }));

    const summary = await readUsageSummary();
    expect(summary?.turnCount).toBe(2);
    expect(summary?.lastContextSize).toBe(115);
  });
});
