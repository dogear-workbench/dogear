import fs from 'fs/promises';
import path from 'path';
import electron from 'electron';
import type { NativeFileEntry } from '../types.js';

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
}

export async function deleteNativeFile(workspaceId: string, groupId: string, relPath: string): Promise<void> {
  const sharedDir = await getSharedDir(workspaceId, groupId);
  const abs = safeResolve(sharedDir, relPath);
  await fs.rm(abs, { force: true });
}
