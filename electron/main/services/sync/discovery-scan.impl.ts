import { test, expect, mock } from 'bun:test';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import type { AppSettings, SyncOptions } from '../settings-types.js';

// 由 zz-discovery-scan.test.ts 以 `bun test <本文件>` 在独立子进程中运行（隔离原因同 pairing-unpair.impl.ts）：
// mock.module 进程级持久 + 多 worker env 串扰会污染本组用例；隔离配置目录防读写真实项目 .dogear
const dataDir = await fsp.mkdtemp(path.join(tmpdir(), 'dogear-discovery-scan-'));
process.env.DOGEAR_CONFIG_DIR = dataDir;

mock.module('electron', () => ({
  default: { app: { getPath: () => tmpdir() }, nativeTheme: {} },
  app: { getPath: () => tmpdir() },
  nativeTheme: {},
}));

// scanNow 含网段扫描（subnetTargetsForScan），mock 掉 networkInterfaces 防止用例向真实局域网发请求；
// 默认空接口 = 零网段目标，需要网段扫描的用例再注入 fake 接口
import * as realOs from 'node:os';
let fakeInterfaces: Record<string, Array<{ family: string; internal: boolean; address: string }>> = {};
mock.module('node:os', () => ({
  ...realOs,
  default: { ...realOs, networkInterfaces: () => fakeInterfaces },
  networkInterfaces: () => fakeInterfaces,
}));

const browserHandlers = new Map<string, (svc: unknown) => void>();
let browserUpdateCount = 0;
const fakeBrowser = {
  on: (event: string, cb: (svc: unknown) => void) => {
    browserHandlers.set(event, cb);
  },
  update: () => {
    browserUpdateCount += 1;
  },
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

const { loadSettings, saveSettings } = await import('../settings-service.js');
const { getDeviceSnapshot, scanNow, startDiscovery, stopDiscovery, resolvePeerEndpoint } = await import('./discovery.js');
const { readSyncStateFrom, writeSyncStateTo } = await import('./sync-state.js');

const realClient = await import('./client.js');
type ClientModule = typeof realClient;
let fetchPeerInfoImpl: ((...args: unknown[]) => Promise<unknown>) | null = null;
let fetchPeerInfoCalls: Array<[{ host: string; port: number }, number]> = [];

mock.module('./client.js', () => ({
  ...realClient,
  fetchPeerInfo: (...args: Parameters<ClientModule['fetchPeerInfo']>) => {
    fetchPeerInfoCalls.push(args as [{ host: string; port: number }, number]);
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

function resetProbeMocks(): void {
  stopDiscovery();
  fetchPeerInfoImpl = null;
  fetchPeerInfoCalls = [];
  browserUpdateCount = 0;
  fakeInterfaces = {};
}

test('getDeviceSnapshot：mDNS 空 + 已配对离线兜底（host/port 取 lastHost/lastPort，无地址记录短码兑底）', async () => {
  resetProbeMocks();
  await seedSettings([
    { deviceId: 'dev-a', deviceName: '设备A', secret: 'a'.repeat(64) },
    { deviceId: 'dev-bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb', secret: 'b'.repeat(64) },
  ]);
  await writePeerState({
    'dev-a': { deviceId: 'dev-a', lastSyncAt: 1234, appVersion: '1.2.3', lastHost: '192.168.1.9', lastPort: 4321 },
  });

  const snap = await getDeviceSnapshot();

  expect(snap.peers.map((p) => p.deviceId).sort()).toEqual(['dev-a', 'dev-bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb']);
  const a = snap.peers.find((p) => p.deviceId === 'dev-a')!;
  expect(a.online).toBe(false);
  expect(a.name).toBe('设备A');
  expect(a.host).toBe('192.168.1.9');
  expect(a.port).toBe(4321);
  expect(a.appVersion).toBe('1.2.3');
  expect(a.lastSeen).toBe(1234);
  const b = snap.peers.find((p) => p.deviceId === 'dev-bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb')!;
  expect(b.online).toBe(false);
  expect(b.host).toBe('');
  expect(b.port).toBe(0);
  expect(b.name).not.toBe('');
});

test('getDeviceSnapshot：mDNS 命中优先于已配对离线条目（deviceId 去重），未配对 mDNS 设备照常出现', async () => {
  resetProbeMocks();
  await seedSettings([{ deviceId: 'dev-a', deviceName: 'PAIRED-NAME', secret: 'a'.repeat(64) }]);
  await writePeerState({ 'dev-a': { deviceId: 'dev-a', lastSyncAt: 1, lastHost: '10.0.0.1', lastPort: 2000 } });
  startDiscovery({ deviceId: 'self-device', deviceName: 'self', appVersion: 't', port: 1 });
  browserHandlers.get('up')!({
    name: 'MDNS-NAME',
    addresses: ['192.168.1.5'],
    port: 1111,
    txt: { deviceId: 'dev-a', pv: '3', dv: '9.9.9' },
  });
  browserHandlers.get('up')!({
    name: 'Stranger',
    addresses: ['192.168.1.6'],
    port: 2222,
    txt: { deviceId: 'dev-x', pv: '3' },
  });

  try {
    const snap = await getDeviceSnapshot();
    expect(snap.peers).toHaveLength(2);
    const a = snap.peers.find((p) => p.deviceId === 'dev-a')!;
    expect(a.online).toBe(true);
    expect(a.name).toBe('MDNS-NAME');
    expect(a.host).toBe('192.168.1.5');
    expect(a.port).toBe(1111);
    const x = snap.peers.find((p) => p.deviceId === 'dev-x')!;
    expect(x.online).toBe(true);
  } finally {
    stopDiscovery();
  }
});

test('scanNow 探测成功：mDNS 未见过则并入快照 online:true，探测地址回写 peerState', async () => {
  resetProbeMocks();
  await seedSettings([{ deviceId: 'dev-c', deviceName: 'C', secret: 'c'.repeat(64) }]);
  await writePeerState({ 'dev-c': { deviceId: 'dev-c', lastSyncAt: 5, lastHost: '10.0.0.7', lastPort: 7777 } });
  fetchPeerInfoImpl = async () => helloOf('dev-c', 'C');

  try {
    const snap = await scanNow();
    expect(fetchPeerInfoCalls).toHaveLength(1);
    expect(fetchPeerInfoCalls[0][0]).toEqual({ host: '10.0.0.7', port: 7777 });
    const c = snap.peers.find((p) => p.deviceId === 'dev-c')!;
    expect(c.online).toBe(true);
    expect(c.host).toBe('10.0.0.7');
    expect(c.port).toBe(7777);
    expect(c.appVersion).toBe('9.9.9');
    await until(() => readSyncStateFrom(dataDir).then((s) => s.peers['dev-c']?.appVersion === '9.9.9'), 'probe address 回写');
    const state = await readSyncStateFrom(dataDir);
    expect(state.peers['dev-c']?.lastHost).toBe('10.0.0.7');
    expect(state.peers['dev-c']?.lastPort).toBe(7777);
    expect(state.peers['dev-c']?.appVersion).toBe('9.9.9');
  } finally {
    resetProbeMocks();
  }
});

test('scanNow 探测失败：计离线不抛错，lastHost/lastPort 旧值不删', async () => {
  resetProbeMocks();
  await seedSettings([{ deviceId: 'dev-c', deviceName: 'C', secret: 'c'.repeat(64) }]);
  await writePeerState({ 'dev-c': { deviceId: 'dev-c', lastSyncAt: 5, lastHost: '10.0.0.7', lastPort: 7777 } });
  fetchPeerInfoImpl = async () => {
    throw new Error('connect timeout');
  };

  try {
    const snap = await scanNow();
    const c = snap.peers.find((p) => p.deviceId === 'dev-c')!;
    expect(c.online).toBe(false);
    expect(c.host).toBe('10.0.0.7');
    expect(c.port).toBe(7777);
    const state = await readSyncStateFrom(dataDir);
    expect(state.peers['dev-c']?.lastHost).toBe('10.0.0.7');
    expect(state.peers['dev-c']?.lastPort).toBe(7777);
  } finally {
    resetProbeMocks();
  }
});

test('scanNow：已配对但无地址记录（配对后从未同步/探测）跳过探测，仅离线呈现', async () => {
  resetProbeMocks();
  await seedSettings([{ deviceId: 'dev-n', deviceName: 'N', secret: 'd'.repeat(64) }]);
  await writePeerState({});

  const snap = await scanNow();

  expect(fetchPeerInfoCalls).toHaveLength(0);
  expect(snap.peers).toHaveLength(1);
  expect(snap.peers[0]?.deviceId).toBe('dev-n');
  expect(snap.peers[0]?.online).toBe(false);
});

test('scanNow 并发调用共享同一轮扫描（防抖）', async () => {
  resetProbeMocks();
  await seedSettings([{ deviceId: 'dev-c', deviceName: 'C', secret: 'c'.repeat(64) }]);
  await writePeerState({ 'dev-c': { deviceId: 'dev-c', lastSyncAt: 5, lastHost: '10.0.0.7', lastPort: 7777 } });
  let resolveProbe!: (value: unknown) => void;
  fetchPeerInfoImpl = () => new Promise((resolve) => { resolveProbe = resolve; });

  try {
    const p1 = scanNow();
    const p2 = scanNow();
    expect(p2).toBe(p1);
    await until(() => fetchPeerInfoCalls.length === 1, 'probe entered');
    resolveProbe(helloOf('dev-c', 'C'));
    await Promise.all([p1, p2]);
    expect(fetchPeerInfoCalls).toHaveLength(1);
  } finally {
    resetProbeMocks();
  }
});

test('网段扫描兑底：mDNS 零命中时未配对设备经 /info 进快照，虚拟网卡网段与本机 IP 不扫', async () => {
  resetProbeMocks();
  await seedSettings([]);
  await writePeerState({});
  fakeInterfaces = {
    WLAN: [{ family: 'IPv4', internal: false, address: '192.168.1.100' }],
    'VMware Network Adapter VMnet8': [{ family: 'IPv4', internal: false, address: '172.16.88.1' }],
  };
  fetchPeerInfoImpl = async (...args: unknown[]) => {
    const peer = args[0] as { host: string };
    if (peer.host === '192.168.1.50') return helloOf('dev-lan', 'LanDevice');
    throw new Error('refused');
  };

  try {
    const snap = await scanNow();
    const lan = snap.peers.find((p) => p.deviceId === 'dev-lan');
    expect(lan).toBeDefined();
    expect(lan!.online).toBe(true);
    expect(lan!.host).toBe('192.168.1.50');
    expect(lan!.port).toBe(47210);
    expect(lan!.name).toBe('LanDevice');
    const hosts = fetchPeerInfoCalls.map(([p]) => p.host);
    expect(hosts.length).toBeGreaterThan(0);
    expect(hosts.every((h) => h.startsWith('192.168.1.'))).toBe(true);
    expect(hosts).not.toContain('192.168.1.100');
  } finally {
    resetProbeMocks();
  }
});

test('网段扫描命中已配对设备（记忆地址失效）：进快照在线且地址记忆回写', async () => {
  resetProbeMocks();
  await seedSettings([{ deviceId: 'dev-m', deviceName: 'M', secret: 'd'.repeat(64) }]);
  await writePeerState({ 'dev-m': { deviceId: 'dev-m', lastSyncAt: 5, lastHost: '10.0.0.99', lastPort: 47210 } });
  fakeInterfaces = { WLAN: [{ family: 'IPv4', internal: false, address: '192.168.1.100' }] };
  fetchPeerInfoImpl = async (...args: unknown[]) => {
    const peer = args[0] as { host: string };
    if (peer.host === '192.168.1.50') return helloOf('dev-m', 'M');
    throw new Error('refused');
  };
  try {
    const snap = await scanNow();
    const m = snap.peers.find((p) => p.deviceId === 'dev-m')!;
    expect(m.online).toBe(true);
    expect(m.host).toBe('192.168.1.50');
    expect(m.port).toBe(47210);
    await until(() => readSyncStateFrom(dataDir).then((s) => s.peers['dev-m']?.lastHost === '192.168.1.50'), 'subnet 地址回写');
    const state = await readSyncStateFrom(dataDir);
    expect(state.peers['dev-m']?.lastPort).toBe(47210);
  } finally {
    resetProbeMocks();
  }
});

test('resolvePeerEndpoint：mDNS/探测/扫描均无时，已配对地址记忆兑底；未配对返回 null', async () => {
  resetProbeMocks();
  await seedSettings([
    { deviceId: 'dev-p', deviceName: 'P', secret: 'e'.repeat(64) },
    { deviceId: 'dev-q', deviceName: 'Q', secret: 'f'.repeat(64) },
  ]);
  await writePeerState({
    'dev-p': { deviceId: 'dev-p', lastSyncAt: 5, lastHost: '192.168.31.21', lastPort: 47210 },
  });

  const p = await resolvePeerEndpoint('dev-p');
  expect(p).toEqual({ host: '192.168.31.21', port: 47210, deviceName: 'P' });
  const q = await resolvePeerEndpoint('dev-q');
  expect(q).toBeNull();
  const ghost = await resolvePeerEndpoint('not-a-device');
  expect(ghost).toBeNull();
});

test('resolvePeerEndpoint：网段扫描命中优先于地址记忆（取扫描时实际可达地址）', async () => {
  resetProbeMocks();
  await seedSettings([{ deviceId: 'dev-r', deviceName: 'R', secret: '1a'.repeat(32) }]);
  await writePeerState({
    'dev-r': { deviceId: 'dev-r', lastSyncAt: 5, lastHost: '10.0.0.55', lastPort: 47210 },
  });
  fakeInterfaces = { WLAN: [{ family: 'IPv4', internal: false, address: '192.168.31.188' }] };
  fetchPeerInfoImpl = async (...args: unknown[]) => {
    const peer = args[0] as { host: string };
    if (peer.host === '192.168.31.21') return helloOf('dev-r', 'R');
    throw new Error('refused');
  };

  try {
    await scanNow();
    const r = await resolvePeerEndpoint('dev-r');
    expect(r).toEqual({ host: '192.168.31.21', port: 47210, deviceName: 'R' });
  } finally {
    resetProbeMocks();
  }
});

test('scanNow：mDNS 窗口内 browser.update 触发一轮，未配对设备不参与探测', async () => {
  resetProbeMocks();
  await seedSettings([{ deviceId: 'dev-c', deviceName: 'C', secret: 'c'.repeat(64) }]);
  await writePeerState({
    'dev-c': { deviceId: 'dev-c', lastSyncAt: 5, lastHost: '10.0.0.7', lastPort: 7777 },
    'dev-x': { deviceId: 'dev-x', lastSyncAt: 5, lastHost: '10.0.0.8', lastPort: 8888 },
  });
  fetchPeerInfoImpl = async () => helloOf('dev-c', 'C');
  startDiscovery({ deviceId: 'self-device', deviceName: 'self', appVersion: 't', port: 1 });

  try {
    await scanNow();
    expect(browserUpdateCount).toBe(1);
    expect(fetchPeerInfoCalls).toHaveLength(1);
    expect(fetchPeerInfoCalls[0][0].host).toBe('10.0.0.7');
  } finally {
    resetProbeMocks();
  }
});
