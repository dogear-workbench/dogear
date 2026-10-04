import { test, expect, mock } from 'bun:test';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import type { AppSettings, SyncOptions } from '../settings-types.js';

// 由 zz-discovery-broadcast.test.ts 以 `bun test <本文件>` 在独立子进程中运行（隔离原因同 discovery-scan.impl.ts）：
// mock.module 进程级持久 + 多 worker env 串扰会污染本组用例；隔离配置目录防读写真实项目 .dogear
const dataDir = await fsp.mkdtemp(path.join(tmpdir(), 'dogear-discovery-broadcast-'));
process.env.DOGEAR_CONFIG_DIR = dataDir;

mock.module('electron', () => ({
  default: { app: { getPath: () => tmpdir() }, nativeTheme: {} },
  app: { getPath: () => tmpdir() },
  nativeTheme: {},
}));

const browserHandlers = new Map<string, (svc: unknown) => void>();
const fakeBrowser = {
  on: (event: string, cb: (svc: unknown) => void) => {
    browserHandlers.set(event, cb);
  },
  update: () => {},
};

mock.module('bonjour-service', () => ({
  Bonjour: class {
    publish() {
      return { on() {} };
    }
    find() {
      return fakeBrowser;
    }
    unpublishAll(cb?: () => void) {
      cb?.();
    }
    destroy() {}
  },
}));

const { saveSettings } = await import('../settings-service.js');
const { broadcastPeersSnapshot, onPeersChanged, scanNow, startDiscovery, stopDiscovery } = await import('./discovery.js');
type DeviceSnapshot = import('./discovery.js').DeviceSnapshot;
const { readSyncStateFrom, writeSyncStateTo } = await import('./sync-state.js');

const realClient = await import('./client.js');
type ClientModule = typeof realClient;
let fetchPeerInfoImpl: ((...args: unknown[]) => Promise<unknown>) | null = null;

mock.module('./client.js', () => ({
  ...realClient,
  fetchPeerInfo: (...args: Parameters<ClientModule['fetchPeerInfo']>) => {
    if (fetchPeerInfoImpl) return fetchPeerInfoImpl(...args);
    return realClient.fetchPeerInfo(...args);
  },
}));

async function until(cond: () => boolean | Promise<boolean>, what: string): Promise<void> {
  for (let i = 0; i < 400; i++) {
    if (await cond()) return;
    await new Promise((r) => setTimeout(r, 5));
  }
  throw new Error(`timeout waiting for: ${what}`);
}

function helloOf(deviceId: string, deviceName: string) {
  return { appId: 'dogear', protocolVersion: 3, appVersion: '9.9.9', deviceId, deviceName };
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

async function seedSettings(paired: Array<{ deviceId: string; deviceName?: string; secret: string }>): Promise<void> {
  const settings = { syncOptions: syncOpts({ pairedDevices: paired.map((p) => ({ ...p, pairedAt: 1 })) }) } as unknown as AppSettings;
  await saveSettings(settings);
}

async function writePeerState(peers: Record<string, unknown>): Promise<void> {
  const state = await readSyncStateFrom(dataDir);
  state.peers = peers as typeof state.peers;
  await writeSyncStateTo(dataDir, state);
}

function resetBroadcastMocks(): void {
  stopDiscovery();
  fetchPeerInfoImpl = null;
}

test('onPeersChanged 推送合并快照：mDNS 上线未配对设备时同帧携带离线已配对常驻条目', async () => {
  resetBroadcastMocks();
  await seedSettings([{ deviceId: 'dev-a', deviceName: '设备A', secret: 'a'.repeat(64) }]);
  await writePeerState({
    'dev-a': { deviceId: 'dev-a', lastSyncAt: 1234, lastHost: '192.168.1.9', lastPort: 4321 },
  });
  startDiscovery({ deviceId: 'self-device', deviceName: 'self', appVersion: 't', port: 1 });

  const received: DeviceSnapshot[] = [];
  const unsubscribe = onPeersChanged((snapshot) => received.push(snapshot));
  try {
    browserHandlers.get('up')!({
      name: 'Stranger',
      addresses: ['192.168.1.6'],
      port: 2222,
      txt: { deviceId: 'dev-x', pv: '3' },
    });
    await until(() => received.some((s) => s.peers.some((p) => p.deviceId === 'dev-x')), 'broadcast with dev-x');

    const latest = received[received.length - 1]!;
    expect(latest.peers).toHaveLength(2);
    const x = latest.peers.find((p) => p.deviceId === 'dev-x')!;
    expect(x.online).toBe(true);
    const a = latest.peers.find((p) => p.deviceId === 'dev-a')!;
    expect(a.online).toBe(false);
    expect(a.name).toBe('设备A');
    expect(a.host).toBe('192.168.1.9');
    expect(a.port).toBe(4321);
  } finally {
    unsubscribe();
    resetBroadcastMocks();
  }
});

test('scanNow 探测成功后监听器收到广播快照（在线态翻转进事件）', async () => {
  resetBroadcastMocks();
  await seedSettings([{ deviceId: 'dev-c', deviceName: 'C', secret: 'c'.repeat(64) }]);
  await writePeerState({ 'dev-c': { deviceId: 'dev-c', lastSyncAt: 5, lastHost: '10.0.0.7', lastPort: 7777 } });
  fetchPeerInfoImpl = async () => helloOf('dev-c', 'C');
  startDiscovery({ deviceId: 'self-device', deviceName: 'self', appVersion: 't', port: 1 });

  const received: DeviceSnapshot[] = [];
  const unsubscribe = onPeersChanged((snapshot) => received.push(snapshot));
  try {
    await scanNow();
    await until(() => received.some((s) => s.peers.some((p) => p.deviceId === 'dev-c' && p.online)), 'broadcast with dev-c online');
  } finally {
    unsubscribe();
    resetBroadcastMocks();
  }
});

test('解除配对落库后 broadcastPeersSnapshot 快照即收敛（probeOnline 残留自动清理，无需通知 discovery）', async () => {
  resetBroadcastMocks();
  await seedSettings([{ deviceId: 'dev-c', deviceName: 'C', secret: 'c'.repeat(64) }]);
  await writePeerState({ 'dev-c': { deviceId: 'dev-c', lastSyncAt: 5, lastHost: '10.0.0.7', lastPort: 7777 } });
  fetchPeerInfoImpl = async () => helloOf('dev-c', 'C');
  startDiscovery({ deviceId: 'self-device', deviceName: 'self', appVersion: 't', port: 1 });

  try {
    const before = await scanNow();
    expect(before.peers.find((p) => p.deviceId === 'dev-c')?.online).toBe(true);

    await seedSettings([]);
    const received: DeviceSnapshot[] = [];
    const unsubscribe = onPeersChanged((snapshot) => received.push(snapshot));
    try {
      broadcastPeersSnapshot();
      await until(() => received.length > 0, 'broadcast after unpair');
      expect(received[0]!.peers.some((p) => p.deviceId === 'dev-c')).toBe(false);
      const again = await scanNow();
      expect(again.peers.some((p) => p.deviceId === 'dev-c')).toBe(false);
    } finally {
      unsubscribe();
    }
  } finally {
    resetBroadcastMocks();
  }
});
