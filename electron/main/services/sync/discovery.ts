import { Bonjour, type Browser, type Service } from 'bonjour-service';
import { loadSettings } from '../settings-service.js';
import { fetchPeerInfo, type PeerEndpoint } from './client.js';
import { shortDeviceId } from './apply.js';
import {
  getDataDir,
  readSyncState,
  readSyncStateFrom,
  withSyncStateLock,
  writeSyncStateTo,
} from './sync-state.js';
import { SYNC_PROTOCOL_VERSION, type HandshakeHello } from './protocol.js';

export const DOGEAR_MDNS_TYPE = 'dogear';

export interface PeerInfo {
  deviceId: string;
  name: string;
  host: string;
  port: number;
  appVersion?: string;
  protocolVersion?: number;
  lastSeen: number;
  /** mDNS 命中或最近一次扫描探测成功；离线已配对条目为 false（内存态，重启后初始离线） */
  online: boolean;
}

export interface DeviceSnapshot {
  peers: PeerInfo[];
}

export interface DiscoveryOptions {
  deviceId: string;
  deviceName: string;
  appVersion: string;
  port: number;
}

const PEER_STALE_MS = 90_000;
const REQUERY_INTERVAL_MS = 30_000;
const MDNS_SCAN_WINDOW_MS = 2_000;
const PROBE_TIMEOUT_MS = 3_000;

let bonjour: Bonjour | null = null;
let browser: Browser | null = null;
let requeryTimer: NodeJS.Timeout | null = null;
let publishedService: ReturnType<Bonjour['publish']> | null = null;
const peers = new Map<string, PeerInfo>();
/** 最近一次扫描探测成功的已配对设备（内存在线态，探测失败时移除）；不进 peers Map（那是 mDNS 在线态） */
const probeOnline = new Map<string, PeerInfo>();
const peersChangedListeners = new Set<(peers: PeerInfo[]) => void>();
let discoveryError: string | null = null;

function pickHost(addresses: string[] | undefined, fallback?: string): string {
  const list = addresses ?? [];
  const ipv4 = list.find((a) => /^(\d{1,3}\.){3}\d{1,3}$/.test(a) && !a.startsWith('127.'));
  if (ipv4) return ipv4;
  const ipv6 = list.find((a) => a.includes(':') && !a.startsWith('fe80:') && !a.startsWith('::1'));
  if (ipv6) return ipv6;
  return fallback && !fallback.startsWith('127.') ? fallback : '';
}

function upsertFromService(svc: Service): boolean {
  const deviceId = svc.txt?.deviceId;
  if (typeof deviceId !== 'string' || deviceId === '') return false;
  const host = pickHost(svc.addresses, svc.referer?.address);
  const port = svc.port;
  if (!host || !port) return false;
  const prev = peers.get(deviceId);
  const protocolRaw = svc.txt?.pv;
  peers.set(deviceId, {
    deviceId,
    name: svc.name,
    host,
    port,
    appVersion: typeof svc.txt?.dv === 'string' ? svc.txt.dv : undefined,
    protocolVersion: typeof protocolRaw === 'string' ? Number(protocolRaw) : undefined,
    lastSeen: Date.now(),
    online: true,
  });
  if (prev?.host === host && prev?.port === port) return false;
  return true;
}

function notifyChanged(): void {
  const snapshot = getPeers();
  for (const cb of peersChangedListeners) {
    try {
      cb(snapshot);
    } catch (error) {
      console.error('[lan-sync] peersChanged 回调失败:', error);
    }
  }
}

export function startDiscovery(opts: DiscoveryOptions): void {
  if (bonjour) return;
  discoveryError = null;
  try {
    bonjour = new Bonjour();
    publishedService = bonjour.publish({
      name: opts.deviceName,
      type: DOGEAR_MDNS_TYPE,
      port: opts.port,
      txt: {
        deviceId: opts.deviceId,
        dv: opts.appVersion,
        pv: String(SYNC_PROTOCOL_VERSION),
      },
    });
    publishedService.on('error', (error: Error) => {
      discoveryError = `mDNS 广播失败: ${error.message}`;
      console.error('[lan-sync]', discoveryError);
    });

    browser = bonjour.find({ type: DOGEAR_MDNS_TYPE });
    browser.on('up', (svc: Service) => {
      if (svc.txt?.deviceId === opts.deviceId) return;
      if (upsertFromService(svc)) notifyChanged();
    });
    browser.on('down', (svc: Service) => {
      const deviceId = svc.txt?.deviceId;
      if (typeof deviceId === 'string' && peers.delete(deviceId)) notifyChanged();
    });
    browser.on('txt-update', (svc: Service) => {
      if (svc.txt?.deviceId === opts.deviceId) return;
      if (peers.has(svc.txt?.deviceId)) notifyChanged();
    });

    requeryTimer = setInterval(() => {
      browser?.update();
      let changed = false;
      const now = Date.now();
      for (const [deviceId, peer] of peers) {
        if (now - peer.lastSeen > PEER_STALE_MS) {
          peers.delete(deviceId);
          changed = true;
        }
      }
      if (changed) notifyChanged();
    }, REQUERY_INTERVAL_MS);
    requeryTimer.unref();
  } catch (error) {
    discoveryError = `mDNS 初始化失败: ${error instanceof Error ? error.message : String(error)}`;
    console.error('[lan-sync]', discoveryError);
    stopDiscovery();
  }
}

export function stopDiscovery(): void {
  if (requeryTimer) {
    clearInterval(requeryTimer);
    requeryTimer = null;
  }
  if (peers.size > 0) {
    peers.clear();
    notifyChanged();
  }
  probeOnline.clear();
  try {
    bonjour?.unpublishAll(() => bonjour?.destroy());
  } catch {
    bonjour?.destroy();
  }
  bonjour = null;
  browser = null;
  publishedService = null;
}

export function getPeers(): PeerInfo[] {
  return [...peers.values()].sort((a, b) => a.name.localeCompare(b.name));
}

export function getDiscoveryError(): string | null {
  return discoveryError;
}

export function onPeersChanged(cb: (peers: PeerInfo[]) => void): () => void {
  peersChangedListeners.add(cb);
  return () => peersChangedListeners.delete(cb);
}

/**
 * 设备总览快照：mDNS 在线 ∪ 探测在线 ∪ 全部已配对（离线兑底）。
 * 已配对设备不进 peers Map（那是 mDNS 在线态），合并只发生在快照输出层；同 deviceId 键去重，mDNS 命中优先。
 */
export async function getDeviceSnapshot(): Promise<DeviceSnapshot> {
  const [settings, state] = await Promise.all([loadSettings(), readSyncState()]);
  const pairedDevices = settings.syncOptions?.pairedDevices ?? [];
  const pairedIds = new Set(pairedDevices.map((d) => d.deviceId));
  const merged = new Map<string, PeerInfo>();
  for (const peer of getPeers()) merged.set(peer.deviceId, { ...peer, online: true });
  for (const [deviceId, probe] of probeOnline) {
    if (!pairedIds.has(deviceId)) {
      probeOnline.delete(deviceId);
      continue;
    }
    if (!merged.has(deviceId)) merged.set(deviceId, { ...probe, online: true });
  }
  for (const paired of pairedDevices) {
    if (merged.has(paired.deviceId)) continue;
    const peerState = state.peers[paired.deviceId];
    merged.set(paired.deviceId, {
      deviceId: paired.deviceId,
      name: paired.deviceName ?? shortDeviceId(paired.deviceId),
      host: peerState?.lastHost ?? '',
      port: peerState?.lastPort ?? 0,
      appVersion: peerState?.appVersion,
      lastSeen: peerState?.lastSyncAt ?? 0,
      online: false,
    });
  }
  return { peers: [...merged.values()].sort((a, b) => a.name.localeCompare(b.name)) };
}

/** 探测成功地址回写（与 pairing.recordPeerAddress / orchestrator 收尾同一读改写模式）；只在成功路径调用，失败不删旧值 */
async function recordProbeAddress(deviceId: string, host: string, port: number): Promise<void> {
  const dataDir = getDataDir();
  await withSyncStateLock(dataDir, async () => {
    const state = await readSyncStateFrom(dataDir);
    const peer = state.peers[deviceId] ?? { deviceId, lastSyncAt: 0 };
    peer.lastHost = host;
    peer.lastPort = port;
    state.peers[deviceId] = peer;
    await writeSyncStateTo(dataDir, state);
  });
}

function onProbeSuccess(paired: { deviceId: string; deviceName?: string }, address: PeerEndpoint, hello: HandshakeHello): void {
  probeOnline.set(paired.deviceId, {
    deviceId: paired.deviceId,
    name: paired.deviceName ?? hello.deviceName ?? shortDeviceId(paired.deviceId),
    host: address.host,
    port: address.port,
    appVersion: hello.appVersion,
    protocolVersion: hello.protocolVersion,
    lastSeen: Date.now(),
    online: true,
  });
  recordProbeAddress(paired.deviceId, address.host, address.port).catch((error) => {
    console.error('[lan-sync] 探测地址回写失败:', error);
  });
}

let scanInFlight: Promise<DeviceSnapshot> | null = null;

/** 手动触发一轮发现：mDNS 主动查询窗口 + 并行探测已配对设备记忆地址；并发调用共享同一轮结果 */
export function scanNow(): Promise<DeviceSnapshot> {
  if (scanInFlight) return scanInFlight;
  scanInFlight = runScanNow().finally(() => {
    scanInFlight = null;
  });
  return scanInFlight;
}

async function runScanNow(): Promise<DeviceSnapshot> {
  const [settings, state] = await Promise.all([loadSettings(), readSyncState()]);
  const pairedDevices = settings.syncOptions?.pairedDevices ?? [];
  const pairedById = new Map(pairedDevices.map((d) => [d.deviceId, d]));
  const addressById = new Map<string, PeerEndpoint>();
  for (const [deviceId, peerState] of Object.entries(state.peers)) {
    if (!pairedById.has(deviceId)) continue;
    if (typeof peerState.lastHost === 'string' && peerState.lastHost !== '' && typeof peerState.lastPort === 'number') {
      addressById.set(deviceId, { host: peerState.lastHost, port: peerState.lastPort });
    }
  }
  let changed = false;
  const probes = [...addressById].map(async ([deviceId, address]) => {
    const paired = pairedById.get(deviceId)!;
    try {
      const hello = await fetchPeerInfo(address, PROBE_TIMEOUT_MS);
      const knownByMdns = peers.has(deviceId);
      onProbeSuccess(paired, address, hello);
      if (!knownByMdns) changed = true;
    } catch {
      if (probeOnline.delete(deviceId)) changed = true;
    }
  });
  const waiters: Promise<unknown>[] = probes;
  if (browser) {
    browser.update();
    waiters.push(new Promise<void>((resolve) => setTimeout(resolve, MDNS_SCAN_WINDOW_MS)));
  }
  await Promise.all(waiters);
  if (changed) notifyChanged();
  return getDeviceSnapshot();
}
