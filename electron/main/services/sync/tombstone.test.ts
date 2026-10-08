import { test, expect, mock, afterAll } from 'bun:test';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';

// server.ts 静态 import 链顶层拉进 electron 的命名导入，bun test 下会炸；先 mock 再动态加载（同 push-receive.test.ts）
mock.module('electron', () => ({
  default: { app: { getPath: () => tmpdir() }, nativeTheme: {} },
  app: { getPath: () => tmpdir() },
  nativeTheme: {},
}));

const { pruneTombstones, mergeTombstones, TOMBSTONE_MAX, readSyncStateFrom } = await import('./sync-state.js');
const { tombstoneCandidates, diffManifests, sha256File } = await import('./manifest.js');
const { applyPeerTombstones, propagateLocalDeletes } = await import('./tombstone.js');
const { deletePeerFile } = await import('./client.js');

// ── pruneTombstones：过期清理 + 上限 ──

test('pruneTombstones：过期（>90 天）墓碑剔除，未过期保留', () => {
  const now = Date.now();
  const result = pruneTombstones(
    {
      'a.md': { deletedAt: now - 91 * 24 * 60 * 60 * 1000, deviceId: 'd1' },
      'b.md': { deletedAt: now - 89 * 24 * 60 * 60 * 1000, deviceId: 'd1' },
      'c.md': { deletedAt: now, deviceId: 'd2' },
    },
    now,
  );
  expect(Object.keys(result).sort()).toEqual(['b.md', 'c.md']);
});

test(`pruneTombstones：超过上限 ${TOMBSTONE_MAX} 条丢最旧`, () => {
  const now = Date.now();
  const input: Record<string, { deletedAt: number; deviceId: string }> = {};
  for (let i = 0; i < TOMBSTONE_MAX + 5; i++) {
    input[`f${i}.md`] = { deletedAt: now - (TOMBSTONE_MAX + 5 - i) * 1000, deviceId: 'd' };
  }
  const result = pruneTombstones(input, now);
  expect(Object.keys(result)).toHaveLength(TOMBSTONE_MAX);
  expect(result['f0.md']).toBeUndefined();
  expect(result['f4.md']).toBeUndefined();
  expect(result['f5.md']).toBeDefined();
  expect(result[`f${TOMBSTONE_MAX + 4}.md`]).toBeDefined();
});

test('pruneTombstones：坏条目（字段缺失/类型错）丢弃', () => {
  const bad = { 'x.md': { deletedAt: 'nope', deviceId: '' }, 'y.md': undefined } as never;
  expect(Object.keys(pruneTombstones(bad))).toEqual([]);
  expect(Object.keys(pruneTombstones(undefined))).toEqual([]);
});

test('mergeTombstones：新增/覆盖 deletedAt 并顺带 prune', () => {
  const now = Date.now();
  const merged = mergeTombstones(
    { 'old.md': { deletedAt: now - 100 * 24 * 60 * 60 * 1000, deviceId: 'd0' } },
    [{ relPath: 'new.md', deviceId: 'd1' }, { relPath: 'again.md', deviceId: 'd2', deletedAt: now - 5 }],
  );
  expect(merged['new.md'].deviceId).toBe('d1');
  expect(merged['again.md'].deletedAt).toBe(now - 5);
  expect(merged['old.md']).toBeUndefined();
});

// ── tombstoneCandidates：基线有、现无 → 候选 ──

function entry(relPath: string, hash?: string): { relPath: string; size: number; mtimeMs: number; hash?: string } {
  return { relPath, size: 1, mtimeMs: 1, ...(hash ? { hash } : {}) };
}

test('tombstoneCandidates：基线有、现清单无 → 候选；文件仍在（条目级删除）不误报', () => {
  const prev = [entry('memory/a.md'), entry('memory/keep.md'), entry('memory/b.md')];
  const current = [entry('memory/keep.md'), entry('memory/b.md')];
  expect(tombstoneCandidates(prev, current)).toEqual(['memory/a.md']);
});

test('tombstoneCandidates：settings.json 永不候选；排除路径不候选；暂停工作区不候选', () => {
  const prev = [
    entry('settings.json'),
    entry('usage/stats.json'),
    entry('workspaces/ws-paused/notes/a.md'),
    entry('memory/gone.md'),
  ];
  const current: { relPath: string; size: number; mtimeMs: number }[] = [];
  const candidates = tombstoneCandidates(prev, current, {
    excludes: { conflictCopies: false, shadowGit: false, disabledItems: new Set(['usage']), optionalDirs: { stocks: false, feishu: false } },
    enabledWorkspaceIds: ['ws-open'],
  });
  expect(candidates).toEqual(['memory/gone.md']);
});

test('tombstoneCandidates：merge 记录文件整文件删除走墓碑（文件在清单即不触发）', () => {
  const prev = [entry('notifications.json'), entry('plans.json')];
  expect(tombstoneCandidates(prev, [])).toEqual(['notifications.json', 'plans.json']);
  expect(tombstoneCandidates(prev, [entry('notifications.json')])).toEqual(['plans.json']);
});

// ── diffManifests：墓碑分支 ──

test('diffManifests：remote-only 命中本端墓碑 → deletePropagation 不进 pull', async () => {
  const remote = [entry('memory/a.md', 'h1'), entry('memory/new.md', 'h2')];
  const r = await diffManifests({
    root: tmpdir(),
    local: [],
    remote,
    localTombstones: new Set(['memory/a.md']),
  });
  expect(r.pull.map((e) => e.relPath)).toEqual(['memory/new.md']);
  expect(r.deletePropagation.map((e) => e.relPath)).toEqual(['memory/a.md']);
});

test('diffManifests：local-only 命中对端墓碑 → peerDeleted 不进 push', async () => {
  const local = [entry('memory/a.md'), entry('memory/mine.md')];
  const r = await diffManifests({
    root: tmpdir(),
    local,
    remote: [],
    remoteTombstones: new Set(['memory/a.md']),
  });
  expect(r.push.map((e) => e.relPath)).toEqual(['memory/mine.md']);
  expect(r.peerDeleted.map((e) => e.relPath)).toEqual(['memory/a.md']);
});

test('diffManifests：无墓碑时行为不变（remote-only pull / local-only push）', async () => {
  const r = await diffManifests({ root: tmpdir(), local: [entry('memory/a.md')], remote: [entry('memory/b.md')] });
  expect(r.pull.map((e) => e.relPath)).toEqual(['memory/b.md']);
  expect(r.push.map((e) => e.relPath)).toEqual(['memory/a.md']);
  expect(r.deletePropagation).toEqual([]);
  expect(r.peerDeleted).toEqual([]);
});

// ── applyPeerTombstones / propagateLocalDeletes（临时目录真文件） ──

test('applyPeerTombstones：本端未改（==基线）→ 删除；改过/无基线 → 删改冲突保留；盘上不存在 → skipped；settings 跳过', async () => {
  const root = await fsp.mkdtemp(path.join(tmpdir(), 'dogear-tomb-apply-'));
  try {
    await fsp.mkdir(path.join(root, 'memory'), { recursive: true });
    await fsp.writeFile(path.join(root, 'memory/clean.md'), 'same');
    await fsp.writeFile(path.join(root, 'memory/edited.md'), 'changed');
    await fsp.writeFile(path.join(root, 'memory/other.md'), 'other');
    await fsp.writeFile(path.join(root, 'settings.json'), '{}');
    const baseline = new Map<string, string | undefined>([
      ['memory/clean.md', await sha256File(path.join(root, 'memory/clean.md'))],
      ['memory/edited.md', 'different-hash'],
      ['memory/other.md', 'stale-hash'],
      ['memory/ghost.md', 'some-hash'],
    ]);
    const outcome = await applyPeerTombstones(
      root,
      [entry('memory/clean.md'), entry('memory/edited.md'), entry('memory/other.md'), entry('memory/ghost.md'), entry('settings.json')],
      baseline,
    );
    expect(outcome.deleted).toEqual(['memory/clean.md']);
    expect(outcome.conflicts).toEqual([
      { relPath: 'memory/edited.md', kind: 'remote-deleted' },
      { relPath: 'memory/other.md', kind: 'remote-deleted' },
    ]);
    expect(outcome.skipped.map((s) => s.relPath)).toEqual(['memory/ghost.md']);
    await expect(fsp.access(path.join(root, 'memory/clean.md'))).rejects.toThrow();
    await expect(fsp.readFile(path.join(root, 'memory/edited.md'), 'utf-8')).resolves.toBe('changed');
    await expect(fsp.readFile(path.join(root, 'memory/other.md'), 'utf-8')).resolves.toBe('other');
    await expect(fsp.readFile(path.join(root, 'settings.json'), 'utf-8')).resolves.toBe('{}');
  } finally {
    await fsp.rm(root, { recursive: true, force: true });
  }
});

test('propagateLocalDeletes：对端未改 → 驱动删除；对端改过/409 → 冲突；其他失败/缺 hash → skipped', async () => {
  const baseline = new Map<string, string | undefined>([
    ['memory/a.md', 'hash-a'],
    ['memory/b.md', 'hash-b'],
    ['memory/c.md', 'hash-c'],
    ['memory/d.md', 'hash-d'],
  ]);
  const calls: string[] = [];
  const outcome = await propagateLocalDeletes(
    [
      { entry: entry('memory/a.md', 'hash-a'), remoteRelPath: 'memory/a.md' },
      { entry: entry('memory/b.md', 'hash-b-changed'), remoteRelPath: 'memory/b.md' },
      { entry: entry('memory/c.md', 'hash-c'), remoteRelPath: 'memory/c.md' },
      { entry: entry('memory/d.md', 'hash-d'), remoteRelPath: 'memory/d.md' },
      { entry: entry('memory/e.md'), remoteRelPath: 'memory/e.md' },
      { entry: entry('settings.json', 'hash-s'), remoteRelPath: 'settings.json' },
    ],
    baseline,
    async (target, expectedHash) => {
      calls.push(`${target.entry.relPath}:${expectedHash}`);
      if (target.entry.relPath === 'memory/c.md') return { ok: false, status: 409, reason: 'modified' };
      if (target.entry.relPath === 'memory/d.md') return { ok: false, status: 500, reason: 'boom' };
      return { ok: true };
    },
  );
  expect(calls).toEqual(['memory/a.md:hash-a', 'memory/c.md:hash-c', 'memory/d.md:hash-d']);
  expect(outcome.deletedOnPeer).toEqual(['memory/a.md']);
  expect(outcome.conflicts).toEqual([
    { relPath: 'memory/b.md', kind: 'local-deleted' },
    { relPath: 'memory/c.md', kind: 'local-deleted' },
  ]);
  expect(outcome.skipped.map((s) => s.relPath).sort()).toEqual(['memory/d.md', 'memory/e.md']);
});

// ── HTTP 集成：DELETE /file + /manifest 墓碑交换（push-receive 骨架） ──

const PEER_ID = 'peer-device-1';
const SECRET = 'b'.repeat(64);

const dataDir = await fsp.mkdtemp(path.join(tmpdir(), 'dogear-tomb-http-'));
const NOTE_REL = 'memory/note.md';
const NOTE2_REL = 'memory/note2.md';
await fsp.mkdir(path.join(dataDir, 'memory'), { recursive: true });
await fsp.writeFile(path.join(dataDir, NOTE_REL), 'hello');
await fsp.writeFile(path.join(dataDir, NOTE2_REL), 'world');
const noteHash = await sha256File(path.join(dataDir, NOTE_REL));
const note2Hash = await sha256File(path.join(dataDir, NOTE2_REL));
await fsp.writeFile(
  path.join(dataDir, 'sync-state.json'),
  JSON.stringify({
    version: 1,
    deviceId: 'self-device-1',
    peers: {
      [PEER_ID]: {
        deviceId: PEER_ID,
        lastSyncAt: 0,
        workspaceMap: { 'ws-open': { enabled: true }, 'ws-paused': { enabled: false } },
        lastManifest: [
          { relPath: NOTE_REL, size: 5, mtimeMs: 100, hash: noteHash },
          { relPath: NOTE2_REL, size: 5, mtimeMs: 100, hash: note2Hash },
          { relPath: 'memory/gone.md', size: 1, mtimeMs: 1, hash: 'a'.repeat(64) },
          { relPath: 'usage/hidden.md', size: 1, mtimeMs: 1, hash: 'a'.repeat(64) },
          { relPath: 'workspaces/ws-paused/notes/paused.md', size: 1, mtimeMs: 1, hash: 'a'.repeat(64) },
        ],
      },
    },
  }),
);

const { startSyncServer } = await import('./server.js');
const { excludesFromSyncOptions } = await import('./manifest.js');

const server = await startSyncServer({
  port: 0,
  dataDir,
  getSelfHello: () => ({ appId: 'dogear', protocolVersion: 4, appVersion: 'test', deviceId: 'self-device-1' }),
  getManifestOptions: async () => ({
    excludes: excludesFromSyncOptions({
      deviceName: 'receiver',
      syncStocksData: false,
      syncFeishu: false,
      pairedDevices: [],
      disabledSyncItems: ['usage'],
      syncConflictCopies: false,
      syncShadowGit: false,
      syncOptionsRev: 0,
    }),
  }),
  handlePairRequest: async () => ({ accepted: false }),
  authorizeRequest: async (req) => {
    const deviceId = req.headers['x-dogear-device-id'];
    const secret = req.headers['x-dogear-secret'];
    if (deviceId === PEER_ID && secret === SECRET) return { ok: true, deviceId: PEER_ID };
    return { ok: false };
  },
});
const base = `http://127.0.0.1:${server.port}`;

function deleteFile(relPath: string, expectedHash: string): Promise<Response> {
  return fetch(`${base}/file`, {
    method: 'DELETE',
    headers: { 'x-dogear-device-id': PEER_ID, 'x-dogear-secret': SECRET, 'content-type': 'application/json' },
    body: JSON.stringify({ relPath, expectedHash }),
  });
}

function postManifest(body: Record<string, unknown>): Promise<Response> {
  return fetch(`${base}/manifest`, {
    method: 'POST',
    headers: { 'x-dogear-device-id': PEER_ID, 'x-dogear-secret': SECRET, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

const manifestHello = { appId: 'dogear', protocolVersion: 4, appVersion: 'test', deviceId: PEER_ID, deviceName: 'peer' };

test('DELETE /file：hash 一致 → 删除文件 + 记墓碑 + 基线条目移除', async () => {
  const res = await deleteFile(NOTE_REL, noteHash);
  expect(res.status).toBe(200);
  await expect(fsp.access(path.join(dataDir, NOTE_REL))).rejects.toThrow();
  const state = JSON.parse(await fsp.readFile(path.join(dataDir, 'sync-state.json'), 'utf-8'));
  expect(state.tombstones[NOTE_REL].deviceId).toBe('self-device-1');
  expect(state.peers[PEER_ID].lastManifest.map((e: { relPath: string }) => e.relPath)).not.toContain(NOTE_REL);
});

test('DELETE /file：hash 不一致（对端改过）→ 409 拒绝，文件与基线均不动、不记墓碑', async () => {
  const res = await deleteFile(NOTE2_REL, noteHash);
  expect(res.status).toBe(409);
  await expect(fsp.readFile(path.join(dataDir, NOTE2_REL), 'utf-8')).resolves.toBe('world');
  const state = JSON.parse(await fsp.readFile(path.join(dataDir, 'sync-state.json'), 'utf-8'));
  expect(state.tombstones[NOTE2_REL]).toBeUndefined();
  expect(state.peers[PEER_ID].lastManifest.map((e: { relPath: string }) => e.relPath)).toContain(NOTE2_REL);
});

test('DELETE /file：文件不存在 → 404', async () => {
  const res = await deleteFile('memory/never.md', 'a'.repeat(64));
  expect(res.status).toBe(404);
});

test('DELETE /file：禁写路径 / 暂停工作区 / 排除路径 → 403', async () => {
  expect((await deleteFile('sync-state.json', 'a'.repeat(64))).status).toBe(403);
  expect((await deleteFile('login-accounts.json', 'a'.repeat(64))).status).toBe(403);
  expect((await deleteFile('workspaces/ws-paused/notes/a.md', 'a'.repeat(64))).status).toBe(403);
  expect((await deleteFile('usage/stats.json', 'a'.repeat(64))).status).toBe(403);
  expect((await deleteFile('../escape.md', 'a'.repeat(64))).status).toBe(403);
});

test('DELETE /file：未配对 → 401', async () => {
  const res = await fetch(`${base}/file`, {
    method: 'DELETE',
    headers: { 'x-dogear-device-id': 'stranger', 'x-dogear-secret': SECRET, 'content-type': 'application/json' },
    body: JSON.stringify({ relPath: NOTE2_REL, expectedHash: noteHash }),
  });
  expect(res.status).toBe(401);
});

test('/manifest 响应携对端墓碑（基线有、盘上无 → 候选落盘并响应）；排除与暂停工作区路径不进墓碑', async () => {
  const res = await postManifest({ hello: manifestHello, entries: [] });
  expect(res.status).toBe(200);
  const body = (await res.json()) as { tombstones?: Record<string, { deviceId: string }> };
  expect(Object.keys(body.tombstones ?? {})).toContain('memory/gone.md');
  expect(Object.keys(body.tombstones ?? {})).not.toContain('usage/hidden.md');
  expect(Object.keys(body.tombstones ?? {})).not.toContain('workspaces/ws-paused/notes/paused.md');
  expect(body.tombstones!['memory/gone.md'].deviceId).toBe('self-device-1');
  const state = JSON.parse(await fsp.readFile(path.join(dataDir, 'sync-state.json'), 'utf-8'));
  expect(state.tombstones['memory/gone.md']).toBeDefined();
});

test('/manifest 请求体携墓碑可被解析接受（协议对称，服务端不据此执行删除）', async () => {
  const res = await postManifest({
    hello: manifestHello,
    entries: [],
    tombstones: { 'memory/peer-deleted.md': { deletedAt: Date.now(), deviceId: PEER_ID } },
  });
  expect(res.status).toBe(200);
  const body = (await res.json()) as { tombstones?: Record<string, unknown> };
  expect(body.tombstones).toBeDefined();
});

test('双端串联（A 删 → 删除传播 → B 侧文件消失且基线更新）：propagateLocalDeletes 真 HTTP 打 B 端', async () => {
  const outcome = await propagateLocalDeletes(
    [{ entry: { relPath: NOTE2_REL, size: 5, mtimeMs: 100, hash: note2Hash }, remoteRelPath: NOTE2_REL }],
    new Map([[NOTE2_REL, note2Hash]]),
    (target, expectedHash) =>
      deletePeerFile({ host: '127.0.0.1', port: server.port }, { deviceId: PEER_ID, secret: SECRET }, target.remoteRelPath, expectedHash),
  );
  expect(outcome.deletedOnPeer).toEqual([NOTE2_REL]);
  await expect(fsp.access(path.join(dataDir, NOTE2_REL))).rejects.toThrow();
  const state = JSON.parse(await fsp.readFile(path.join(dataDir, 'sync-state.json'), 'utf-8'));
  expect(state.tombstones[NOTE2_REL]).toBeDefined();
  expect(state.peers[PEER_ID].lastManifest.map((e: { relPath: string }) => e.relPath)).not.toContain(NOTE2_REL);
});

test('删除传播经 sync-state 读回：墓碑随 readSyncStateFrom 可见（全局不分 peer）', async () => {
  const state = await readSyncStateFrom(dataDir);
  expect(state.tombstones?.[NOTE_REL]).toBeDefined();
  expect(state.tombstones?.['memory/gone.md']).toBeDefined();
});

afterAll(async () => {
  await Promise.race([server.close(), new Promise((resolve) => setTimeout(resolve, 3000))]);
  await fsp.rm(dataDir, { recursive: true, force: true });
});
