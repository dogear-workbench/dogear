import fs from 'fs/promises';
import path from 'path';
import electron from 'electron';
import { broadcastGroupDataChanged } from './renderer-broadcast-lazy.js';
import type { NativeFileEntry } from '../types.js';

export const NOTES_DIR_NAME = '_notes';

const { app } = electron;

function getConfigDir(): string {
  if (process.env.DOGEAR_CONFIG_DIR) return process.env.DOGEAR_CONFIG_DIR;
  if (app?.isPackaged) return path.join(app.getPath('userData'), '.dogear');
  return path.join(process.cwd(), '.dogear');
}

export async function getSharedDir(workspaceId: string, groupId: string): Promise<string> {
  const dir = path.join(getConfigDir(), 'workspaces', workspaceId, 'groups', groupId, 'shared');
  await fs.mkdir(dir, { recursive: true });
  return dir;
}

function safeResolve(sharedDir: string, relPath: string): string {
  const resolved = path.normalize(path.resolve(sharedDir, relPath));
  const normalizedBase = path.normalize(sharedDir);
  if (!resolved.startsWith(normalizedBase + path.sep) && resolved !== normalizedBase) {
    throw new Error('路径越权：不允许访问共享区外的路径');
  }
  return resolved;
}

export function ensureDatedRelPath(relPath: string, date = new Date()): string {
  const normalized = relPath.replace(/\\/g, '/');
  const lastSlash = normalized.lastIndexOf('/');
  const name = lastSlash >= 0 ? normalized.slice(lastSlash + 1) : normalized;
  if (/^\d{8}-/.test(name)) return normalized;
  const yyyymmdd = `${date.getFullYear()}${String(date.getMonth() + 1).padStart(2, '0')}${String(date.getDate()).padStart(2, '0')}`;
  const dir = lastSlash >= 0 ? normalized.slice(0, lastSlash + 1) : '';
  return `${dir}${yyyymmdd}-${name}`;
}

export async function listNativeFiles(workspaceId: string, groupId: string): Promise<{ files: NativeFileEntry[]; sharedDir: string }> {
  const sharedDir = await getSharedDir(workspaceId, groupId);
  const files: NativeFileEntry[] = [];
  await walk(sharedDir, sharedDir, files);
  return { files, sharedDir };
}

async function walk(dir: string, base: string, out: NativeFileEntry[]): Promise<void> {
  let entries: import('fs').Dirent[];
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (entry.name.startsWith('.')) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      await walk(full, base, out);
    } else if (entry.isFile()) {
      const stat = await fs.stat(full);
      out.push({
        relPath: path.relative(base, full).replace(/\\/g, '/'),
        size: stat.size,
        mtime: stat.mtimeMs,
      });
    }
  }
}

/** 只返回 _notes/ 子目录下的文件 */
export async function listNotesFiles(workspaceId: string, groupId: string): Promise<NativeFileEntry[]> {
  const { files } = await listNativeFiles(workspaceId, groupId);
  return files.filter((f) => f.relPath.startsWith(NOTES_DIR_NAME + '/'));
}

export async function readNativeFile(workspaceId: string, groupId: string, relPath: string): Promise<string> {
  const sharedDir = await getSharedDir(workspaceId, groupId);
  const abs = safeResolve(sharedDir, relPath);
  return fs.readFile(abs, 'utf-8');
}

export async function writeNativeFile(workspaceId: string, groupId: string, relPath: string, content: string): Promise<void> {
  const sharedDir = await getSharedDir(workspaceId, groupId);
  const abs = safeResolve(sharedDir, relPath);
  await fs.mkdir(path.dirname(abs), { recursive: true });
  await fs.writeFile(abs, content, 'utf-8');
  broadcastGroupDataChanged(workspaceId, groupId);
}

export async function deleteNativeFile(workspaceId: string, groupId: string, relPath: string): Promise<void> {
  const sharedDir = await getSharedDir(workspaceId, groupId);
  const abs = safeResolve(sharedDir, relPath);
  await fs.rm(abs, { force: true });
  broadcastGroupDataChanged(workspaceId, groupId);
}

// ─── 子会话 outputPath 占用表（进程级内存，重启清空）───

const pathClaims = new Map<string, string>();  // key = `${workspaceId}:${groupId}:${relPath}`, value = childId

function claimKey(workspaceId: string, groupId: string, relPath: string): string {
  return `${workspaceId}:${groupId}:${relPath}`;
}

export type ClaimResult =
  | { ok: true }
  | { ok: false; reason: 'file_exists' | 'claimed_by_other'; holderChildId?: string };

export async function claimOutputPath(
  workspaceId: string,
  groupId: string,
  relPath: string,
  childId: string,
): Promise<ClaimResult> {
  const sharedDir = await getSharedDir(workspaceId, groupId);
  const abs = safeResolve(sharedDir, relPath);
  try {
    await fs.access(abs);
    return { ok: false, reason: 'file_exists' };
  } catch {
    // 文件不存在，继续
  }
  const key = claimKey(workspaceId, groupId, relPath);
  const holder = pathClaims.get(key);
  if (holder && holder !== childId) {
    return { ok: false, reason: 'claimed_by_other', holderChildId: holder };
  }
  pathClaims.set(key, childId);
  return { ok: true };
}

export function releaseOutputPath(
  workspaceId: string,
  groupId: string,
  relPath: string,
  childId: string,
): void {
  const key = claimKey(workspaceId, groupId, relPath);
  const holder = pathClaims.get(key);
  if (holder === childId) pathClaims.delete(key);
}

export function releaseAllByChild(childId: string): void {
  for (const [key, holder] of pathClaims.entries()) {
    if (holder === childId) pathClaims.delete(key);
  }
}

export function isClaimed(workspaceId: string, groupId: string, relPath: string): boolean {
  return pathClaims.has(claimKey(workspaceId, groupId, relPath));
}

export interface PreviewClaimConflict {
  relPath: string;
  reason: 'file_exists' | 'claimed_by_other';
  holderChildId?: string;
}

/**
 * 纯检查一批 outputPath 是否可被 claim，不修改 pathClaims。
 * 返回所有冲突项，方便 dogear__CreateSessionBatch 一次性向 agent 报告。
 */
export async function previewClaim(
  workspaceId: string,
  groupId: string,
  relPaths: string[],
): Promise<{ ok: true } | { ok: false; conflicts: PreviewClaimConflict[] }> {
  const sharedDir = await getSharedDir(workspaceId, groupId);
  const conflicts: PreviewClaimConflict[] = [];
  const seenInBatch = new Map<string, number>();

  for (let i = 0; i < relPaths.length; i++) {
    const relPath = relPaths[i];

    const firstSeenIdx = seenInBatch.get(relPath);
    if (firstSeenIdx !== undefined) {
      conflicts.push({ relPath, reason: 'claimed_by_other', holderChildId: `batch[${firstSeenIdx}]` });
      continue;
    }
    seenInBatch.set(relPath, i);

    let abs: string;
    try {
      abs = safeResolve(sharedDir, relPath);
    } catch {
      conflicts.push({ relPath, reason: 'file_exists' });
      continue;
    }
    try {
      await fs.access(abs);
      conflicts.push({ relPath, reason: 'file_exists' });
      continue;
    } catch {
      // 文件不存在
    }
    const holder = pathClaims.get(claimKey(workspaceId, groupId, relPath));
    if (holder) {
      conflicts.push({ relPath, reason: 'claimed_by_other', holderChildId: holder });
    }
  }

  return conflicts.length === 0 ? { ok: true } : { ok: false, conflicts };
}
