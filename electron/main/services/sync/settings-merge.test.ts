import { test, expect, mock, afterAll } from 'bun:test';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { gzipSync } from 'node:zlib';
import { Readable } from 'node:stream';
import type { AppSettings, SyncOptions } from '../settings-types.js';

// 隔离配置目录：mergeIncomingSettings（push 接收端）内部的 loadSettings/saveSettings 走 env 路径，
// 防止意外读写真实项目 .dogear；三方合并逻辑的断言全部走 localSettings 注入，不依赖本 env
process.env.DOGEAR_CONFIG_DIR = await fsp.mkdtemp(path.join(tmpdir(), 'dogear-settings-merge-'));

// apply.ts / server.ts 静态 import 链顶层拉进 electron 的命名导入，bun test 下 CJS interop 无 'app'
// 命名导出会炸；先 mock 再动态加载（同 exclude.test.ts / push-receive.test.ts）
mock.module('electron', () => ({
  default: { app: { getPath: () => tmpdir() }, nativeTheme: {} },
  app: { getPath: () => tmpdir() },
  nativeTheme: {},
}));

const { computeMergedSettings, applyIncoming } = await import('./apply.js');
const { withSyncStateLock, readSyncStateFrom, writeSyncStateTo } = await import('./sync-state.js');
const { startSyncServer } = await import('./server.js');
const { excludesFromSyncOptions } = await import('./manifest.js');

function syncOpts(over: Partial<SyncOptions> = {}): SyncOptions {
  return {
    deviceName: 'local-device',
    syncStocksData: false,
    syncFeishu: false,
    pairedDevices: [{ deviceId: 'dev-a', secret: 'a'.repeat(64), pairedAt: 1 }],
    disabledSyncItems: [],
    syncConflictCopies: false,
    syncShadowGit: false,
    syncOptionsRev: 0,
    ...over,
  };
}

function localSettings(over: Record<string, unknown>, sync: SyncOptions = syncOpts()): AppSettings {
  return { ...over, syncOptions: sync } as unknown as AppSettings;
}

// ── computeMergedSettings：顶层字段级三方合并（D2）──

test('两侧离线各改不同顶层字段 → 两字段并存（各自取变侧）', async () => {
  const baseline = { appearance: { theme: 'light' }, ai: { permissionMode: 'default' } };
  const local = localSettings({ appearance: { theme: 'dark' }, ai: { permissionMode: 'default' } });
  const incoming = { appearance: { theme: 'light' }, ai: { permissionMode: 'autoExecute' } };
  const warnings: string[] = [];
  const m = await computeMergedSettings(incoming, {
    localSettings: local,
    baseline,
    onWarning: (w) => warnings.push(w),
  });
  expect(m.appearance).toEqual({ theme: 'dark' });
  expect(m.ai).toEqual({ permissionMode: 'autoExecute' });
  expect(warnings).toEqual([]);
});

test('两侧改同一顶层字段（不同值）→ 本端保留 + warning', async () => {
  const baseline = { appearance: { theme: 'light' }, webAiSites: ['a'] };
  const local = localSettings({ appearance: { theme: 'dark' }, webAiSites: ['a'] });
  const incoming = { appearance: { theme: 'system' }, webAiSites: ['a'] };
  const warnings: string[] = [];
  const m = await computeMergedSettings(incoming, {
    localSettings: local,
    baseline,
    onWarning: (w) => warnings.push(w),
  });
  expect(m.appearance).toEqual({ theme: 'dark' });
  expect(warnings).toHaveLength(1);
  expect(warnings[0]).toContain('appearance');
});

test('两侧改成相同值 → 不算冲突，不产生 warning', async () => {
  const baseline = { appearance: { theme: 'light' } };
  const local = localSettings({ appearance: { theme: 'dark' } });
  const incoming = { appearance: { theme: 'dark' } };
  const warnings: string[] = [];
  const m = await computeMergedSettings(incoming, {
    localSettings: local,
    baseline,
    onWarning: (w) => warnings.push(w),
  });
  expect(m.appearance).toEqual({ theme: 'dark' });
  expect(warnings).toEqual([]);
});

test('仅一侧改 → 取变侧；两侧同基线 → 保留', async () => {
  const baseline = { a: 1, b: 2, c: 3 };
  const local = localSettings({ a: 1, b: 99, c: 3 });
  const incoming = { a: 1, b: 2, c: 3 };
  const m1 = await computeMergedSettings(incoming, { localSettings: local, baseline });
  expect(m1.b).toBe(99);

  const m2 = await computeMergedSettings({ a: 1, b: 2, c: 77 }, { localSettings: localSettings({ a: 1, b: 2, c: 3 }), baseline });
  expect(m2.c).toBe(77);

  const m3 = await computeMergedSettings({ a: 1, b: 2, c: 3 }, { localSettings: local, baseline });
  expect(m3.a).toBe(1);
});

test('字段新增/删除同样适用：单侧新增取新增侧，双侧删同字段静默收敛', async () => {
  const baseline = { legacy: { keep: true } };
  const local = localSettings({ legacy: { keep: true }, localOnly: 'x' });
  const incoming = { legacy: { keep: true }, remoteOnly: 'y' };
  const m = await computeMergedSettings(incoming, { localSettings: local, baseline });
  expect(m.localOnly).toBe('x');
  expect(m.remoteOnly).toBe('y');
  expect(m.legacy).toEqual({ keep: true });

  const bothDeleted = await computeMergedSettings(
    {},
    { localSettings: localSettings({}), baseline },
  );
  expect('legacy' in bothDeleted).toBe(false);
});

test('无基线（首次同步）→ 退化为以对端为底（现有行为）', async () => {
  const local = localSettings({ keepMe: 'local-value' });
  const incoming = { fromRemote: 'yes' };
  const m1 = await computeMergedSettings(incoming, { localSettings: local });
  expect(m1.fromRemote).toBe('yes');
  expect(m1.keepMe).toBeUndefined();

  const m2 = await computeMergedSettings(incoming, { localSettings: local, baseline: null });
  expect(m2.fromRemote).toBe('yes');

  const m3 = await computeMergedSettings(incoming, { localSettings: local, baseline: 'corrupted' as unknown as Record<string, unknown> });
  expect(m3.fromRemote).toBe('yes');
});

test('有基线时 syncOptions 节仍走 rev-LWW 特判，不被三方字段逻辑吞掉', async () => {
  const baseline = { appearance: { theme: 'light' }, syncOptions: syncOpts({ syncOptionsRev: 0 }) };
  const local = localSettings({ appearance: { theme: 'light' } }, syncOpts({ syncOptionsRev: 1 }));
  const incoming = { appearance: { theme: 'light' }, syncOptions: syncOpts({ deviceName: 'remote-device', syncStocksData: true, syncOptionsRev: 7 }) };
  const m = await computeMergedSettings(incoming, { localSettings: local, baseline });
  expect(m.syncOptions?.syncStocksData).toBe(true);
  expect(m.syncOptions?.syncOptionsRev).toBe(7);
  expect(m.syncOptions?.deviceName).toBe('local-device');
  expect(m.appearance).toEqual({ theme: 'light' });
});

test('基线键序与嵌套结构不影响 deepEqual 比较（对象/数组逐值比）', async () => {
  const baseline = { cfg: { b: 1, a: [1, { x: 2, y: 3 }] } };
  const local = localSettings({ cfg: { a: [1, { y: 3, x: 2 }], b: 1 } });
  const incoming = { cfg: { b: 1, a: [1, { x: 2, y: 3 }] } };
  const warnings: string[] = [];
  const m = await computeMergedSettings(incoming, {
    localSettings: local,
    baseline,
    onWarning: (w) => warnings.push(w),
  });
  expect(m.cfg).toEqual({ b: 1, a: [1, { x: 2, y: 3 }] });
  expect(warnings).toEqual([]);
});

// ── applyIncoming：settings.json 条目经 options 拿基线走三方合并 ──

test('applyIncoming 传 settingsBaseline：merge 路由生效、双改 warning 收集进报告链路', async () => {
  const root = await fsp.mkdtemp(path.join(tmpdir(), 'dogear-settings-apply-'));
  try {
    const onDiskLocal = { appearance: { theme: 'dark' }, ai: { permissionMode: 'default' } };
    await fsp.writeFile(path.join(root, 'settings.json'), JSON.stringify(onDiskLocal));
    const baseline = { appearance: { theme: 'light' }, ai: { permissionMode: 'default' } };
    const incoming = { appearance: { theme: 'light' }, ai: { permissionMode: 'autoExecute' } };
    const warnings: string[] = [];
    const report = await applyIncoming(
      root,
      [{ entry: { relPath: 'settings.json', size: 1, mtimeMs: 1 } }],
      async () => Readable.from(gzipSync(Buffer.from(JSON.stringify(incoming)))),
      undefined,
      { settingsBaseline: baseline, onSettingsMergeWarning: (w) => warnings.push(w) },
    );
    expect(report.mergedFiles).toEqual(['settings.json']);
    expect(report.applied).toHaveLength(1);
    expect(warnings).toEqual([]);
    expect(report.mergeFailed).toEqual([]);
  } finally {
    await fsp.rm(root, { recursive: true, force: true });
  }
});

test('applyIncoming 双改同字段：warning 经 onSettingsMergeWarning 冒出', async () => {
  const root = await fsp.mkdtemp(path.join(tmpdir(), 'dogear-settings-apply2-'));
  try {
    await fsp.writeFile(path.join(root, 'settings.json'), JSON.stringify({ appearance: { theme: 'dark' } }));
    const baseline = { appearance: { theme: 'light' } };
    const incoming = { appearance: { theme: 'system' } };
    const warnings: string[] = [];
    const report = await applyIncoming(
      root,
      [{ entry: { relPath: 'settings.json', size: 1, mtimeMs: 1 } }],
      async () => Readable.from(gzipSync(Buffer.from(JSON.stringify(incoming)))),
      undefined,
      { settingsBaseline: baseline, onSettingsMergeWarning: (w) => warnings.push(w) },
    );
    expect(report.mergedFiles).toEqual(['settings.json']);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('appearance');
  } finally {
    await fsp.rm(root, { recursive: true, force: true });
  }
});

// ── withSyncStateLock：读改写整段互斥（F5）──

test('100 个并发读改写任务经锁串行化，计数不丢失', async () => {
  const dir = await fsp.mkdtemp(path.join(tmpdir(), 'dogear-sync-lock-'));
  try {
    await writeSyncStateTo(dir, { version: 1, peers: {} });
    const tasks = Array.from({ length: 100 }, (_, i) =>
      withSyncStateLock(dir, async () => {
        const state = await readSyncStateFrom(dir);
        const prev = state.peers['counter']?.lastSyncAt ?? 0;
        await new Promise((resolve) => setTimeout(resolve, i % 3));
        state.peers['counter'] = { deviceId: 'counter', lastSyncAt: prev + 1 };
        await writeSyncStateTo(dir, state);
      }),
    );
    await Promise.all(tasks);
    const final = await readSyncStateFrom(dir);
    expect(final.peers['counter']?.lastSyncAt).toBe(100);
  } finally {
    await fsp.rm(dir, { recursive: true, force: true });
  }
});

test('锁内任务失败：错误原样抛给调用方，不阻塞后续排队任务', async () => {
  const dir = await fsp.mkdtemp(path.join(tmpdir(), 'dogear-sync-lock2-'));
  try {
    await writeSyncStateTo(dir, { version: 1, peers: {} });
    await expect(
      withSyncStateLock(dir, async () => {
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');
    const result = await withSyncStateLock(dir, async () => 'after-failure');
    expect(result).toBe('after-failure');
    const state = await readSyncStateFrom(dir);
    state.peers['after'] = { deviceId: 'after', lastSyncAt: 1 };
    await withSyncStateLock(dir, async () => {
      await writeSyncStateTo(dir, state);
    });
    expect((await readSyncStateFrom(dir)).peers['after']?.lastSyncAt).toBe(1);
  } finally {
    await fsp.rm(dir, { recursive: true, force: true });
  }
});

test('锁返回值透传（orchestrator 收尾把 learnedCount 带出锁外用）', async () => {
  const dir = await fsp.mkdtemp(path.join(tmpdir(), 'dogear-sync-lock3-'));
  try {
    const value = await withSyncStateLock(dir, async () => {
      await writeSyncStateTo(dir, { version: 1, peers: {} });
      return 42;
    });
    expect(value).toBe(42);
  } finally {
    await fsp.rm(dir, { recursive: true, force: true });
  }
});

// ── push 接收端到端：settings.json 合并 + per-peer 基线写回 sync-state ──

const PEER_WITH_BASELINE = 'peer-with-baseline';
const PEER_FRESH = 'peer-fresh';
const SECRET = 'c'.repeat(64);

const pushDataDir = await fsp.mkdtemp(path.join(tmpdir(), 'dogear-settings-push-'));
await fsp.writeFile(
  path.join(pushDataDir, 'sync-state.json'),
  JSON.stringify({
    version: 1,
    peers: {
      [PEER_WITH_BASELINE]: {
        deviceId: PEER_WITH_BASELINE,
        lastSyncAt: 0,
        settingsBaseline: { appearance: { theme: 'light' } },
      },
    },
  }),
);

const server = await startSyncServer({
  port: 0,
  dataDir: pushDataDir,
  getSelfHello: () => ({ appId: 'dogear', protocolVersion: 2, appVersion: 'test', deviceId: 'self-device-1' }),
  getManifestOptions: async () => ({ excludes: excludesFromSyncOptions(undefined) }),
  handlePairRequest: async () => ({ accepted: false }),
  authorizeRequest: async (req) => {
    const deviceId = req.headers['x-dogear-device-id'];
    const secret = req.headers['x-dogear-secret'];
    if (secret === SECRET && (deviceId === PEER_WITH_BASELINE || deviceId === PEER_FRESH)) {
      return { ok: true, deviceId: deviceId as string };
    }
    return { ok: false };
  },
});
const pushBase = `http://127.0.0.1:${server.port}`;

function pushSettings(deviceId: string, body: Record<string, unknown>): Promise<Response> {
  const payload = JSON.stringify(body);
  const meta = Buffer.from(
    JSON.stringify({ relPath: 'settings.json', size: payload.length, mtimeMs: 1 }),
  ).toString('base64');
  return fetch(`${pushBase}/file`, {
    method: 'POST',
    headers: {
      'x-dogear-device-id': deviceId,
      'x-dogear-secret': SECRET,
      'x-dogear-file-meta': meta,
      'content-type': 'application/octet-stream',
    },
    body: gzipSync(Buffer.from(payload)),
  });
}

test('push settings.json：有基线 peer 合并落盘并把基线写回 sync-state', async () => {
  const res = await pushSettings(PEER_WITH_BASELINE, { appearance: { theme: 'system' } });
  expect(res.status).toBe(200);
  const body = (await res.json()) as { merged?: boolean };
  expect(body.merged).toBe(true);
  const state = JSON.parse(await fsp.readFile(path.join(pushDataDir, 'sync-state.json'), 'utf-8'));
  expect(state.peers[PEER_WITH_BASELINE].settingsBaseline).toBeTypeOf('object');
});

test('push settings.json：无基线 peer（首次）退化合并后建立基线', async () => {
  const res = await pushSettings(PEER_FRESH, { fromRemote: 'v1' });
  expect(res.status).toBe(200);
  const state = JSON.parse(await fsp.readFile(path.join(pushDataDir, 'sync-state.json'), 'utf-8'));
  expect(state.peers[PEER_FRESH].settingsBaseline).toBeTypeOf('object');
});

afterAll(async () => {
  await Promise.race([server.close(), new Promise((resolve) => setTimeout(resolve, 3000))]);
  await fsp.rm(pushDataDir, { recursive: true, force: true });
});
