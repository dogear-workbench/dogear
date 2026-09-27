import { randomBytes, randomInt } from 'node:crypto';
import { loadSettings, saveSettings } from '../settings-service.js';
import type { HandshakeHello } from './protocol.js';
import { buildHello, getOrCreateDeviceId, resolveDeviceName } from './device.js';
import { sendPairRequest, type PeerEndpoint } from './client.js';

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
  const hello = buildHello(deviceId, resolveDeviceName(settings.syncOptions?.deviceName), appVersion);
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
  try {
    const result = await sendPairRequest(target, hello, code);
    if (!result.accepted || !result.secret) {
      const error = result.reason ?? '对端拒绝配对';
      const outcome: PairingOutcome = {
        ok: false, deviceId: target.deviceId, deviceName: target.deviceName, direction: 'outgoing', error,
      };
      emitOutcome(outcome);
      return outcome;
    }
    await addPairedDevice({ deviceId: target.deviceId, deviceName: target.deviceName ?? result.peerHello?.deviceName, secret: result.secret });
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
