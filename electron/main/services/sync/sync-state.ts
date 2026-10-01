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
  /** per-peer settings.json 三方合并基线：上次与该对端同步收敛后本端落盘的 settings.json 内容（顶层字段级比较用） */
  settingsBaseline?: Record<string, unknown>;
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

function getSyncStatePath(dataDir: string): string {
  return path.join(dataDir, 'sync-state.json');
}

export async function readSyncStateFrom(dataDir: string): Promise<SyncState> {
  const state = await safeJsonRead<SyncState | null>(getSyncStatePath(dataDir), null);
  if (!state || state.version !== 1 || typeof state.peers !== 'object' || state.peers === null) {
    return { version: 1, peers: {} };
  }
  return state;
}

export async function writeSyncStateTo(dataDir: string, state: SyncState): Promise<void> {
  await safeJsonWrite(getSyncStatePath(dataDir), state);
}

export async function readSyncState(): Promise<SyncState> {
  return readSyncStateFrom(getDataDir());
}

export async function writeSyncState(state: SyncState): Promise<void> {
  await writeSyncStateTo(getDataDir(), state);
}

const syncStateLocks = new Map<string, Promise<unknown>>();

/**
 * per-dataDir 串行互斥（F5）：fn 内完成「读-改-写」整段，并发调用排队执行，
 * 后写不再整覆盖先写。锁面 = sync-state.json 的全部读改写点；同进程协作式
 * （Electron 主进程单线程，F5 场景即同进程内 orchestrator/server/tipc 三写入点互踩），
 * 跨进程不在此范围。
 */
export async function withSyncStateLock<T>(dataDir: string, fn: () => Promise<T>): Promise<T> {
  const prev = syncStateLocks.get(dataDir) ?? Promise.resolve();
  const run = prev.then(fn, fn);
  const guard = run.catch(() => {});
  syncStateLocks.set(dataDir, guard);
  try {
    return await run;
  } finally {
    if (syncStateLocks.get(dataDir) === guard) syncStateLocks.delete(dataDir);
  }
}
