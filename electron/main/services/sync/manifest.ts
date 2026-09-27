import path from 'node:path';
import fsp from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import type { DiffResult, FileEntry, HashedFileEntry, SkippedEntry } from './protocol.js';

export interface ManifestOptions {
  syncStocksData?: boolean;
  syncFeishu?: boolean;
  /**
   * workspaces/ 下只收这些本端 wsid 目录（映射表中 enabled=true 者，per-peer）。
   * undefined = 不过滤（全量，向后兼容）；空数组 = 全部工作区目录不同步（首次使用即受控，全局数据恒同步）。
   */
  enabledWorkspaceIds?: string[];
}

const ALWAYS_SYNC_DIRS = ['workspaces', 'conversations', 'memory', 'usage', 'article-parser', 'site-knowledge', 'run-history'] as const;
const ALWAYS_SYNC_FILES = ['settings.json', 'plans.json', 'notifications.json'] as const;
const OPTIONAL_DIR_FLAGS: Record<string, keyof ManifestOptions> = {
  stocks: 'syncStocksData',
  feishu: 'syncFeishu',
};

const IGNORE_FILE_SUFFIXES = ['.bak', '.lock', '.tmp'];
const IGNORE_DIR_NAMES = new Set(['__pycache__', 'browser-profile', 'logs', 'backups']);
const IGNORE_BASENAMES = new Set(['sync-state.json']);

export async function buildManifest(root: string, options: ManifestOptions = {}): Promise<FileEntry[]> {
  const entries: FileEntry[] = [];
  const jobs: Promise<void>[] = [];
  for (const dir of ALWAYS_SYNC_DIRS) {
    if (dir === 'workspaces' && options.enabledWorkspaceIds) {
      // workspaces/ 特殊处理：一级子目录按 per-peer 映射表过滤（workspaces/<wsid>/）。
      // workspaces/ 下直接落文件（workspaces.json、其冲突副本等）不受过滤，属全局数据恒同步
      jobs.push(walkWorkspacesDir(root, new Set(options.enabledWorkspaceIds), entries));
    } else {
      jobs.push(walkDir(root, dir, entries));
    }
  }
  for (const name of ALWAYS_SYNC_FILES) {
    jobs.push(statFile(root, name, entries));
  }
  for (const [dir, flag] of Object.entries(OPTIONAL_DIR_FLAGS)) {
    if (!options[flag]) continue;
    jobs.push(walkDir(root, dir, entries));
  }
  await Promise.all(jobs);
  entries.sort((a, b) => (a.relPath < b.relPath ? -1 : a.relPath > b.relPath ? 1 : 0));
  return entries;
}

/** walkDir 的 workspaces/ 特化版：一级目录按映射表 wsid 过滤，文件与已启用 wsid 子树照常收 */
async function walkWorkspacesDir(root: string, enabledIds: Set<string>, out: FileEntry[]): Promise<void> {
  let dirents;
  try {
    dirents = await fsp.readdir(path.join(root, 'workspaces'), { withFileTypes: true });
  } catch {
    return;
  }
  await Promise.all(dirents.map(async (dirent) => {
    if (dirent.isDirectory()) {
      if (IGNORE_DIR_NAMES.has(dirent.name.toLowerCase())) return;
      if (!enabledIds.has(dirent.name)) return;
      await walkDir(root, `workspaces/${dirent.name}`, out);
      return;
    }
    if (!dirent.isFile() || dirent.isSymbolicLink()) return;
    await statFile(root, `workspaces/${dirent.name}`, out);
  }));
}

async function walkDir(root: string, relDir: string, out: FileEntry[]): Promise<void> {
  let dirents;
  try {
    dirents = await fsp.readdir(path.join(root, relDir), { withFileTypes: true });
  } catch {
    return;
  }
  await Promise.all(dirents.map(async (dirent) => {
    const name = dirent.name;
    if (dirent.isDirectory()) {
      if (IGNORE_DIR_NAMES.has(name.toLowerCase())) return;
      await walkDir(root, `${relDir}/${name}`, out);
      return;
    }
    if (!dirent.isFile() || dirent.isSymbolicLink()) return;
    await statFile(root, `${relDir}/${name}`, out);
  }));
}

async function statFile(root: string, relPath: string, out: FileEntry[]): Promise<void> {
  const lower = relPath.toLowerCase();
  const base = lower.slice(lower.lastIndexOf('/') + 1);
  if (IGNORE_BASENAMES.has(base)) return;
  if (IGNORE_FILE_SUFFIXES.some((suffix) => base.endsWith(suffix))) return;
  try {
    const st = await fsp.stat(path.join(root, relPath));
    if (!st.isFile()) return;
    out.push({ relPath, size: st.size, mtimeMs: st.mtimeMs });
  } catch {
    // 竞态：清单构建中文件被删除/占用，跳过即视为本轮不存在
  }
}

export async function hashEntries(root: string, entries: FileEntry[]): Promise<HashedFileEntry[]> {
  const out: HashedFileEntry[] = [];
  for (const entry of entries) {
    try {
      const hash = await sha256File(path.join(root, entry.relPath));
      out.push({ ...entry, hash });
    } catch {
      // 读失败（占用/消失）让调用方在 diff 的 skipped 里看到
    }
  }
  return out;
}

export async function sha256File(absPath: string): Promise<string> {
  const hash = createHash('sha256');
  const stream = createReadStream(absPath);
  for await (const chunk of stream) {
    hash.update(chunk);
  }
  return hash.digest('hex');
}

// 对端清单是不可信输入：拒绝绝对路径/反斜杠/.. 穿越段，防 apply 层写入逃逸
function isSafeRelPath(relPath: string): boolean {
  if (relPath.includes('\\') || relPath.startsWith('/')) return false;
  return relPath.split('/').every((seg) => seg !== '' && seg !== '.' && seg !== '..');
}

function toMap(entries: FileEntry[]): Map<string, FileEntry> {
  const map = new Map<string, FileEntry>();
  for (const e of entries) map.set(e.relPath, e);
  return map;
}

export interface DiffInput {
  root: string;
  local: FileEntry[];
  remote: FileEntry[];
  baseline?: FileEntry[];
}

export async function diffManifests(input: DiffInput): Promise<DiffResult> {
  const { root, local, remote } = input;
  const baseline = input.baseline ? toMap(input.baseline) : null;
  const localMap = toMap(local);
  const remoteMap = toMap(remote);

  const result: DiffResult = { pull: [], push: [], conflict: [], skipped: [], same: 0 };
  const candidates: { local: FileEntry; remote: FileEntry }[] = [];

  for (const [relPath, remoteEntry] of remoteMap) {
    if (!isSafeRelPath(relPath)) {
      result.skipped.push({ relPath, reason: 'unsafe path' });
      continue;
    }
    const localEntry = localMap.get(relPath);
    if (!localEntry) {
      result.pull.push(remoteEntry);
      continue;
    }
    if (localEntry.size === remoteEntry.size && localEntry.mtimeMs === remoteEntry.mtimeMs) {
      result.same += 1;
      continue;
    }
    candidates.push({ local: localEntry, remote: remoteEntry });
  }

  const localHashes = new Map((await hashEntries(root, candidates.map((c) => c.local))).map((e) => [e.relPath, e.hash]));

  for (const { local: localEntry, remote: remoteEntry } of candidates) {
    const localHash = localHashes.get(remoteEntry.relPath);
    if (localHash === undefined) {
      result.skipped.push({ relPath: remoteEntry.relPath, reason: 'local file unreadable' });
      continue;
    }
    const remoteHash = remoteEntry.hash;
    if (remoteHash !== undefined && remoteHash === localHash) {
      result.same += 1;
      continue;
    }
    // 无基线或双方均变时无法判定单双侧修改，保守按冲突处理，绝不静默覆盖
    const baselineHash = baseline?.get(remoteEntry.relPath)?.hash;
    if (baselineHash === localHash) {
      result.pull.push(remoteEntry);
    } else if (baselineHash !== undefined && baselineHash === remoteHash) {
      result.push.push(localEntry);
    } else {
      result.conflict.push({ local: localEntry, remote: remoteEntry });
    }
  }

  for (const [relPath, localEntry] of localMap) {
    if (!remoteMap.has(relPath)) result.push.push(localEntry);
  }

  return result;
}


