import path from 'node:path';
import { app } from 'electron';
import { safeJsonRead, safeJsonWrite } from '../safe-json.js';
import type { FileEntry } from './protocol.js';

export interface SyncStatePeer {
  deviceId: string;
  deviceName?: string;
  appVersion?: string;
  lastSyncAt: number;
  /** 上次同步结束时刻的快照整体指纹，仅作展示/比对两端是否同源，diff 判定用 lastManifest */
  lastManifestHash?: string;
  /** 下轮 diff 的基线：上次同步收敛后本端清单快照（带内容 hash）；仅在同步完成时整体替换 */
  lastManifest?: FileEntry[];
}

export interface SyncState {
  version: 1;
  /** 本机设备身份，首次生成后持久化；sync-state.json 不在同步白名单，不会自同步 */
  deviceId?: string;
  peers: Record<string, SyncStatePeer>;
}

export function getDataDir(): string {
  if (process.env.DOGEAR_CONFIG_DIR) return process.env.DOGEAR_CONFIG_DIR;
  if (app?.isPackaged) return path.join(app.getPath('userData'), '.dogear');
  return path.join(process.cwd(), '.dogear');
}

function getSyncStatePath(): string {
  return path.join(getDataDir(), 'sync-state.json');
}

export async function readSyncState(): Promise<SyncState> {
  const state = await safeJsonRead<SyncState | null>(getSyncStatePath(), null);
  if (!state || state.version !== 1 || typeof state.peers !== 'object' || state.peers === null) {
    return { version: 1, peers: {} };
  }
  return state;
}

export async function writeSyncState(state: SyncState): Promise<void> {
  await safeJsonWrite(getSyncStatePath(), state);
}
