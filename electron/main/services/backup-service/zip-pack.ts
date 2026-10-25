import fs from 'fs/promises';
import path from 'path';
import { dirname, join } from 'path';
import { Worker } from 'worker_threads';
import { fileURLToPath } from 'url';
import { getConfigDir } from '../settings-service.js';
import { toArchiveRelPath } from '../data-registry.js';
import { assertScope, type BackupScope } from './categories.js';
import { packEntriesSharded, type PackEntry } from './zip-pack-core.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

const STAMP_RE = /-(\d{8})-(\d{6})\.zip$/;

export interface BackupFileInfo {
  fileName: string;
  stamp: Date;
  size: number;
}

/** 本地时间戳 YYYYMMDD-HHmmss，定宽字符串字典序即时间序 */
export function formatStamp(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

export function parseStamp(fileName: string): Date | null {
  const m = STAMP_RE.exec(fileName);
  if (!m) return null;
  const date = m[1] ?? '';
  const time = m[2] ?? '';
  const d = new Date(
    Number(date.slice(0, 4)),
    Number(date.slice(4, 6)) - 1,
    Number(date.slice(6, 8)),
    Number(time.slice(0, 2)),
    Number(time.slice(2, 4)),
    Number(time.slice(4, 6)),
  );
  return Number.isNaN(d.getTime()) ? null : d;
}

export function backupFileName(key: string, d: Date = new Date()): string {
  return `${key}-${formatStamp(d)}.zip`;
}

export function isBackupFileName(key: string, fileName: string): boolean {
  return fileName.startsWith(`${key}-`) && parseStamp(fileName) !== null;
}

export function backupsRootDir(): string {
  return path.join(getConfigDir(), 'backups');
}

export function backupDirPath(scope: BackupScope): string {
  assertScope(scope);
  return path.join(backupsRootDir(), scope);
}

export function backupZipPath(scope: BackupScope, fileName: string): string {
  if (fileName.includes('/') || fileName.includes('\\') || fileName.includes('..')) {
    throw new Error(`非法备份文件名: ${fileName}`);
  }
  return path.join(backupDirPath(scope), fileName);
}

/** 源清单 → 打包任务条目：zip 内条目路径 = 相对 configDir 的 posix 路径；不存在的源跳过 */
export async function resolveSourceEntries(sources: string[]): Promise<PackEntry[]> {
  const entries: PackEntry[] = [];
  for (const src of sources) {
    const st = await fs.stat(src).catch(() => null);
    if (!st) continue;
    entries.push({ entryPath: toArchiveRelPath(src), readPath: src, isDir: st.isDirectory() });
  }
  return entries;
}

const PACK_WORKER_TIMEOUT_MS = 60_000;

function packInWorker(entries: PackEntry[], outZipPath: string): Promise<number> {
  return new Promise<number>((resolve, reject) => {
    let worker: Worker;
    try {
      worker = new Worker(join(__dirname, 'zip-pack-worker.js'));
    } catch (err) {
      reject(err instanceof Error ? err : new Error(String(err)));
      return;
    }
    const finish = (settle: () => void) => {
      clearTimeout(timer);
      worker.removeAllListeners();
      void worker.terminate();
      settle();
    };
    const timer = setTimeout(
      () => finish(() => reject(new Error(`打包 worker 超时（${PACK_WORKER_TIMEOUT_MS / 1000}s）`))),
      PACK_WORKER_TIMEOUT_MS,
    );
    worker.once('error', (err) => finish(() => reject(err)));
    worker.once('message', (msg: { ok: boolean; count?: number; error?: string }) => {
      finish(() => {
        if (msg?.ok) resolve(msg.count ?? 0);
        else reject(new Error(msg?.error ?? '打包 worker 返回未知错误'));
      });
    });
    worker.postMessage({ entries, outZipPath });
  });
}

/** 打包：源清单先在主进程反解+stat，CPU 密集的压缩写盘移 worker 线程；
 * worker 创建失败/出错/超时回退主进程分片打包（保底可用）。
 * 返回打包条目数，0 = 无有效内容（未写盘） */
export async function packSources(sources: string[], outZipPath: string): Promise<number> {
  const entries = await resolveSourceEntries(sources);
  if (entries.length === 0) return 0;
  try {
    return await packInWorker(entries, outZipPath);
  } catch (err) {
    console.warn(`[backup] worker 打包不可用，回退主进程分片: ${err instanceof Error ? err.message : String(err)}`);
    return packEntriesSharded(entries, outZipPath);
  }
}

/** 列出某分类×scope 的全部备份（按文件名时间戳升序）；目录不存在返回空 */
export async function listBackupFiles(scope: BackupScope, key: string): Promise<BackupFileInfo[]> {
  const dir = backupDirPath(scope);
  let names: string[];
  try {
    names = await fs.readdir(dir);
  } catch {
    return [];
  }
  const out: BackupFileInfo[] = [];
  for (const name of names) {
    if (!isBackupFileName(key, name)) continue;
    const stamp = parseStamp(name);
    if (!stamp) continue;
    const st = await fs.stat(path.join(dir, name)).catch(() => null);
    if (!st?.isFile()) continue;
    out.push({ fileName: name, stamp, size: st.size });
  }
  out.sort((a, b) => (a.fileName < b.fileName ? -1 : 1));
  return out;
}

/** 轮换清理：只保留最新 keepCount 份，返回被删除的文件名 */
export async function pruneOld(scope: BackupScope, key: string, keepCount: number): Promise<string[]> {
  const files = await listBackupFiles(scope, key);
  const excess = files.slice(0, Math.max(0, files.length - keepCount));
  const deleted: string[] = [];
  for (const f of excess) {
    try {
      await fs.unlink(path.join(backupDirPath(scope), f.fileName));
      deleted.push(f.fileName);
    } catch {
      // 单个删除失败不阻断轮换，下轮重试
    }
  }
  return deleted;
}
