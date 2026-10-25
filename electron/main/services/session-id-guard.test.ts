/**
 * sessionId 丢失防护测试：attach 防线（时间对齐找回）+ withConversationsTxn 置空审计。
 *
 * electron/tipc stub 经由 delegation-test-mocks 顶层注册（进程级 mock，与 delegation 系列
 * 共用同一份实现，保证 bun 全量合跑时顺序无关）；本文件不调用 installDelegationMocks，
 * conversation-service / session-id-repair 均为真实实现。
 */
import { test, expect, beforeEach, afterEach, afterAll } from 'bun:test';
import '../agents/delegation-test-mocks.js';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

const { findAlignedHarness, recoverAlignedHarnessForConversation, repairNullSessionIdsAcrossWorkspaces } =
  await import('./session-id-repair.js');
const { withConversationsTxn } = await import('./conversation-service.js');
const { initConfigDir } = await import('../agents/logger.js');

const T0 = Date.parse('2026-09-05T03:06:36.014Z');

let configDir: string;
let prevEnv: string | undefined;
let warnCalls: string[];
const origWarn = console.warn;

beforeEach(async () => {
  configDir = await fs.mkdtemp(path.join(os.tmpdir(), 'dogear-session-id-guard-'));
  prevEnv = process.env.DOGEAR_CONFIG_DIR;
  // getConfigDir 首次调用后缓存固化（可能已被先前测试文件触发），必须 initConfigDir 强刷
  initConfigDir(configDir);
  process.env.DOGEAR_CONFIG_DIR = configDir;
  warnCalls = [];
  console.warn = (...args: unknown[]) => { warnCalls.push(args.map(String).join(' ')); };
});

afterEach(() => {
  console.warn = origWarn;
});

afterAll(async () => {
  initConfigDir(prevEnv ?? path.join(process.cwd(), '.dogear'));
  if (prevEnv === undefined) delete process.env.DOGEAR_CONFIG_DIR;
  else process.env.DOGEAR_CONFIG_DIR = prevEnv;
  await fs.rm(configDir, { recursive: true, force: true });
});

async function seedHarness(workspaceId: string, createdAtMs: number, sessionId: string): Promise<void> {
  const dir = path.join(configDir, 'workspaces', workspaceId, 'sessions', sessionId);
  await fs.mkdir(dir, { recursive: true });
  const meta = { id: sessionId, createdAt: createdAtMs, cwd: path.join(configDir, 'workspaces', workspaceId), conversationId: 2 };
  await Promise.all([
    fs.writeFile(path.join(dir, 'session.json'), JSON.stringify(meta), 'utf-8'),
    fs.writeFile(path.join(dir, 'main.jsonl'), '', 'utf-8'),
  ]);
}

interface SeedConv {
  id: string;
  sessionId: string | null;
  createdAtMs: number;
  turnCount?: number;
}

async function seedConversations(workspaceId: string, convs: SeedConv[]): Promise<void> {
  const dir = path.join(configDir, 'workspaces', workspaceId);
  await fs.mkdir(dir, { recursive: true });
  const conversations: Record<string, unknown> = {};
  for (const c of convs) {
    const iso = new Date(c.createdAtMs).toISOString();
    conversations[c.id] = {
      id: c.id,
      title: `conv-${c.id}`,
      sessionId: c.sessionId,
      workspaceId,
      parentConversationId: null,
      forkMessageSdkUuid: null,
      modelSelection: null,
      groupId: 'g1',
      role: 'main',
      createdAt: iso,
      updatedAt: iso,
      usageSummary: { turnCount: c.turnCount ?? 0, totalInputTokens: 0, totalOutputTokens: 0, totalCacheReadTokens: 0 },
    };
  }
  await fs.writeFile(path.join(dir, 'conversations.json'), JSON.stringify({ version: 2, conversations }, null, 2));
}

async function readConversations(workspaceId: string): Promise<{ conversations: Record<string, { sessionId: string | null; title: string }> }> {
  return JSON.parse(await fs.readFile(path.join(configDir, 'workspaces', workspaceId, 'conversations.json'), 'utf-8'));
}

function guardConversation(c: SeedConv) {
  return {
    id: c.id,
    sessionId: c.sessionId,
    createdAt: new Date(c.createdAtMs).toISOString(),
    title: `conv-${c.id}`,
    usageSummary: c.turnCount === undefined ? undefined : { turnCount: c.turnCount },
  };
}

// ============================================================
// findAlignedHarness：±2s 窗口 / taken 过滤 / 最近匹配
// ============================================================

test('findAlignedHarness：窗口内取时间最近、taken 过滤、窗口外排除', async () => {
  await seedHarness('ws1', T0 - 1000, 'aa01');
  await seedHarness('ws1', T0 + 500, 'aa02');
  await seedHarness('ws1', T0 + 2500, 'aa03');

  expect((await findAlignedHarness('ws1', T0, new Set()))?.sessionId).toBe('aa02');
  expect((await findAlignedHarness('ws1', T0, new Set(['aa02'])))?.sessionId).toBe('aa01');
  expect(await findAlignedHarness('ws1', T0, new Set(['aa01', 'aa02']))).toBeNull();
});

test('findAlignedHarness：无任何 harness 文件时返回 null', async () => {
  expect(await findAlignedHarness('ws1', T0, new Set())).toBeNull();
});

// ============================================================
// attach 防线：recoverAlignedHarnessForConversation
// ============================================================

test('防线命中：sessionId null + turnCount>0 + 存在对齐 harness → 回填并返回 sessionId', async () => {
  await seedHarness('ws1', T0 + 200, 'aa01');
  await seedConversations('ws1', [{ id: 'c1', sessionId: null, createdAtMs: T0, turnCount: 5 }]);

  const recovered = await recoverAlignedHarnessForConversation('ws1', guardConversation({ id: 'c1', sessionId: null, createdAtMs: T0, turnCount: 5 }));
  expect(recovered).toBe('aa01');
  expect((await readConversations('ws1')).conversations.c1.sessionId).toBe('aa01');
});

test('防线多候选：taken 过滤后选未被占用的最近候选（CreateSessionBatch 相近创建场景）', async () => {
  await seedHarness('ws1', T0 - 300, 'aa01');
  await seedHarness('ws1', T0 + 100, 'aa02');
  await seedConversations('ws1', [
    { id: 'c1', sessionId: null, createdAtMs: T0, turnCount: 3 },
    { id: 'c2', sessionId: 'aa02', createdAtMs: T0 + 120, turnCount: 1 },
  ]);

  const recovered = await recoverAlignedHarnessForConversation('ws1', guardConversation({ id: 'c1', sessionId: null, createdAtMs: T0, turnCount: 3 }));
  expect(recovered).toBe('aa01');
});

test('防线降级：无对齐候选 → 返回 null + warn，不抛错不写盘', async () => {
  await seedHarness('ws1', T0 + 9000, 'aa01');
  await seedConversations('ws1', [{ id: 'c1', sessionId: null, createdAtMs: T0, turnCount: 2 }]);

  const recovered = await recoverAlignedHarnessForConversation('ws1', guardConversation({ id: 'c1', sessionId: null, createdAtMs: T0, turnCount: 2 }));
  expect(recovered).toBeNull();
  expect(warnCalls.some((w) => w.includes('c1') && w.includes('降级新建'))).toBe(true);
  expect((await readConversations('ws1')).conversations.c1.sessionId).toBeNull();
});

test('防线不误触：turnCount=0 的首 attach 即使存在对齐 harness 也不回填', async () => {
  await seedHarness('ws1', T0, 'aa01');
  await seedConversations('ws1', [{ id: 'c1', sessionId: null, createdAtMs: T0, turnCount: 0 }]);

  const recovered = await recoverAlignedHarnessForConversation('ws1', guardConversation({ id: 'c1', sessionId: null, createdAtMs: T0 }));
  expect(recovered).toBeNull();
  expect(warnCalls).toHaveLength(0);
  expect((await readConversations('ws1')).conversations.c1.sessionId).toBeNull();
});

test('防线不误触：sessionId 完好时直接返回 null', async () => {
  const recovered = await recoverAlignedHarnessForConversation('ws1', guardConversation({ id: 'c1', sessionId: 'bb01', createdAtMs: T0, turnCount: 8 }));
  expect(recovered).toBeNull();
  expect(warnCalls).toHaveLength(0);
});

// ============================================================
// 启动批量自愈回归（复用提取的对齐函数）
// ============================================================

test('批量自愈：可对齐的回填、无候选的跳过', async () => {
  await seedHarness('ws1', T0 + 100, 'aa01');
  await seedConversations('ws1', [
    { id: 'c1', sessionId: null, createdAtMs: T0, turnCount: 3 },
    { id: 'c2', sessionId: null, createdAtMs: T0 - 8000, turnCount: 1 },
  ]);

  await repairNullSessionIdsAcrossWorkspaces();

  const file = await readConversations('ws1');
  expect(file.conversations.c1.sessionId).toBe('aa01');
  expect(file.conversations.c2.sessionId).toBeNull();
});

// ============================================================
// withConversationsTxn：sessionId 置空审计
// ============================================================

test('txn 审计：常规写入（改 title）不触发置空告警', async () => {
  await seedConversations('ws1', [{ id: 'c1', sessionId: 'aa01', createdAtMs: T0, turnCount: 1 }]);

  await withConversationsTxn('ws1', async (file) => {
    file.conversations.c1.title = '改名';
  });

  expect((await readConversations('ws1')).conversations.c1.title).toBe('改名');
  expect(warnCalls.filter((w) => w.includes('txn 审计'))).toHaveLength(0);
});

test('txn 审计：sessionId 置空触发一次 warn（含原值）且不阻断写盘', async () => {
  await seedConversations('ws1', [{ id: 'c1', sessionId: 'aa01', createdAtMs: T0, turnCount: 1 }]);

  await withConversationsTxn('ws1', async (file) => {
    file.conversations.c1.sessionId = null;
  });

  const audits = warnCalls.filter((w) => w.includes('txn 审计'));
  expect(audits).toHaveLength(1);
  expect(audits[0]).toContain('c1');
  expect(audits[0]).toContain('aa01');
  expect(audits[0]).toContain('at ');  // 调用栈
  expect((await readConversations('ws1')).conversations.c1.sessionId).toBeNull();
});

test('txn 审计：删除会话不触发置空告警（delete 非置空）', async () => {
  await seedConversations('ws1', [{ id: 'c1', sessionId: 'aa01', createdAtMs: T0, turnCount: 1 }]);

  await withConversationsTxn('ws1', async (file) => {
    delete file.conversations.c1;
  });

  expect((await readConversations('ws1')).conversations.c1).toBeUndefined();
  expect(warnCalls.filter((w) => w.includes('txn 审计'))).toHaveLength(0);
});

test('txn 审计：新增 sessionId 为 null 的会话不触发（无 truthy 前值）', async () => {
  await seedConversations('ws1', [{ id: 'c1', sessionId: 'aa01', createdAtMs: T0, turnCount: 1 }]);

  await withConversationsTxn('ws1', async (file) => {
    file.conversations.c2 = {
      id: 'c2', title: '新会话', sessionId: null, workspaceId: 'ws1', parentConversationId: null,
      forkMessageSdkUuid: null, modelSelection: null, groupId: 'g1', role: 'main',
      createdAt: new Date(T0).toISOString(), updatedAt: new Date(T0).toISOString(),
    };
  });

  expect(warnCalls.filter((w) => w.includes('txn 审计'))).toHaveLength(0);
});
