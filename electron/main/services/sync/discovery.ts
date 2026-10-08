import os from 'node:os';
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
import { DEFAULT_SYNC_PORT, SYNC_PROTOCOL_VERSION, type HandshakeHello } from './protocol.js';

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
const SUBNET_SCAN_TIMEOUT_MS = 800;
const SUBNET_SCAN_CONCURRENCY = 48;

let bonjour: Bonjour | null = null;
let browser: Browser | null = null;
let requeryTimer: NodeJS.Timeout | null = null;
let publishedService: ReturnType<Bonjour['publish']> | null = null;
const peers = new Map<string, PeerInfo>();
/** 最近一次扫描探测成功的已配对设备（内存在线态，探测失败时移除）；不进 peers Map（那是 mDNS 在线态） */
const probeOnline = new Map<string, PeerInfo>();
/** 最近一轮网段扫描命中的设备（含未配对；mDNS 多播被路由/防火墙丢弃时的发现兑底），下轮扫描重建 */
const scanFound = new Map<string, PeerInfo>();
let selfDeviceId = '';
const peersChangedListeners = new Set<(snapshot: DeviceSnapshot) => void>();
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

// 快照要异步读 settings/sync-state（IO），广播改异步；in-flight 期间只记脏标记，完成后补发一帧防后发先至
let snapshotBroadcastInFlight = false;
let snapshotBroadcastQueued = false;

function notifyChanged(): void {
  if (snapshotBroadcastInFlight) {
    snapshotBroadcastQueued = true;
    return;
  }
  snapshotBroadcastInFlight = true;
  void getDeviceSnapshot()
    .then((snapshot) => {
      for (const cb of peersChangedListeners) {
        try {
          cb(snapshot);
        } catch (error) {
          console.error('[lan-sync] peersChanged 回调失败:', error);
        }
      }
    })
    .catch((error) => {
      console.error('[lan-sync] peers 快照广播失败:', error);
    })
    .finally(() => {
      snapshotBroadcastInFlight = false;
      if (snapshotBroadcastQueued) {
        snapshotBroadcastQueued = false;
        notifyChanged();
      }
    });
}

export function startDiscovery(opts: DiscoveryOptions): void {
  if (bonjour) return;
  discoveryError = null;
  selfDeviceId = opts.deviceId;
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
  if (peers.size > 0 || probeOnline.size > 0 || scanFound.size > 0) {
    peers.clear();
    probeOnline.clear();
    scanFound.clear();
    notifyChanged();
  }
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

/** 同步/配对入口的地址解析：mDNS → 探测在线 → 网段扫描命中 → 已配对地址记忆；均无返回 null */
export async function resolvePeerEndpoint(deviceId: string): Promise<(PeerEndpoint & { deviceName?: string }) | null> {
  for (const source of [peers, probeOnline, scanFound]) {
    const hit = source.get(deviceId);
    if (hit?.host && hit.port) return { host: hit.host, port: hit.port, deviceName: hit.name };
  }
  const [settings, state] = await Promise.all([loadSettings(), readSyncState()]);
  const paired = settings.syncOptions?.pairedDevices.find((d) => d.deviceId === deviceId);
  if (!paired) return null;
  const peerState = state.peers[deviceId];
  if (typeof peerState?.lastHost === 'string' && peerState.lastHost !== '' && typeof peerState.lastPort === 'number') {
    return { host: peerState.lastHost, port: peerState.lastPort, deviceName: paired.deviceName };
  }
  return null;
}

export function getDiscoveryError(): string | null {
  return discoveryError;
}

export function onPeersChanged(cb: (snapshot: DeviceSnapshot) => void): () => void {
  peersChangedListeners.add(cb);
  return () => peersChangedListeners.delete(cb);
}

/** 主动触发一次快照广播（解除配对后让各窗口刷新设备列表） */
export function broadcastPeersSnapshot(): void {
  notifyChanged();
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
  for (const [deviceId, found] of scanFound) {
    if (!merged.has(deviceId)) merged.set(deviceId, { ...found, online: true });
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
async function recordProbeAddress(deviceId: string, host: string, port: number, appVersion?: string): Promise<void> {
  const dataDir = getDataDir();
  await withSyncStateLock(dataDir, async () => {
    const state = await readSyncStateFrom(dataDir);
    const peer = state.peers[deviceId] ?? { deviceId, lastSyncAt: 0 };
    peer.lastHost = host;
    peer.lastPort = port;
    if (appVersion) peer.appVersion = appVersion;
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
  recordProbeAddress(paired.deviceId, address.host, address.port, hello.appVersion).catch((error) => {
    console.error('[lan-sync] 探测地址回写失败:', error);
  });
}

let scanInFlight: Promise<DeviceSnapshot> | null = null;

const VIRTUAL_NIC_PATTERN = /vmware|virtualbox|vmnet|veth|docker|wsl|hyper-?v|veternet|loopback|bluetooth|tailscale|zerotier|utun|bridge|tap/i;

function isPrivateV4(ip: string): boolean {
  const parts = ip.split('.').map(Number);
  if (parts.length !== 4 || parts.some((n) => Number.isNaN(n))) return false;
  const [a, b] = parts;
  return (a === 192 && b === 168) || a === 10 || (a === 172 && b >= 16 && b <= 31);
}

function subnetTargetsForScan(): { prefixes: string[]; selfIps: Set<string> } {
  const prefixes = new Set<string>();
  const selfIps = new Set<string>();
  for (const [iface, addrs] of Object.entries(os.networkInterfaces())) {
    for (const addr of addrs ?? []) {
      const family = addr.family as string | number;
      if (family !== 'IPv4' && family !== 4) continue;
      if (addr.internal || !isPrivateV4(addr.address)) continue;
      selfIps.add(addr.address);
      if (!VIRTUAL_NIC_PATTERN.test(iface)) prefixes.add(addr.address.split('.').slice(0, 3).join('.'));
    }
  }
  return { prefixes: [...prefixes], selfIps };
}

/**
 * 网段扫描：对本机私网 /24 逐 IP 探测 /info（仅默认端口）。
 * mDNS 多播在 IGMP snooping/AP 隔离等环境下不可靠（设备「自动断掉」的根因），
 * 未配对设备除此之外没有任何发现途径——这里是手动「寻找设备」的兑底。
 */
async function scanSubnets(
  pairedById: Map<string, { deviceId: string; deviceName?: string }>,
): Promise<boolean> {
  const { prefixes, selfIps } = subnetTargetsForScan();
  const found = new Map<string, PeerInfo>();
  for (const prefix of prefixes) {
    const targets: string[] = [];
    for (let i = 1; i <= 254; i++) {
      const ip = `${prefix}.${i}`;
      if (!selfIps.has(ip)) targets.push(ip);
    }
    for (let i = 0; i < targets.length; i += SUBNET_SCAN_CONCURRENCY) {
      await Promise.all(
        targets.slice(i, i + SUBNET_SCAN_CONCURRENCY).map(async (ip) => {
          try {
            const hello = await fetchPeerInfo({ host: ip, port: DEFAULT_SYNC_PORT }, SUBNET_SCAN_TIMEOUT_MS);
            if (!hello.deviceId || hello.deviceId === selfDeviceId) return;
            const paired = pairedById.get(hello.deviceId);
            if (paired) {
              onProbeSuccess(paired, { host: ip, port: DEFAULT_SYNC_PORT }, hello);
              return;
            }
            found.set(hello.deviceId, {
              deviceId: hello.deviceId,
              name: hello.deviceName ?? shortDeviceId(hello.deviceId),
              host: ip,
              port: DEFAULT_SYNC_PORT,
              appVersion: hello.appVersion,
              protocolVersion: hello.protocolVersion,
              lastSeen: Date.now(),
              online: true,
            });
          } catch {
            // 非 Dogear 服务或不可达
          }
        }),
      );
    }
  }
  let changed = scanFound.size !== found.size;
  if (!changed) {
    for (const [deviceId, peer] of found) {
      const prev = scanFound.get(deviceId);
      if (!prev || prev.host !== peer.host || prev.port !== peer.port) {
        changed = true;
        break;
      }
    }
  }
  scanFound.clear();
  for (const [deviceId, peer] of found) scanFound.set(deviceId, peer);
  return changed;
}

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
  waiters.push(scanSubnets(pairedById).then((subnetChanged) => {
    if (subnetChanged) changed = true;
  }));
  if (browser) {
    browser.update();
    waiters.push(new Promise<void>((resolve) => setTimeout(resolve, MDNS_SCAN_WINDOW_MS)));
  }
  await Promise.all(waiters);
  if (changed) notifyChanged();
  return getDeviceSnapshot();
}
