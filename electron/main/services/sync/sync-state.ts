import path from 'node:path';
import { app } from 'electron';
import { safeJsonRead, safeJsonWrite } from '../safe-json.js';

export interface SyncStatePeer {
  deviceId: string;
  deviceName?: string;
  appVersion?: string;
  lastSyncAt: number;
  lastManifestHash?: string;
}

export interface SyncState {
  version: 1;
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
