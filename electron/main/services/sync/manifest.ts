import path from 'node:path';
import fsp from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import type { DiffResult, FileEntry, HashedFileEntry, SkippedEntry } from './protocol.js';
import type { SyncOptions } from '../settings-types.js';

/** 可选目录同步项：stocks/feishu 开关走独立布尔键（syncStocksData/syncFeishu），不入 disabledSyncItems（F1 接入 excludes 统一体系） */
const OPTIONAL_DIR_ITEMS = ['stocks', 'feishu'] as const;
export type OptionalDirItem = (typeof OPTIONAL_DIR_ITEMS)[number];
export type OptionalDirs = Record<OptionalDirItem, boolean>;

/** 同步范围排除项（Step 1 代码级 options，Step 2 接通 settings.syncOptions）；false = 排除该项 */
export interface ManifestExcludes {
  /** .conflict-<短ID> 冲突副本是否同步（false = 排除） */
  conflictCopies: boolean;
  /** 任意层级 shadow-git/ 目录是否同步（false = 排除） */
  shadowGit: boolean;
  /** 关闭的同步项 id 集合（目录 7 项 + 文件 3 项；stocks/feishu 走 optionalDirs，不在此生效） */
  disabledItems: Set<string>;
  /** 可选目录 stocks/feishu 是否同步（true = 同步，语义与其余开关同向） */
  optionalDirs: OptionalDirs;
}

export interface ManifestOptions {
  /**
   * workspaces/ 下只收这些本端 wsid 目录（映射表中 enabled=true 者，per-peer）。
   * undefined = 不过滤（全量，向后兼容）；空数组 = 全部工作区目录不同步（首次使用即受控，全局数据恒同步）。
   */
  enabledWorkspaceIds?: string[];
  /** 同步范围排除（含 stocks/feishu 可选目录开关）；缺省 = 全放行（现状行为） */
  excludes?: ManifestExcludes;
}

const ALWAYS_SYNC_DIRS = ['workspaces', 'conversations', 'memory', 'usage', 'article-parser', 'site-knowledge', 'run-history'] as const;
const ALWAYS_SYNC_FILES = ['settings.json', 'plans.json', 'notifications.json'] as const;

const IGNORE_FILE_SUFFIXES = ['.bak', '.lock', '.tmp'];
const IGNORE_DIR_NAMES = new Set(['__pycache__', 'browser-profile', 'logs', 'backups']);
const IGNORE_BASENAMES = new Set(['sync-state.json']);

const SHADOW_GIT_DIR = 'shadow-git';
const EXCLUDABLE_FILE_ITEMS = new Set<string>(ALWAYS_SYNC_FILES);
const EXCLUDABLE_DIR_ITEMS = new Set<string>(ALWAYS_SYNC_DIRS);

/**
 * 冲突副本 basename 判定（apply.ts conflictCopyRelPath 生成规则 `<stem><ext>.conflict-<短ID>-<时间戳>-<随机段>`
 * 的逆运算，旧格式 `<stem><ext>.conflict-<短ID>` 天然兼容）：以最后一个点切出 ext，
 * ext 形如 `.conflict-<至少 1 位尾缀>` 才命中。`.conflict-` 出现在 stem 中间
 * （如 `a.conflict-b.json`，末点切出 ext=`.json`）不命中；dotfile 整体作 stem（`.gitignore.conflict-x`）
 * 的 lastIndexOf 恰好切在尾段，天然兼容；纯 `.conflict-x`（无 stem，dot<=0）不命中。
 */
function isConflictCopyBasename(base: string): boolean {
  const dot = base.lastIndexOf('.');
  if (dot <= 0) return false;
  const ext = base.slice(dot);
  return ext.startsWith('.conflict-') && ext.length > '.conflict-'.length;
}

/**
 * settings.syncOptions → ManifestExcludes：语义同向直传（syncConflictCopies/syncShadowGit 与 excludes 的
 * conflictCopies/shadowGit 都是「true = 同步」，无翻转，别在此接反；stocks/feishu 独立布尔键同样同向进
 * optionalDirs）。disabledSyncItems 非法输入已在 normalizeSyncOptions 清洗过，这里只防御非数组。
 * 主动发起（orchestrator）与被动响应（getManifestOptions）共用本函数，保证两端方向上排除语义一致。
 */
export function excludesFromSyncOptions(sync?: SyncOptions): ManifestExcludes {
  return {
    conflictCopies: sync?.syncConflictCopies === true,
    shadowGit: sync?.syncShadowGit === true,
    disabledItems: new Set(Array.isArray(sync?.disabledSyncItems) ? sync!.disabledSyncItems : []),
    optionalDirs: {
      stocks: sync?.syncStocksData === true,
      feishu: sync?.syncFeishu === true,
    },
  };
}

/**
 * 同步范围排除唯一判定入口（纯函数）：清单生成 / 拉取（diff）/ 应用（apply）/ 推送接收（push guard）四处对称共用。
 * diff 是集合差语义——只在 buildManifest 单侧排除，对端清单仍会以 remote-only 判拉取，
 * 因此拉取与应用侧必须用本函数对对端条目再过滤一遍；push 接收端同理由 guard 调本函数（D1）。
 * excludes 缺省 = 全放行（现状行为）。stocks/feishu 由 optionalDirs 控制（F1），不受 disabledItems 影响。
 */
export function isExcluded(relPath: string, excludes?: ManifestExcludes): boolean {
  if (!excludes) return false;
  const segments = relPath.split('/');
  if (!excludes.shadowGit && segments.includes(SHADOW_GIT_DIR)) return true;
  if (!excludes.conflictCopies && isConflictCopyBasename(segments[segments.length - 1])) return true;
  const first = segments[0];
  for (const dir of OPTIONAL_DIR_ITEMS) {
    if (first === dir && !excludes.optionalDirs[dir]) return true;
  }
  const items = excludes.disabledItems;
  if (items.size > 0) {
    if (items.has(relPath) && (EXCLUDABLE_FILE_ITEMS.has(relPath) || EXCLUDABLE_DIR_ITEMS.has(relPath))) return true;
    const slash = relPath.indexOf('/');
    if (slash > 0) {
      // 目录项 = 第一段命中（前缀带 '/' 比较，workspaces/abc 命中而 workspaces.json 不命中）
      const dirSegment = relPath.slice(0, slash);
      if (EXCLUDABLE_DIR_ITEMS.has(dirSegment) && items.has(dirSegment)) return true;
    }
  }
  return false;
}

export async function buildManifest(root: string, options: ManifestOptions = {}): Promise<FileEntry[]> {
  const { excludes } = options;
  const entries: FileEntry[] = [];
  const jobs: Promise<void>[] = [];
  for (const dir of ALWAYS_SYNC_DIRS) {
    if (isExcluded(dir, excludes)) continue;
    if (dir === 'workspaces' && options.enabledWorkspaceIds) {
      // workspaces/ 特殊处理：一级子目录按 per-peer 映射表过滤（workspaces/<wsid>/）。
      // workspaces/ 下直接落文件（workspaces.json、其冲突副本等）不受过滤，属全局数据恒同步
      jobs.push(walkWorkspacesDir(root, new Set(options.enabledWorkspaceIds), entries, excludes));
    } else {
      jobs.push(walkDir(root, dir, entries, excludes));
    }
  }
  for (const name of ALWAYS_SYNC_FILES) {
    jobs.push(statFile(root, name, entries, excludes));
  }
  for (const dir of OPTIONAL_DIR_ITEMS) {
    if (isExcluded(dir, excludes)) continue;
    jobs.push(walkDir(root, dir, entries, excludes));
  }
  await Promise.all(jobs);
  entries.sort((a, b) => (a.relPath < b.relPath ? -1 : a.relPath > b.relPath ? 1 : 0));
  return entries;
}

/** walkDir 的 workspaces/ 特化版：一级目录按映射表 wsid 过滤，文件与已启用 wsid 子树照常收 */
async function walkWorkspacesDir(root: string, enabledIds: Set<string>, out: FileEntry[], excludes?: ManifestExcludes): Promise<void> {
  let dirents;
  try {
    dirents = await fsp.readdir(path.join(root, 'workspaces'), { withFileTypes: true });
  } catch {
    return;
  }
  await Promise.all(dirents.map(async (dirent) => {
    const rel = `workspaces/${dirent.name}`;
    if (dirent.isDirectory()) {
      if (IGNORE_DIR_NAMES.has(dirent.name.toLowerCase())) return;
      if (!enabledIds.has(dirent.name)) return;
      if (isExcluded(rel, excludes)) return;
      await walkDir(root, rel, out, excludes);
      return;
    }
    if (!dirent.isFile() || dirent.isSymbolicLink()) return;
    await statFile(root, rel, out, excludes);
  }));
}

async function walkDir(root: string, relDir: string, out: FileEntry[], excludes?: ManifestExcludes): Promise<void> {
  let dirents;
  try {
    dirents = await fsp.readdir(path.join(root, relDir), { withFileTypes: true });
  } catch {
    return;
  }
  await Promise.all(dirents.map(async (dirent) => {
    const name = dirent.name;
    const childRel = `${relDir}/${name}`;
    if (dirent.isDirectory()) {
      if (IGNORE_DIR_NAMES.has(name.toLowerCase())) return;
      if (isExcluded(childRel, excludes)) return; // 目录命中剪枝（如 workspaces/<wsid>/shadow-git/ 整树）
      await walkDir(root, childRel, out, excludes);
      return;
    }
    if (!dirent.isFile() || dirent.isSymbolicLink()) return;
    await statFile(root, childRel, out, excludes);
  }));
}

async function statFile(root: string, relPath: string, out: FileEntry[], excludes?: ManifestExcludes): Promise<void> {
  if (isExcluded(relPath, excludes)) return;
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
  /** 本端同步范围排除：对端清单命中者跳过不进 pull/冲突集合（对称过滤，防 remote-only 判定架空排除） */
  excludes?: ManifestExcludes;
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
    if (isExcluded(relPath, input.excludes)) {
      result.skipped.push({ relPath, reason: 'excluded by local sync scope' });
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


