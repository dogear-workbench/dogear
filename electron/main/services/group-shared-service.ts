import fs from 'fs/promises';
import path from 'path';
import electron from 'electron';
import * as workspaceJsonService from './workspace-json-service.js';
import * as groupService from './group-service.js';
import { readWorkspaceTextFile } from './workspace-fs-service.js';
import type { NativeFileEntry, SharedReference } from '../types.js';

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

export async function listNativeFiles(workspaceId: string, groupId: string): Promise<NativeFileEntry[]> {
  const sharedDir = await getSharedDir(workspaceId, groupId);
  const result: NativeFileEntry[] = [];
  await walk(sharedDir, sharedDir, result);
  return result;
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

export async function listReferences(workspaceId: string, groupId: string): Promise<SharedReference[]> {
  const group = await groupService.getGroup(workspaceId, groupId);
  if (!group) throw new Error(`Group not found: ${groupId}`);
  return group.sharedReferences;
}

export async function readReferencedFile(workspaceId: string, groupId: string, refId: string): Promise<string> {
  const refs = await listReferences(workspaceId, groupId);
  const ref = refs.find((r) => r.id === refId);
  if (!ref) throw new Error(`Reference not found: ${refId}`);
  if (ref.type !== 'file') throw new Error(`Unsupported reference type: ${ref.type}`);
  const workspace = await workspaceJsonService.getById(workspaceId);
  if (!workspace?.path) throw new Error(`Workspace path missing: ${workspaceId}`);
  return readWorkspaceTextFile(workspace.path, ref.path);
}

export function validateWorkspacePath(workspacePath: string, inputPath: string): string {
  const abs = path.isAbsolute(inputPath) ? inputPath : path.resolve(workspacePath, inputPath);
  const normalized = path.normalize(abs);
  const baseNormalized = path.normalize(workspacePath);
  if (!normalized.startsWith(baseNormalized + path.sep) && normalized !== baseNormalized) {
    throw new Error('路径越权：引用文件必须在工作区内');
  }
  return path.relative(baseNormalized, normalized).replace(/\\/g, '/');
}
