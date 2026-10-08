/**
 * 同步范围目录树服务（sync-settings 用户勾选树的后端）：工作区相对路径单层列出（懒加载）+
 * 子树规模统计（提醒误勾巨型目录）+ .git 检测（git 区提示）。
 * 读盘严格限在工作区根内（防渲染层构造穿越路径读盘），与 manifest 层 isCleanRelSegs 同规则。
 */
import fsp from 'node:fs/promises';
import path from 'node:path';

export interface SyncTreeNode {
  name: string;
  /** POSIX 斜杠相对路径（与 syncOptions.userSyncPaths 条目同形态） */
  relPath: string;
  type: 'directory' | 'file';
  /** 仅文件：字节大小 */
  size?: number;
}

export interface SyncDirListing {
  /** 工作区根下存在 .git（目录或 worktree 指针文件） */
  hasGit: boolean;
  entries: SyncTreeNode[];
}

export interface SyncDirStats {
  fileCount: number;
  totalBytes: number;
  /** 超过扫描上限提前截断（视为巨型目录信号） */
  truncated: boolean;
}

/** 子树规模统计的文件数上限：超过即截断，避免对 node_modules 类目录全量遍历 */
const MAX_STAT_FILES = 20_000;

/** 树中不展示的顶层名：.git 有专属提示组；.dogear 是应用数据区（走同步项开关）；其余 dotfile 非用户文件 */
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
  return { hasGit, entries };
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
