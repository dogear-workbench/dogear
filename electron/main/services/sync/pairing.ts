import { randomBytes, randomInt } from 'node:crypto';
import { loadSettings, saveSettings } from '../settings-service.js';
import type { HandshakeHello } from './protocol.js';
import { buildHello, getOrCreateDeviceId, resolveDeviceName } from './device.js';
import { sendPairRequest, type PeerEndpoint } from './client.js';
import { getDataDir, readSyncStateFrom, withSyncStateLock, writeSyncStateTo } from './sync-state.js';

export interface PairingRequestInfo {
  requestId: string;
  code: string;
  peer: HandshakeHello;
  createdAt: number;
}

export interface PairingOutcome {
  ok: boolean;
  deviceId: string;
  deviceName?: string;
  direction: 'outgoing' | 'incoming';
  error?: string;
}

type RequestListener = (info: PairingRequestInfo) => void;
type OutcomeListener = (outcome: PairingOutcome) => void;

const PENDING_TTL_MS = 150_000;

const requestListeners = new Set<RequestListener>();
const outcomeListeners = new Set<OutcomeListener>();
const pendingIncoming = new Map<string, {
  info: PairingRequestInfo;
  resolve: (result: { accepted: boolean; reason?: string; secret?: string }) => void;
  timer: NodeJS.Timeout;
}>();
let selfHello: HandshakeHello | null = null;
let outgoingPairing: { deviceId: string; code: string } | null = null;

function emitOutcome(outcome: PairingOutcome): void {
  for (const cb of outcomeListeners) {
    try {
      cb(outcome);
    } catch (error) {
      console.error('[lan-sync] pairing outcome 回调失败:', error);
    }
  }
}

function generateCode(): string {
  return randomInt(0, 1_000_000).toString().padStart(6, '0');
}

async function addPairedDevice(entry: { deviceId: string; deviceName?: string; secret: string }): Promise<void> {
  const settings = await loadSettings();
  const syncOptions = settings.syncOptions!;
  syncOptions.pairedDevices = [
    ...syncOptions.pairedDevices.filter((d) => d.deviceId !== entry.deviceId),
    { ...entry, pairedAt: Date.now() },
  ];
  await saveSettings(settings);
}

/** 地址记忆只在成功路径写入（配对确认/同步成功/探测成功）；后续同步或探测成功会覆盖为最新地址 */
async function recordPeerAddress(deviceId: string, host: string, port: number, appVersion?: string): Promise<void> {
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

/** 解除配对：仅删本端 pairedDevices 条目；sync-state.peers 整条保留，重新配对后无缝续用基线/映射/地址 */
export async function unpairDevice(deviceId: string): Promise<void> {
  const { getRunningSync } = await import('./orchestrator.js');
  if (getRunningSync()) throw new Error('同步进行中，稍后再解除');
  const settings = await loadSettings();
  const syncOptions = settings.syncOptions!;
  if (!syncOptions.pairedDevices.some((d) => d.deviceId === deviceId)) return;
  syncOptions.pairedDevices = syncOptions.pairedDevices.filter((d) => d.deviceId !== deviceId);
  await saveSettings(settings);
}

/** 门面启动时注入本机握手信息，后续所有出站请求复用 */
export function setSelfHello(hello: HandshakeHello): void {
  selfHello = hello;
}

export function getSelfHello(): HandshakeHello {
  if (!selfHello) throw new Error('[lan-sync] self hello 未初始化');
  return selfHello;
}

export async function initSelfHello(appVersion: string): Promise<HandshakeHello> {
  const settings = await loadSettings();
  const deviceId = await getOrCreateDeviceId();
  const hello = buildHello(deviceId, resolveDeviceName(settings.syncOptions?.deviceName), appVersion, getDataDir());
  setSelfHello(hello);
  return hello;
}

/** 门面未启动（如单跑编排验证脚本）时兜底初始化，已初始化则直接复用 */
export async function ensureSelfHello(appVersion: string): Promise<HandshakeHello> {
  if (selfHello) return selfHello;
  return initSelfHello(appVersion);
}

/** A 端发起配对：生成本端展示码并发起请求，对端用户确认后返回共享密钥 */
export function beginPairing(
  target: PeerEndpoint & { deviceId: string; deviceName?: string },
): { code: string; result: Promise<PairingOutcome> } {
  const code = generateCode();
  outgoingPairing = { deviceId: target.deviceId, code };
  const result = runPairingRequest(target, code).finally(() => {
    if (outgoingPairing?.deviceId === target.deviceId) outgoingPairing = null;
  });
  return { code, result };
}

async function runPairingRequest(
  target: PeerEndpoint & { deviceId: string; deviceName?: string },
  code: string,
): Promise<PairingOutcome> {
  const hello = getSelfHello();
  const { getLanSyncPort } = await import('./lan-sync-service.js');
  try {
    const result = await sendPairRequest(target, hello, code, { listenPort: getLanSyncPort() ?? undefined });
    if (!result.accepted || !result.secret) {
      const error = result.reason ?? '对端拒绝配对';
      const outcome: PairingOutcome = {
        ok: false, deviceId: target.deviceId, deviceName: target.deviceName, direction: 'outgoing', error,
      };
      emitOutcome(outcome);
      return outcome;
    }
    await addPairedDevice({ deviceId: target.deviceId, deviceName: target.deviceName ?? result.peerHello?.deviceName, secret: result.secret });
    await recordPeerAddress(target.deviceId, target.host, target.port, result.peerHello?.appVersion);
    const outcome: PairingOutcome = { ok: true, deviceId: target.deviceId, deviceName: target.deviceName, direction: 'outgoing' };
    emitOutcome(outcome);
    return outcome;
  } catch (error) {
    const outcome: PairingOutcome = {
      ok: false,
      deviceId: target.deviceId,
      deviceName: target.deviceName,
      direction: 'outgoing',
      error: error instanceof Error ? error.message : String(error),
    };
    emitOutcome(outcome);
    return outcome;
  }
}

export function getOutgoingPairingCode(deviceId?: string): string | null {
  if (!outgoingPairing) return null;
  if (deviceId && outgoingPairing.deviceId !== deviceId) return null;
  return outgoingPairing.code;
}

/** B 端收到 pair-request 的入口（server 回调）：挂起等待本端用户确认 */
export async function handleIncomingPairRequest(
  hello: HandshakeHello,
  code: string,
  source?: { host: string; listenPort?: number },
): Promise<{ accepted: boolean; reason?: string; secret?: string }> {
  const requestId = randomBytes(8).toString('hex');
  const info: PairingRequestInfo = { requestId, code, peer: hello, createdAt: Date.now() };
  const result = await new Promise<{ accepted: boolean; reason?: string; secret?: string }>((resolve) => {
    const timer = setTimeout(() => {
      if (pendingIncoming.delete(requestId)) {
        resolve({ accepted: false, reason: '确认超时' });
      }
    }, PENDING_TTL_MS);
    pendingIncoming.set(requestId, { info, resolve, timer });
    for (const cb of requestListeners) {
      try {
        cb(info);
      } catch (error) {
        console.error('[lan-sync] pair request 回调失败:', error);
      }
    }
  });
  if (!result.accepted) return result;
  const secret = randomBytes(32).toString('hex');
  await addPairedDevice({ deviceId: hello.deviceId, deviceName: hello.deviceName, secret });
  // mDNS 被防火墙/睡眠断掉时，确认侧只能靠这里的地址记忆免于「地址未知」；失败不阻断配对结果
  const host = source?.host.replace(/^::ffff:/, '');
  if (host && source?.listenPort) {
    await recordPeerAddress(hello.deviceId, host, source.listenPort, hello.appVersion).catch((error) => {
      console.error('[lan-sync] incoming 配对地址回写失败:', error);
    });
  }
  emitOutcome({ ok: true, deviceId: hello.deviceId, deviceName: hello.deviceName, direction: 'incoming' });
  return { accepted: true, secret };
}

export async function confirmPairRequest(requestId: string): Promise<boolean> {
  const pending = pendingIncoming.get(requestId);
  if (!pending) return false;
  clearTimeout(pending.timer);
  pendingIncoming.delete(requestId);
  pending.resolve({ accepted: true });
  return true;
}

export async function rejectPairRequest(requestId: string, reason = '本端拒绝'): Promise<boolean> {
  const pending = pendingIncoming.get(requestId);
  if (!pending) return false;
  clearTimeout(pending.timer);
  pendingIncoming.delete(requestId);
  pending.resolve({ accepted: false, reason });
  return true;
}

export function getPendingPairRequests(): PairingRequestInfo[] {
  return [...pendingIncoming.values()].map((p) => p.info);
}

export function onPairRequest(cb: RequestListener): () => void {
  requestListeners.add(cb);
  return () => requestListeners.delete(cb);
}

export function onPairingCompleted(cb: OutcomeListener): () => void {
  outcomeListeners.add(cb);
  return () => outcomeListeners.delete(cb);
}
