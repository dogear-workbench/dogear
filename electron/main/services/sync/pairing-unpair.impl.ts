import { test, expect, mock } from 'bun:test';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import type { AppSettings, SyncOptions } from '../settings-types.js';

// 由 zz-pairing-unpair.test.ts 以 `bun test <本文件>` 在独立子进程中运行：
// bun test 合跑时 mock.module 进程级持久（delegation-test-mocks 泄漏的 loadSettings 替换）与
// 多 worker 并发的 env 串扰都会污染本组集成用例，子进程隔离后不再受影响。
// 隔离配置目录：pairing/orchestrator 内部 loadSettings/saveSettings 与 sync-state 读写全走 env 路径，
// 防止意外读写真实项目 .dogear
const dataDir = await fsp.mkdtemp(path.join(tmpdir(), 'dogear-pairing-unpair-'));
process.env.DOGEAR_CONFIG_DIR = dataDir;

// apply.ts / orchestrator.ts / sync-state.ts 静态 import 链顶层拉进 electron 的命名导入，bun test 下
// CJS interop 无 'app' 命名导出会炸；先 mock 再动态加载（同 settings-merge.test.ts）
mock.module('electron', () => ({
  default: { app: { getPath: () => tmpdir() }, nativeTheme: {} },
  app: { getPath: () => tmpdir() },
  nativeTheme: {},
}));

const { loadSettings, saveSettings } = await import('../settings-service.js');
const { ensureSelfHello, beginPairing, unpairDevice } = await import('./pairing.js');
const { runSync } = await import('./orchestrator.js');
const { readSyncStateFrom } = await import('./sync-state.js');

// client.js 整模块替换但透传真实现，仅 sendPairRequest/fetchManifest 可被用例覆写
let sendPairRequestImpl: ((...args: unknown[]) => Promise<unknown>) | null = null;
let fetchManifestImpl: ((...args: unknown[]) => Promise<unknown>) | null = null;

const realClient = await import('./client.js');
type ClientModule = typeof realClient;

mock.module('./client.js', () => ({
  ...realClient,
  sendPairRequest: (...args: Parameters<ClientModule['sendPairRequest']>) =>
    (sendPairRequestImpl ?? realClient.sendPairRequest)(...args),
  fetchManifest: (...args: Parameters<ClientModule['fetchManifest']>) =>
    (fetchManifestImpl ?? realClient.fetchManifest)(...args),
}));

async function until(cond: () => boolean, what: string): Promise<void> {
  for (let i = 0; i < 400 && !cond(); i++) await new Promise((r) => setTimeout(r, 5));
  if (!cond()) throw new Error(`timeout waiting for: ${what}`);
}

function syncOpts(over: Partial<SyncOptions> = {}): SyncOptions {
  return {
    deviceName: 'local-device',
    syncStocksData: false,
    syncFeishu: false,
    pairedDevices: [],
    disabledSyncItems: [],
    syncConflictCopies: false,
    syncShadowGit: false,
    syncOptionsRev: 0,
    ...over,
  };
}

function helloOf(deviceId: string, deviceName: string) {
  return { appId: 'dogear', protocolVersion: 4, appVersion: 'test', deviceId, deviceName };
}

async function seedSettings(paired: Array<{ deviceId: string; deviceName?: string; secret: string }>): Promise<void> {
  const settings = { syncOptions: syncOpts({ pairedDevices: paired.map((p) => ({ ...p, pairedAt: 1 })) }) } as unknown as AppSettings;
  await saveSettings(settings);
}

async function readPeers() {
  return (await readSyncStateFrom(dataDir)).peers;
}

test('unpair 正常删除：pairedDevices 移除该条目，其余保留，sync-state.peers 不动', async () => {
  await seedSettings([
    { deviceId: 'dev-a', deviceName: 'A', secret: 'a'.repeat(64) },
    { deviceId: 'dev-b', deviceName: 'B', secret: 'b'.repeat(64) },
  ]);

  await unpairDevice('dev-a');

  const s = await loadSettings();
  expect(s.syncOptions!.pairedDevices.map((d) => d.deviceId)).toEqual(['dev-b']);
});

test('unpair 幂等：设备不存在时不抛错且不写盘', async () => {
  await seedSettings([{ deviceId: 'dev-b', deviceName: 'B', secret: 'b'.repeat(64) }]);
  const before = await loadSettings();

  await expect(unpairDevice('ghost')).resolves.toBeUndefined();

  const after = await loadSettings();
  expect(after).toEqual(before);
});

test('unpair 进行中拒绝：runningSync 非空时抛「同步进行中」', async () => {
  await seedSettings([{ deviceId: 'dev-a', deviceName: 'A', secret: 'a'.repeat(64) }]);
  await ensureSelfHello('test');
  let release!: (error: Error) => void;
  let entered = false;
  let exited = false;
  fetchManifestImpl = () => {
    entered = true;
    return new Promise((_resolve, reject) => { release = reject; });
  };

  const syncing = runSync({ host: '127.0.0.1', port: 47210, deviceId: 'dev-a', deviceName: 'A' });
  void syncing.finally(() => { exited = true; });
  try {
    await until(() => entered || exited, 'fetchManifest entered');
    if (!entered) throw new Error('runSync exited before fetchManifest');
    await expect(unpairDevice('dev-a')).rejects.toThrow('同步进行中，稍后再解除');
    release(new Error('stop'));
    const report = await syncing;
    expect(report.ok).toBe(false);
  } finally {
    fetchManifestImpl = null;
    if (entered) release(new Error('stop'));
    await syncing.catch(() => {});
  }
});

test('outgoing 配对确认成功 → peerState 写入对端 host/port', async () => {
  await seedSettings([]);
  await ensureSelfHello('test');
  sendPairRequestImpl = async () => ({
    accepted: true,
    secret: 'c'.repeat(64),
    peerHello: helloOf('dev-c', 'C'),
  });

  const { result } = beginPairing({ host: '127.0.0.1', port: 47210, deviceId: 'dev-c', deviceName: 'C' });
  const outcome = await result;
  expect(outcome.ok).toBe(true);

  const peers = await readPeers();
  expect(peers['dev-c']?.lastHost).toBe('127.0.0.1');
  expect(peers['dev-c']?.lastPort).toBe(47210);
});

test('runSync 成功收尾 → peerState 写入 lastHost/lastPort', async () => {
  await seedSettings([{ deviceId: 'dev-c', deviceName: 'C', secret: 'c'.repeat(64) }]);
  await ensureSelfHello('test');
  fetchManifestImpl = async () => ({
    hello: helloOf('dev-c', 'C'),
    entries: [],
    candidateHashes: [],
  });

  const report = await runSync({ host: '192.168.1.8', port: 54321, deviceId: 'dev-c', deviceName: 'C' });
  expect(report.ok).toBe(true);

  const peers = await readPeers();
  expect(peers['dev-c']?.lastHost).toBe('192.168.1.8');
  expect(peers['dev-c']?.lastPort).toBe(54321);
});

test('runSync 对端 401（已解除配对）→ 错误文案含解除重配引导', async () => {
  await seedSettings([{ deviceId: 'dev-a', deviceName: 'A', secret: 'a'.repeat(64) }]);
  await ensureSelfHello('test');
  fetchManifestImpl = async () => {
    throw new Error('POST /manifest HTTP 401: {"error":"unpaired device"}');
  };

  const report = await runSync({ host: '127.0.0.1', port: 47210, deviceId: 'dev-a', deviceName: 'A' });
  expect(report.ok).toBe(false);
  expect(report.error).toContain('对端可能已解除配对');
  expect(report.error).toContain('重新配对');
});
