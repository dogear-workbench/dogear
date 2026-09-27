import fsp from 'node:fs/promises';
import { createWriteStream, createReadStream } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import { createGunzip } from 'node:zlib';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type { FileEntry, FilePushMeta, SkippedEntry } from './protocol.js';
import { loadSettings, saveSettings, type AppSettings, type PairedDevice, type SyncOptions } from '../settings-service.js';
import { getOrCreateDeviceId } from './device.js';

const INCOMING_SUFFIX = '.dogear-incoming';

export function resolveWithinDataDir(dataDir: string, relPath: string): string | null {
  if (relPath.includes('\\') || relPath.startsWith('/')) return null;
  if (!relPath.split('/').every((seg) => seg !== '' && seg !== '.' && seg !== '..')) return null;
  const abs = path.resolve(dataDir, relPath);
  const base = path.resolve(dataDir);
  return abs.startsWith(base + path.sep) ? abs : null;
}

export interface IncomingWriteResult {
  ok: true;
  absPath: string;
  bytesWritten: number;
}

export interface IncomingWriteError {
  ok: false;
  reason: string;
}

export async function writeIncomingFile(
  dataDir: string,
  meta: FilePushMeta,
  source: Readable,
): Promise<IncomingWriteResult | IncomingWriteError> {
  const absPath = resolveWithinDataDir(dataDir, meta.relPath);
  if (!absPath) return { ok: false, reason: 'unsafe path' };
  const tmpPath = `${absPath}.${Date.now().toString(36)}${INCOMING_SUFFIX}`;
  try {
    await fsp.mkdir(path.dirname(absPath), { recursive: true });
    await pipeline(source, createGunzip(), createWriteStream(tmpPath));
    const st = await fsp.stat(tmpPath);
    await fsp.utimes(tmpPath, new Date(meta.mtimeMs), new Date(meta.mtimeMs));
    await fsp.rename(tmpPath, absPath);
    return { ok: true, absPath, bytesWritten: st.size };
  } catch (error) {
    await fsp.unlink(tmpPath).catch(() => {});
    return { ok: false, reason: error instanceof Error ? error.message : String(error) };
  }
}

function toMeta(entry: FileEntry): FilePushMeta {
  return { relPath: entry.relPath, size: entry.size, mtimeMs: entry.mtimeMs };
}

export function shortDeviceId(deviceId: string): string {
  return deviceId.replace(/-/g, '').slice(0, 6);
}

/** 冲突副本同目录同名：`<name>.<ext>.conflict-<胜方设备短ID>`；dotfile 整体作 stem */
export function conflictCopyRelPath(relPath: string, winnerShortId: string): string {
  const slash = relPath.lastIndexOf('/');
  const dir = slash >= 0 ? relPath.slice(0, slash + 1) : '';
  const base = slash >= 0 ? relPath.slice(slash + 1) : relPath;
  const dot = base.lastIndexOf('.');
  const stem = dot > 0 ? base.slice(0, dot) : base;
  const ext = dot > 0 ? base.slice(dot) : '';
  return `${dir}${stem}${ext}.conflict-${winnerShortId}`;
}

async function saveLocalConflictCopy(root: string, relPath: string, winnerShortId: string): Promise<void> {
  const abs = resolveWithinDataDir(root, relPath);
  if (!abs) throw new Error('unsafe path');
  const copyAbs = resolveWithinDataDir(root, conflictCopyRelPath(relPath, winnerShortId));
  if (!copyAbs) throw new Error('unsafe conflict copy path');
  await fsp.mkdir(path.dirname(copyAbs), { recursive: true });
  await fsp.copyFile(abs, copyAbs);
}

async function readGzipText(source: Readable): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    source.on('error', reject);
    source
      .pipe(createGunzip())
      .on('data', (chunk: Buffer) => chunks.push(chunk))
      .on('end', () => resolve(Buffer.concat(chunks).toString('utf-8')))
      .on('error', reject);
  });
}

function mergePairedDevices(local: PairedDevice[], incoming: unknown): PairedDevice[] {
  const byId = new Map(local.map((d) => [d.deviceId, d]));
  const remote = Array.isArray(incoming) ? (incoming as unknown[]) : [];
  for (const item of remote) {
    if (!item || typeof item !== 'object') continue;
    const d = item as Partial<PairedDevice>;
    if (typeof d.deviceId !== 'string' || d.deviceId === '') continue;
    if (typeof d.secret !== 'string' || d.secret === '') continue;
    if (byId.has(d.deviceId)) continue;
    byId.set(d.deviceId, {
      deviceId: d.deviceId,
      ...(typeof d.deviceName === 'string' && d.deviceName !== '' ? { deviceName: d.deviceName } : {}),
      secret: d.secret,
      pairedAt: typeof d.pairedAt === 'number' && Number.isFinite(d.pairedAt) ? d.pairedAt : Date.now(),
    });
  }
  return [...byId.values()];
}

/** settings.json 不整文件覆盖：pairedDevices 并集（secret 冲突取本端、剔除自身条目）、deviceName 保本端，其余按对端内容覆盖 */
export async function mergeIncomingSettings(source: Readable): Promise<void> {
  const raw = await readGzipText(source);
  const incoming = JSON.parse(raw) as Record<string, unknown>;
  const local = await loadSettings();
  const merged = { ...incoming } as unknown as AppSettings;
  const localSync = local.syncOptions ?? { deviceName: '', syncStocksData: false, syncFeishu: false, pairedDevices: [] as PairedDevice[] };
  const incomingSync = (incoming.syncOptions && typeof incoming.syncOptions === 'object' && !Array.isArray(incoming.syncOptions)
    ? incoming.syncOptions
    : {}) as Partial<SyncOptions>;
  const selfDeviceId = await getOrCreateDeviceId();
  merged.syncOptions = {
    deviceName: localSync.deviceName,
    syncStocksData: incomingSync.syncStocksData === true,
    syncFeishu: incomingSync.syncFeishu === true,
    pairedDevices: mergePairedDevices(localSync.pairedDevices, incomingSync.pairedDevices)
      .filter((d) => d.deviceId !== selfDeviceId),
  };
  await saveSettings(merged);
}

export interface IncomingApplyItem {
  entry: FileEntry;
  /** 双改冲突且对端胜时为 true：先以本端当前内容落 conflict-<对端短ID> 副本，副本成功才允许覆盖本端文件 */
  saveConflictCopyBeforeOverwrite?: boolean;
  conflictWinnerShortId?: string;
}

export type IncomingSourceFactory = (relPath: string) => Promise<Readable>;
export interface IncomingApplyReport {
  applied: FileEntry[];
  skipped: SkippedEntry[];
  settingsMerged: boolean;
}

export async function applyIncoming(
  root: string,
  items: IncomingApplyItem[],
  sourceFactory: IncomingSourceFactory,
): Promise<IncomingApplyReport> {
  const report: IncomingApplyReport = { applied: [], skipped: [], settingsMerged: false };
  for (const item of items) {
    const { entry } = item;
    try {
      if (item.saveConflictCopyBeforeOverwrite) {
        await saveLocalConflictCopy(root, entry.relPath, item.conflictWinnerShortId ?? 'unknown');
      }
      const source = await sourceFactory(entry.relPath);
      if (entry.relPath === 'settings.json') {
        await mergeIncomingSettings(source);
        report.settingsMerged = true;
      } else {
        const result = await writeIncomingFile(root, toMeta(entry), source);
        if (!result.ok) {
          report.skipped.push({ relPath: entry.relPath, reason: result.reason });
          continue;
        }
      }
      report.applied.push(entry);
    } catch (error) {
      report.skipped.push({
        relPath: entry.relPath,
        reason: error instanceof Error ? error.message : String(error),
      });
    }
  }
  return report;
}

export type OutgoingPushFn = (meta: FilePushMeta, source: Readable) => Promise<void>;

export interface OutgoingApplyReport {
  pushed: FileEntry[];
  skipped: SkippedEntry[];
}

export async function pushOutgoing(
  root: string,
  entries: FileEntry[],
  pushFn: OutgoingPushFn,
): Promise<OutgoingApplyReport> {
  const report: OutgoingApplyReport = { pushed: [], skipped: [] };
  for (const entry of entries) {
    const abs = resolveWithinDataDir(root, entry.relPath);
    if (!abs) {
      report.skipped.push({ relPath: entry.relPath, reason: 'unsafe path' });
      continue;
    }
    try {
      await pushFn(toMeta(entry), createReadStream(abs));
      report.pushed.push(entry);
    } catch (error) {
      report.skipped.push({
        relPath: entry.relPath,
        reason: error instanceof Error ? error.message : String(error),
      });
    }
  }
  return report;
}

/** 把对端拉来的 gzip 流先落本端临时文件（推对端冲突副本的中转），调用方负责删除 */
export async function saveStreamToTempFile(source: Readable): Promise<string> {
  const tmpPath = path.join(tmpdir(), `dogear-conflict-${randomUUID()}`);
  await pipeline(source, createGunzip(), createWriteStream(tmpPath));
  return tmpPath;
}
