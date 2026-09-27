import { createReadStream } from 'node:fs';
import fsp from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { app } from 'electron';
import { loadSettings } from '../settings-service.js';
import { buildManifest, diffManifests, hashEntries, sha256File, type ManifestOptions } from './manifest.js';
import {
  applyIncoming,
  conflictCopyRelPath,
  pushOutgoing,
  resolveWithinDataDir,
  saveStreamToTempFile,
  shortDeviceId,
  type IncomingApplyItem,
} from './apply.js';
import { fetchManifest, pullFile, pushFile, type PeerEndpoint } from './client.js';
import { getDataDir, readSyncState, writeSyncState } from './sync-state.js';
import { ensureSelfHello } from './pairing.js';
import { SYNC_PROTOCOL_VERSION, type FileEntry, type SkippedEntry } from './protocol.js';

export type SyncReportStatus = 'completed' | 'failed' | 'blocked' | 'in-progress';

/** 同步方向：pull=仅拉取（默认，对端永不被修改）；push=仅推送；both=双向 */
export type SyncDirection = 'both' | 'pull' | 'push';

export interface SyncReport {
  status: SyncReportStatus;
  ok: boolean;
  peerId: string;
  peerName?: string;
  pulled: number;
  pushed: number;
  /** 待用户处理的冲突（本轮已跳过未传输）；下次同步带 conflictResolutions 裁决后执行 */
  conflicts: string[];
  /** 仅拉取档按 mtime 自动取新者的冲突文件；败方留 .conflict-<胜方短ID> 副本可换回 */
  autoResolved?: Array<{ relPath: string; winner: 'local' | 'remote' }>;
  /** 本次同步方向（缺省 pull） */
  direction?: SyncDirection;
  skipped: SkippedEntry[];
  warnings: string[];
  /** 非空表示本次同步被拦下等待用户确认（UI 确认后带 confirmVersionMismatch 重调） */
  confirmRequired?: 'protocol-version-mismatch';
  remoteHello?: { protocolVersion: number; appVersion: string; deviceName?: string };
  durationMs: number;
  error?: string;
  finishedAt: number;
}

export type SyncProgressEvent =
  | { kind: 'started'; peerId: string; startedAt: number }
  | { kind: 'completed'; report: SyncReport };

type ProgressListener = (event: SyncProgressEvent) => void;

const progressListeners = new Set<ProgressListener>();
let runningSync: { peerId: string; startedAt: number } | null = null;

export function getRunningSync(): { peerId: string; startedAt: number } | null {
  return runningSync ? { ...runningSync } : null;
}

export function onSyncProgress(cb: ProgressListener): () => void {
  progressListeners.add(cb);
  return () => progressListeners.delete(cb);
}

function emitProgress(event: SyncProgressEvent): void {
  for (const cb of progressListeners) {
    try {
      cb(event);
    } catch (error) {
      console.error('[lan-sync] progress 回调失败:', error);
    }
  }
}

function errMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function currentAppVersion(): string {
  try {
    return app.getVersion();
  } catch {
    return 'dev';
  }
}

export interface RunSyncPeer extends PeerEndpoint {
  deviceId: string;
  deviceName?: string;
}

export interface RunSyncOptions {
  /** 握手协议版本不匹配时，用户确认后为 true 放行 */
  confirmVersionMismatch?: boolean;
  /** 同步方向，缺省 pull（仅拉取） */
  direction?: SyncDirection;
  /** 双改冲突裁决表（双向/推送档）：key=relPath，value=胜方。缺条目的冲突本轮挂起（进 conflicts 待处理） */
  conflictResolutions?: Record<string, 'local' | 'remote'>;
}

export async function runSync(peer: RunSyncPeer, options: RunSyncOptions = {}): Promise<SyncReport> {
  const startedAt = Date.now();
  const base: Omit<SyncReport, 'status' | 'ok' | 'durationMs' | 'finishedAt'> = {
    peerId: peer.deviceId,
    peerName: peer.deviceName,
    pulled: 0,
    pushed: 0,
    conflicts: [],
    autoResolved: [],
    direction: options.direction ?? 'pull',
    skipped: [],
    warnings: [],
  };
  if (runningSync) {
    return {
      ...base,
      peerId: runningSync.peerId,
      status: 'in-progress',
      ok: false,
      error: `已有同步正在进行（对端 ${runningSync.peerId}），请稍后再试`,
      durationMs: 0,
      finishedAt: Date.now(),
    };
  }
  runningSync = { peerId: peer.deviceId, startedAt };
  emitProgress({ kind: 'started', peerId: peer.deviceId, startedAt });
  try {
    const report = await runSyncInternal(peer, options, base, startedAt);
    emitProgress({ kind: 'completed', report });
    return report;
  } catch (error) {
    const report: SyncReport = {
      ...base,
      status: 'failed',
      ok: false,
      error: errMessage(error),
      durationMs: Date.now() - startedAt,
      finishedAt: Date.now(),
    };
    emitProgress({ kind: 'completed', report });
    return report;
  } finally {
    runningSync = null;
  }
}

async function runSyncInternal(
  peer: RunSyncPeer,
  options: RunSyncOptions,
  base: Omit<SyncReport, 'status' | 'ok' | 'durationMs' | 'finishedAt'>,
  startedAt: number,
): Promise<SyncReport> {
  const dataDir = getDataDir();
  const selfHello = await ensureSelfHello(currentAppVersion());
  const settings = await loadSettings();
  const paired = settings.syncOptions?.pairedDevices.find((d) => d.deviceId === peer.deviceId);
  if (!paired) {
    return { ...base, status: 'failed', ok: false, error: '未与该设备配对，无法同步', durationMs: Date.now() - startedAt, finishedAt: Date.now() };
  }
  const auth = { deviceId: selfHello.deviceId, secret: paired.secret };
  const manifestOptions: ManifestOptions = {
    syncStocksData: settings.syncOptions?.syncStocksData === true,
    syncFeishu: settings.syncOptions?.syncFeishu === true,
  };

  const local = await buildManifest(dataDir, manifestOptions);
  const remoteManifest = await fetchManifest(peer, auth, selfHello, local);
  const remoteHello = {
    protocolVersion: remoteManifest.hello.protocolVersion,
    appVersion: remoteManifest.hello.appVersion,
    deviceName: remoteManifest.hello.deviceName,
  };

  const warnings: string[] = [];
  if (remoteManifest.hello.protocolVersion !== SYNC_PROTOCOL_VERSION) {
    if (!options.confirmVersionMismatch) {
      return {
        ...base,
        status: 'blocked',
        ok: false,
        warnings: [`对端协议版本 (${remoteManifest.hello.protocolVersion}) 与本端 (${SYNC_PROTOCOL_VERSION}) 不一致，同步可能损坏数据，需确认后继续`],
        confirmRequired: 'protocol-version-mismatch',
        remoteHello,
        durationMs: Date.now() - startedAt,
        finishedAt: Date.now(),
      };
    }
    warnings.push(`对端协议版本 (${remoteManifest.hello.protocolVersion}) 与本端 (${SYNC_PROTOCOL_VERSION}) 不一致，已按用户确认继续`);
  } else if (remoteManifest.hello.appVersion !== selfHello.appVersion) {
    warnings.push(`对端应用版本 (${remoteManifest.hello.appVersion}) 与本端 (${selfHello.appVersion}) 不同`);
  }

  // 对端清单条目合并 candidateHashes（仅同路径 size/mtime 异的候选有 hash）供 diff 判定
  const candidateHashes = new Map(remoteManifest.candidateHashes.map((c) => [c.relPath, c.hash]));
  const remoteEntries: FileEntry[] = remoteManifest.entries.map((e) => {
    const hash = candidateHashes.get(e.relPath);
    return hash ? { ...e, hash } : e;
  });

  const state = await readSyncState();
  const baseline = state.peers[peer.deviceId]?.lastManifest;
  const diff = await diffManifests({ root: dataDir, local, remote: remoteEntries, baseline });

  const selfShort = shortDeviceId(selfHello.deviceId);
  const peerShort = shortDeviceId(peer.deviceId);
  const direction: SyncDirection = options.direction ?? 'pull';
  const resolutions = options.conflictResolutions ?? {};
  const skipped: SkippedEntry[] = [...diff.skipped];
  const conflicts: string[] = [];
  const autoResolved: Array<{ relPath: string; winner: 'local' | 'remote' }> = [];
  // relPath -> 传输时刻权威内容 hash（undefined = 传输过但本端无 hash 可记，baseline 构建时重算）
  const transferred = new Map<string, string | undefined>();
  const pullItems: IncomingApplyItem[] = diff.pull.map((entry) => ({ entry }));
  const pushEntries: FileEntry[] = [...diff.push];
  let pulled = 0;
  let pushed = 0;

  for (const conflict of diff.conflict) {
    const relPath = conflict.local.relPath;
    if (direction === 'pull') {
      // 仅拉取档：按 mtime 新者自动裁决，不挂起不推对端；败方留 .conflict-<胜方短ID> 副本兑底可换回。
      // 即使“哪边新”判错，本端较新内容也不会被对端旧版顶掉（本端新→不动）
      if (conflict.remote.mtimeMs > conflict.local.mtimeMs) {
        pullItems.push({
          entry: conflict.remote,
          saveConflictCopyBeforeOverwrite: true,
          conflictWinnerShortId: peerShort,
        });
        autoResolved.push({ relPath, winner: 'remote' });
      } else {
        autoResolved.push({ relPath, winner: 'local' });
      }
      continue;
    }
    const resolution = resolutions[relPath];
    if (resolution === undefined) {
      // 无裁决 → 本轮挂起：两端都不动，等用户在结果面板选择后带 conflictResolutions 重跑
      skipped.push({ relPath, reason: '冲突待处理，本轮跳过' });
      conflicts.push(relPath);
      continue;
    }
    if (resolution === 'remote') {
      if (direction === 'push') {
        // 仅推送档不改动本端：对端胜 = 双方都不动
        skipped.push({ relPath, reason: '仅推送档不改动本端，对端胜冲突本轮跳过' });
        continue;
      }
      pullItems.push({
        entry: conflict.remote,
        saveConflictCopyBeforeOverwrite: true,
        conflictWinnerShortId: peerShort,
      });
      continue;
    }
    // resolution === 'local'（本端胜）：对端旧内容先推成对端侧副本，副本成功才推本端内容覆盖，绝不静默丢旧数据
    const copyRelPath = conflictCopyRelPath(conflict.remote.relPath, selfShort);
    try {
      const stream = await pullFile(peer, auth, conflict.remote.relPath);
      const tmpPath = await saveStreamToTempFile(stream);
      try {
        await pushFile(
          peer,
          auth,
          { relPath: copyRelPath, size: conflict.remote.size, mtimeMs: conflict.remote.mtimeMs },
          createReadStream(tmpPath),
        );
      } finally {
        await fsp.unlink(tmpPath).catch(() => {});
      }
      pushEntries.push(conflict.local);
    } catch (error) {
      skipped.push({ relPath, reason: `冲突副本写入对端失败，本轮跳过: ${errMessage(error)}` });
    }
  }

  if (direction !== 'push') {
    const pullReport = await applyIncoming(dataDir, pullItems, (relPath) => pullFile(peer, auth, relPath));
    for (const entry of pullReport.applied) {
      pulled += 1;
      transferred.set(entry.relPath, entry.hash);
    }
    skipped.push(...pullReport.skipped);

    if (pullReport.settingsMerged) {
      const settingsAbs = resolveWithinDataDir(dataDir, 'settings.json');
      if (settingsAbs) {
        // 落盘的是字段级合并版而非对端原样，baseline 必须记合并后真实内容的 hash
        transferred.set('settings.json', await sha256File(settingsAbs).catch(() => undefined));
      }
    }
  }

  if (direction !== 'pull') {
    const pushReport = await pushOutgoing(dataDir, pushEntries, (meta, source) => pushFile(peer, auth, meta, source));
    for (const entry of pushReport.pushed) {
      pushed += 1;
      transferred.set(entry.relPath, entry.hash);
    }
    skipped.push(...pushReport.skipped);
  }

  const nextBaseline = await buildNextBaseline(dataDir, manifestOptions, baseline, transferred);
  const nextState = await readSyncState();
  nextState.peers[peer.deviceId] = {
    deviceId: peer.deviceId,
    deviceName: remoteHello.deviceName ?? peer.deviceName,
    appVersion: remoteHello.appVersion,
    lastSyncAt: Date.now(),
    lastManifestHash: createHash('sha256').update(JSON.stringify(nextBaseline)).digest('hex'),
    lastManifest: nextBaseline,
  };
  await writeSyncState(nextState);

  return {
    ...base,
    status: 'completed',
    ok: true,
    pulled,
    pushed,
    conflicts,
    autoResolved,
    skipped,
    warnings,
    remoteHello,
    durationMs: Date.now() - startedAt,
    finishedAt: Date.now(),
  };
}

/**
 * 同步收敛后的本端清单快照（下轮 diff 的基线）：
 * 传输过的文件用传输时刻 hash（对端权威/本端推送内容）；未传输且 size+mtime 与上轮基线一致的继承旧 hash；
 * 其余（新建/外部改动/上轮无 hash）重算。读失败取不到 hash 的条目丢弃——下轮该文件成候选时按无基线保守判冲突。
 */
async function buildNextBaseline(
  root: string,
  options: ManifestOptions,
  prevBaseline: FileEntry[] | undefined,
  transferred: Map<string, string | undefined>,
): Promise<FileEntry[]> {
  const entries = await buildManifest(root, options);
  const prevMap = new Map((prevBaseline ?? []).map((e) => [e.relPath, e]));
  const needHash: FileEntry[] = [];
  for (const entry of entries) {
    if (typeof transferred.get(entry.relPath) === 'string') continue;
    const prev = prevMap.get(entry.relPath);
    if (typeof prev?.hash === 'string' && prev.size === entry.size && prev.mtimeMs === entry.mtimeMs) continue;
    needHash.push(entry);
  }
  const freshHashes = new Map((await hashEntries(root, needHash)).map((e) => [e.relPath, e.hash]));
  const result: FileEntry[] = [];
  for (const entry of entries) {
    const hash = transferred.get(entry.relPath) ?? freshHashes.get(entry.relPath) ?? prevMap.get(entry.relPath)?.hash;
    if (typeof hash === 'string') result.push({ ...entry, hash });
  }
  return result;
}
