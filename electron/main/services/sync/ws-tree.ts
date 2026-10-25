/**
 * 同步范围目录树服务（sync-settings 用户勾选树的后端）：工作区相对路径单层列出（懒加载）+
 * 子树规模统计（提醒误勾巨型目录）+ .git 检测（git 区提示）。
 * 读盘严格限在工作区根内（防渲染层构造穿越路径读盘），与 manifest 层 isCleanRelSegs 同规则。
 */
import { execFile } from 'node:child_process';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';

const execFileP = promisify(execFile);

export interface SyncTreeNode {
  name: string;
  /** POSIX 斜杠相对路径（与 syncOptions.userSyncPaths 条目同形态） */
  relPath: string;
  type: 'directory' | 'file';
  /** 仅文件：字节大小 */
  size?: number;
}

/**
 * git 归类全集（根请求一次性拉取，随根响应返回）：managed 与 ignored 互斥且合起来覆盖工作区全部文件。
 * managed = tracked + untracked 未 ignore（git 会管的）；ignored = 未跟踪且被忽略（git 不管，目录已折叠）
 */
export interface SyncGitClassify {
  managed: string[];
  ignored: string[];
}

export interface SyncDirListing {
  /** 工作区根下存在 .git（目录或 worktree 指针文件） */
  hasGit: boolean;
  entries: SyncTreeNode[];
  /** 仅根请求且归类全集可用时返回；缺失 = 不分组（非 git / git 命令失败 / 超上限） */
  git?: SyncGitClassify;
}

export interface SyncDirStats {
  fileCount: number;
  totalBytes: number;
  /** 超过扫描上限提前截断（视为巨型目录信号） */
  truncated: boolean;
}

/** 子树规模统计的文件数上限：超过即截断，避免对 node_modules 类目录全量遍历 */
const MAX_STAT_FILES = 20_000;

/** 归类全集条目上限：超大仓库放弃分组（UI 退化为单列表），防巨量路径序列化拖垮 IPC */
const MAX_GIT_CLASSIFY_ENTRIES = 100_000;
const GIT_CLASSIFY_TIMEOUT_MS = 15_000;

/** 树中不展示的顶层名：.git 有专属提示组；.dogear 是应用旧数据区（非用户文件）；其余 dotfile 非用户文件 */
const TREE_SKIP_NAMES = new Set(['.git', '.dogear']);

/**
 * 相对路径安全校验：POSIX 段均非空/./.. 且无反斜杠；返回规范化绝对路径，非法抛错。
 * 统一在此校验后不再二次 resolve 比对（段级干净 + 无反斜杠 + join 语义已保证不逃逸根）
 */
function resolveWithinWorkspace(workspacePath: string, relPath: string): string {
  if (relPath.includes('\\') || relPath.startsWith('/')) throw new Error('非法路径');
  const segs = relPath.split('/').filter((s) => s !== '');
  if (segs.some((s) => s === '.' || s === '..')) throw new Error('非法路径');
  return path.join(workspacePath, ...segs);
}

export async function listWorkspaceDirForSync(workspacePath: string, relPath: string): Promise<SyncDirListing> {
  const absDir = resolveWithinWorkspace(workspacePath, relPath);
  const [hasGit, entries] = await Promise.all([hasGitDir(workspacePath), listDir(absDir, relPath)]);
  if (relPath !== '' || !hasGit) return { hasGit, entries };
  const git = await loadGitClassify(workspacePath);
  return git ? { hasGit, entries, git } : { hasGit, entries };
}

/**
 * 根请求时在工作区根一次拉取 git 归类全集；任何失败（未装 git / 超时 / 输出超限）都静默退化为不分组。
 * 两条 ls-files 互补互斥：--cached --others --exclude-standard = 会管的文件级全集；
 * --others --ignored --exclude-standard --directory = 被忽略的条目（整目录忽略时折叠为一条，尾斜杠归一化去掉）
 */
async function loadGitClassify(workspacePath: string): Promise<SyncGitClassify | undefined> {
  try {
    const [managed, ignoredRaw] = await Promise.all([
      runGitLsFiles(workspacePath, ['--cached', '--others', '--exclude-standard']),
      runGitLsFiles(workspacePath, ['--others', '--ignored', '--exclude-standard', '--directory']),
    ]);
    const ignored = ignoredRaw.map((p) => (p.endsWith('/') ? p.slice(0, -1) : p)).filter((p) => p !== '');
    if (managed.length + ignored.length > MAX_GIT_CLASSIFY_ENTRIES) return undefined;
    return { managed, ignored };
  } catch {
    return undefined;
  }
}

async function runGitLsFiles(cwd: string, args: string[]): Promise<string[]> {
  const { stdout } = await execFileP('git', ['ls-files', '-z', ...args], {
    cwd,
    maxBuffer: 64 * 1024 * 1024,
    timeout: GIT_CLASSIFY_TIMEOUT_MS,
    windowsHide: true,
  });
  return stdout.split('\0').filter(Boolean);
}

export async function statWorkspaceDirForSync(workspacePath: string, relPath: string): Promise<SyncDirStats> {
  const absDir = resolveWithinWorkspace(workspacePath, relPath);
  return statSubtree(absDir);
}

export async function hasGitDir(workspacePath: string): Promise<boolean> {
  try {
    await fsp.stat(path.join(workspacePath, '.git'));
    return true;
  } catch {
    return false;
  }
}

async function listDir(absDir: string, relPath: string): Promise<SyncTreeNode[]> {
  let dirents;
  try {
    dirents = await fsp.readdir(absDir, { withFileTypes: true });
  } catch {
    return [];
  }
  const out: SyncTreeNode[] = [];
  for (const dirent of dirents) {
    if (TREE_SKIP_NAMES.has(dirent.name) || dirent.name.startsWith('.')) continue;
    if (!dirent.isDirectory() && !dirent.isFile()) continue;
    const childRel = relPath === '' ? dirent.name : `${relPath}/${dirent.name}`;
    if (dirent.isDirectory()) {
      out.push({ name: dirent.name, relPath: childRel, type: 'directory' });
      continue;
    }
    let size: number | undefined;
    try {
      size = (await fsp.stat(path.join(absDir, dirent.name))).size;
    } catch {
      size = undefined;
    }
    out.push({ name: dirent.name, relPath: childRel, type: 'file', ...(size !== undefined ? { size } : {}) });
  }
  out.sort((a, b) => {
    if (a.type === 'directory' && b.type !== 'directory') return -1;
    if (a.type !== 'directory' && b.type === 'directory') return 1;
    return a.name.localeCompare(b.name, 'zh-CN');
  });
  return out;
}

async function statSubtree(absDir: string): Promise<SyncDirStats> {
  const result: SyncDirStats = { fileCount: 0, totalBytes: 0, truncated: false };
  const queue: string[] = [absDir];
  while (queue.length > 0) {
    const dir = queue.shift()!;
    let dirents;
    try {
      dirents = await fsp.readdir(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const dirent of dirents) {
      if (result.fileCount >= MAX_STAT_FILES) {
        result.truncated = true;
        return result;
      }
      if (dirent.name.startsWith('.')) continue;
      const abs = path.join(dir, dirent.name);
      if (dirent.isDirectory()) {
        queue.push(abs);
        continue;
      }
      if (!dirent.isFile()) continue;
      try {
        result.fileCount += 1;
        result.totalBytes += (await fsp.stat(abs)).size;
      } catch {
        // 竞态：统计中文件消失，跳过不计
      }
    }
  }
  return result;
}
