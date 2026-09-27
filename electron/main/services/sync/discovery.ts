import { Bonjour, type Browser, type Service } from 'bonjour-service';
import { SYNC_PROTOCOL_VERSION } from './protocol.js';

export const DOGEAR_MDNS_TYPE = 'dogear';

export interface PeerInfo {
  deviceId: string;
  name: string;
  host: string;
  port: number;
  appVersion?: string;
  protocolVersion?: number;
  lastSeen: number;
}

export interface DiscoveryOptions {
  deviceId: string;
  deviceName: string;
  appVersion: string;
  port: number;
}

const PEER_STALE_MS = 90_000;
const REQUERY_INTERVAL_MS = 30_000;

let bonjour: Bonjour | null = null;
let browser: Browser | null = null;
let requeryTimer: NodeJS.Timeout | null = null;
let publishedService: ReturnType<Bonjour['publish']> | null = null;
const peers = new Map<string, PeerInfo>();
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
