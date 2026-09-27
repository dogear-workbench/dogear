import path from 'node:path';
import { app } from 'electron';
import { safeJsonRead, safeJsonWrite } from '../safe-json.js';
import type { FileEntry } from './protocol.js';
import type { WorkspaceMapEntry, WorkspaceMetaItem } from './workspace-map.js';

export interface SyncStatePeer {
  deviceId: string;
  deviceName?: string;
  appVersion?: string;
  lastSyncAt: number;
  /** 上次同步结束时刻的快照整体指纹，仅作展示/比对两端是否同源，diff 判定用 lastManifest */
  lastManifestHash?: string;
  /** 下轮 diff 的基线：上次同步收敛后本端清单快照（带内容 hash）；仅在同步完成时整体替换 */
  lastManifest?: FileEntry[];
  /** per-peer 工作区映射表：本端 wsid → { 对端 wsid（缺省同 id 直通）, enabled 同步开关 }；未映射的本端工作区不同步 */
  workspaceMap?: Record<string, WorkspaceMapEntry>;
  /** 待映射区选过「不同步」的对端 wsid：不同步也不再提示，可在面板解除 */
  ignoredRemoteWorkspaces?: string[];
  /** 最近一次握手收到的对端工作区概要（待映射/已映射区展示对端名用） */
  remoteWorkspaceMeta?: WorkspaceMetaItem[];
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
