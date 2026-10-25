import { describe, test, expect, beforeAll, afterAll } from 'bun:test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { initConfigDir } from '../../agents/logger.js';
import { openNodeJsonlStorage } from '@earendil-works/pi-durable/storage/jsonl/node';
import { UsageDoc } from '@earendil-works/pi-durable';
import { createSession } from '@earendil-works/pi-durable';
import { BACKGROUND_CONTEXT } from '@earendil-works/chord/context';
import { migrateWorkspace, scanLegacyFiles } from './storage-migrator.js';
import { getPiSessionRepository } from './pi-session-repository.js';
import { readSessionBranchFile } from './session-history-reader.js';
import { parseLegacySession } from './legacy-session-format.js';

const WS = 'w1';
const WS2 = 'w2';
const UUID_A = '11111111-1111-4111-8111-111111111111';
const UUID_B = '22222222-2222-4222-8222-222222222222';
const UUID_C = '33333333-3333-4333-8333-333333333333';
const UUID_D = '44444444-4444-4444-8444-444444444444';

let configDir: string;
let prevEnv: string | undefined;

const zeroUsage = {
  input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
};

function v3Header(id: string, iso: string): string {
  return JSON.stringify({ type: 'session', version: 3, id, timestamp: iso, cwd: 'C:\\legacy' });
}

function v3Message(id: string, parentId: string | null, iso: string, message: Record<string, unknown>): string {
  return JSON.stringify({ type: 'message', id, parentId, timestamp: iso, message });
}

function v4Header(id: string, createdAtMs: number): string {
  return JSON.stringify({ v: 4, kind: 'header', id, createdAt: createdAtMs, storageVersion: 1, cwd: 'C:\\legacy' });
}

function v4Entry(id: string, parentId: string | null, seq: number, ts: number, message: Record<string, unknown>): string {
  return JSON.stringify({ kind: 'entry', id, parentId, seq, timestamp: ts, type: 'message', message });
}

function v4Usage(id: string, usage: Record<string, unknown>): string {
  return JSON.stringify({ kind: 'usage', id, usage, entryId: 'x', adjustment: true, seq: 99 });
}

function v4Tip(entryId: string): string {
  return JSON.stringify({ kind: 'value', namespace: 'pi.branch.tip', key: 'main', op: 'set', value: entryId });
}

async function seedV3(sessionId: string): Promise<void> {
  const dir = path.join(configDir, 'workspaces', WS, 'sessions', '--C--legacy--');
  await fs.mkdir(dir, { recursive: true });
  const lines = [
    v3Header(sessionId, '2026-07-05T11:26:25.516Z'),
    v3Message('aaa', null, '2026-07-05T11:26:25.516Z', { role: 'user', content: [{ type: 'text', text: 'q1' }] }),
    v3Message('bbb', 'aaa', '2026-07-05T11:26:31.507Z', { role: 'assistant', content: [{ type: 'text', text: 'a1' }] }),
    v3Message('ccc', 'bbb', '2026-07-05T11:26:36.000Z', {
      role: 'toolResult', toolCallId: 'call_1', toolName: 'Bash',
      content: [{ type: 'text', text: 'out' }], isError: false, timestamp: 1783250796000,
    }),
  ];
  await fs.writeFile(path.join(dir, `2026-07-05T11-26-25-516Z_${sessionId}.jsonl`), lines.join('\n') + '\n', 'utf-8');
}

async function seedV4(sessionId: string): Promise<void> {
  const dir = path.join(configDir, 'workspaces', WS, 'sessions', '--C--legacy--');
  await fs.mkdir(dir, { recursive: true });
  const lines = [
    v4Header(sessionId, 1791631500221),
    v4Entry('e1', null, 1, 1791631500410, { role: 'user', content: [{ type: 'text', text: 'q2' }] }),
    v4Entry('e2', 'e1', 2, 1791631600000, {
      role: 'assistant', content: [{ type: 'text', text: 'a2' }],
      api: 'openai-responses', provider: 'openai', model: 'gpt-5',
      usage: { ...zeroUsage, input: 10, totalTokens: 10 }, stopReason: 'stop', timestamp: 1791631600000,
    }),
    v4Usage('u1', { ...zeroUsage, input: 100, output: 50, totalTokens: 150, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } }),
    JSON.stringify([{ kind: 'list', namespace: 'pi.pending.assistant_frame', op: 'append', value: 'frame' }]),
    v4Tip('e2'),
  ];
  await fs.writeFile(path.join(dir, `2026-10-10T11-25-00-220Z_${sessionId}.jsonl`), lines.map((l) => l).join('\n') + '\n', 'utf-8');
}

beforeAll(async () => {
  configDir = await fs.mkdtemp(path.join(os.tmpdir(), 'dogear-storage-migrator-'));
  prevEnv = process.env.DOGEAR_CONFIG_DIR;
  initConfigDir(configDir);
  process.env.DOGEAR_CONFIG_DIR = configDir;
  await fs.mkdir(path.join(configDir, 'workspaces', WS2, 'sessions'), { recursive: true });
});

afterAll(async () => {
  initConfigDir(prevEnv ?? path.join(process.cwd(), '.dogear'));
  if (prevEnv === undefined) delete process.env.DOGEAR_CONFIG_DIR;
  else process.env.DOGEAR_CONFIG_DIR = prevEnv;
  await fs.rm(configDir, { recursive: true, force: true });
});

describe('legacy-session-format', () => {
  test('v3 单链解析', () => {
    const content = [
      v3Header(UUID_A, '2026-07-05T11:26:25.516Z'),
      v3Message('aaa', null, '2026-07-05T11:26:25.516Z', { role: 'user', content: [] }),
    ].join('\n');
    const parsed = parseLegacySession(content, 'x.jsonl');
    expect(parsed.format).toBe('v3');
    expect(parsed.sessionId).toBe(UUID_A);
    expect(parsed.branch).toHaveLength(1);
    expect(parsed.branch[0].timestamp).toBe(Date.parse('2026-07-05T11:26:25.516Z'));
  });

  test('v4 tip 回溯与内部行丢弃计数', () => {
    const content = [
      v4Header(UUID_A, 1791631500221),
      v4Entry('e1', null, 1, 1, { role: 'user', content: [] }),
      v4Tip('e1'),
      JSON.stringify({ kind: 'list', namespace: 'pi.pending.assistant_frame', op: 'append', value: 'f' }),
    ].join('\n');
    const parsed = parseLegacySession(content, 'x.jsonl');
    expect(parsed.format).toBe('v4');
    expect(parsed.branch).toHaveLength(1);
    expect(parsed.droppedInternalLines).toBe(2);
  });

  test('末行半写容忍、非末行损坏报错', () => {
    const good = [
      v4Header(UUID_A, 1),
      v4Entry('e1', null, 1, 1, { role: 'user', content: [] }),
      v4Tip('e1'),
    ].join('\n');
    expect(parseLegacySession(good + '\n{"kind":"entr', 'x').branch).toHaveLength(1);
    expect(() => parseLegacySession([
      v4Header(UUID_A, 1),
      '{"broken"',
      v4Tip('e1'),
    ].join('\n'), 'x')).toThrow();
  });
});

describe('migrateWorkspace', () => {
  test('dry-run 出报告不落盘', async () => {
    await seedV3(UUID_A);
    await seedV4(UUID_B);
    const report = await migrateWorkspace(WS, { dryRun: true });
    expect(report.totalFiles).toBe(2);
    expect(report.v3).toBe(1);
    expect(report.v4).toBe(1);
    expect(report.converted).toBe(2);
    expect(report.entriesConverted).toBe(5);
    expect(report.usageRowsAggregated).toBe(1);
    expect(report.droppedInternalLines).toBe(2);
    expect(report.failed).toHaveLength(0);
    const scanned = await scanLegacyFiles(WS);
    expect(scanned).toHaveLength(2);
    const target = path.join(configDir, 'workspaces', WS, 'sessions', UUID_A, 'main.jsonl');
    expect(await fs.stat(target).then(() => true).catch(() => false)).toBe(false);
  });

  test('实转：目录布局、entry kind 映射、usage 聚合、backup 挪移', async () => {
    const report = await migrateWorkspace(WS, { dryRun: false });
    expect(report.converted).toBe(2);
    expect(report.failed).toHaveLength(0);

    const v3Dir = path.join(configDir, 'workspaces', WS, 'sessions', UUID_A);
    const meta = JSON.parse(await fs.readFile(path.join(v3Dir, 'session.json'), 'utf-8'));
    expect(meta.id).toBe(UUID_A);
    expect(meta.createdAt).toBe(Date.parse('2026-07-05T11:26:25.516Z'));
    expect(meta.cwd).toBe('C:\\legacy');

    const storage = await openNodeJsonlStorage(v3Dir, BACKGROUND_CONTEXT);
    const page = await storage.scanEntries({ conversationId: meta.conversationId, order: 'ascending' }, 50, undefined, BACKGROUND_CONTEXT);
    expect(page.items.map((e) => e.kind)).toEqual(['pi.user', 'pi.assistant', 'pi.tool-result']);
    const assistant = page.items[1].model?.[0] as Record<string, unknown>;
    expect(assistant.timestamp).toBe(Date.parse('2026-07-05T11:26:31.507Z'));
    expect(assistant.usage).toEqual(zeroUsage);
    expect(assistant.stopReason).toBe('stop');
    const toolResult = page.items[2].model?.[0] as Record<string, unknown>;
    expect(toolResult.timestamp).toBe(1783250796000);
    expect(page.items[2].data).toEqual({ diagnostics: [] });
    await storage.close(BACKGROUND_CONTEXT);

    const v4Dir = path.join(configDir, 'workspaces', WS, 'sessions', UUID_B);
    const v4Meta = JSON.parse(await fs.readFile(path.join(v4Dir, 'session.json'), 'utf-8'));
    const v4Storage = await openNodeJsonlStorage(v4Dir, BACKGROUND_CONTEXT);
    const v4Page = await v4Storage.scanEntries({ conversationId: v4Meta.conversationId, order: 'ascending' }, 50, undefined, BACKGROUND_CONTEXT);
    expect(v4Page.items).toHaveLength(2);
    const session = createSession(v4Storage);
    const usage = await session.snapshot(UsageDoc, v4Meta.conversationId, BACKGROUND_CONTEXT);
    expect(usage?.models['legacy/legacy']).toMatchObject({ input: 100, output: 50, totalTokens: 150 });
    await session.close(BACKGROUND_CONTEXT);

    const backup = path.join(configDir, 'workspaces', WS, 'sessions-legacy-backup', '--C--legacy--');
    expect(await fs.readdir(backup)).toContain(`2026-07-05T11-26-25-516Z_${UUID_A}.jsonl`);
    expect(await fs.readdir(path.join(configDir, 'workspaces', WS, 'sessions', '--C--legacy--')).catch(() => [])).toHaveLength(0);
  });

  test('幂等：目标已存在即跳过', async () => {
    const report = await migrateWorkspace(WS, { dryRun: false });
    expect(report.totalFiles).toBe(0);
    expect(report.skippedConverted).toBe(0);
    const rescan = await migrateWorkspace(WS, { dryRun: true });
    expect(rescan.totalFiles).toBe(0);
  });
});

describe('PiSessionRepository（新布局）', () => {
  test('create/open/getSessionPath/listSessionFiles/delete', async () => {
    const repository = getPiSessionRepository();
    const created = await repository.create(WS2);
    expect(created.info.id).toBeTruthy();
    expect(created.info.conversationId).toBeGreaterThan(0);
    await created.storage.close(BACKGROUND_CONTEXT);

    const reopened = await repository.open(WS2, created.info.id);
    expect(reopened.info.conversationId).toBe(created.info.conversationId);
    await reopened.storage.close(BACKGROUND_CONTEXT);

    const sessionPath = await repository.getSessionPath(WS2, created.info.id);
    expect(sessionPath.endsWith('main.jsonl')).toBe(true);
    const files = await repository.listSessionFiles(WS2);
    expect(files).toHaveLength(1);
    expect(files[0].sessionId).toBe(created.info.id);

    expect(await repository.delete(WS2, created.info.id)).toBe(true);
    expect(await repository.delete(WS2, created.info.id)).toBe(false);
    expect(await repository.listSessionFiles(WS2)).toHaveLength(0);
  });

  test('fork：全量/at/before 截断语义', async () => {
    const repository = getPiSessionRepository();
    const source = await repository.create(WS2, UUID_C);
    const { storage: s } = source;
    const entries = [
      { role: 'user', content: [{ type: 'text', text: 'q' }], timestamp: 1 },
      { role: 'assistant', content: [{ type: 'text', text: 'a' }], timestamp: 2, api: 'x', provider: 'x', model: 'x', usage: zeroUsage, stopReason: 'stop' },
      { role: 'assistant', content: [{ type: 'text', text: 'a2' }], timestamp: 3, api: 'x', provider: 'x', model: 'x', usage: zeroUsage, stopReason: 'stop' },
    ];
    const writes = [];
    for (const message of entries) {
      const id = await s.mintId();
      writes.push({ type: 'entry', value: { id, conversationId: source.info.conversationId, kind: message.role === 'user' ? 'pi.user' : 'pi.assistant', model: [message] } });
    }
    await s.commit(writes, BACKGROUND_CONTEXT);
    await s.close(BACKGROUND_CONTEXT);

    const branch = await readSessionBranchFile(source.info.filePath);
    expect(branch).toHaveLength(3);
    const atEntryId = branch[1].id;

    const full = await repository.fork(WS2, UUID_C);
    expect(full.info.id).not.toBe(UUID_C);
    expect(await readSessionBranchFile(full.info.filePath)).toHaveLength(3);
    await full.storage.close(BACKGROUND_CONTEXT);

    const at = await repository.fork(WS2, UUID_C, { entryId: atEntryId, position: 'at' });
    expect(await readSessionBranchFile(at.info.filePath)).toHaveLength(2);
    await at.storage.close(BACKGROUND_CONTEXT);

    const before = await repository.fork(WS2, UUID_C, { entryId: atEntryId, position: 'before' });
    expect(await readSessionBranchFile(before.info.filePath)).toHaveLength(1);
    await before.storage.close(BACKGROUND_CONTEXT);

    await expect(repository.fork(WS2, UUID_C, { entryId: 'nonexistent' })).rejects.toThrow('分叉点不存在');
    expect((await repository.listSessionFiles(WS2))).toHaveLength(4);
  });

  test('relocateSession：目录搬移 + cwd 改写', async () => {
    const repository = getPiSessionRepository();
    const created = await repository.create(WS, UUID_D);
    await created.storage.close(BACKGROUND_CONTEXT);
    const targetPath = await repository.relocateSession(WS, WS2, UUID_D);
    expect(targetPath.startsWith(path.join(configDir, 'workspaces', WS2))).toBe(true);
    const meta = JSON.parse(await fs.readFile(path.join(path.dirname(targetPath), 'session.json'), 'utf-8'));
    expect(meta.cwd).toBe(path.join(configDir, 'workspaces', WS2));
    expect(await repository.listSessionFiles(WS2).then((files) => files.some((f) => f.sessionId === UUID_D))).toBe(true);
    expect(await repository.delete(WS2, UUID_D)).toBe(true);
  });
});
