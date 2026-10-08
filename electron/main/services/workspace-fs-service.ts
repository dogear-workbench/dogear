/**
 * 工作区文件系统服务
 * 文件树操作（扫描/创建/重命名/移动/复制/删除）限定在主根内；
 * 读盘与存在性检查（readWorkspaceTextFile/checkPathsExist）接受多根（主根 + enabled 附加根），
 * 与 agent 侧 allowedPaths 语义对齐，防止越权访问
 */
import fs from 'fs/promises';
import path from 'path';
import type { WorkspaceFileNode } from '../types.js';
import { takeSnapshot, type SnapshotSource } from './git-service/index.js';

/** fire-and-forget：快照失败不阻塞原操作（无 git 时 takeSnapshot 静默跳过） */
function snapshotAfterUi(workspaceId: string | undefined, workspacePath: string, source: SnapshotSource, relPath: string): void {
  if (!workspaceId) return;
  takeSnapshot(workspaceId, workspacePath, source, toPosix(relPath)).catch((error) => {
    console.warn(`[git-snapshot] ${source} 快照失败:`, error);
  });
}

function toPosix(p: string): string {
  return p.replace(/\\/g, '/');
}

/** 隐藏的目录/文件名（不在文件树中显示） */
const HIDDEN_NAMES = ['.dogear', '.DS_Store', 'Thumbs.db', '.git'];

/** resolved 是否落在 root 内；前缀统一补路径分隔符，防兄弟目录前缀碰撞（C:\ws2 以 C:\ws 开头） */
function isWithinRoot(root: string, resolved: string): boolean {
  const normalizedRoot = path.normalize(root);
  const prefix = normalizedRoot.endsWith(path.sep) ? normalizedRoot : normalizedRoot + path.sep;
  return resolved === normalizedRoot || resolved.startsWith(prefix);
}

/**
 * 路径安全校验：确保目标路径在工作区范围内
 * @param workspacePath - 工作区绝对路径
 * @param relativePath - 待校验的相对路径
 * @returns 校验通过的绝对路径
 * @throws 路径越权时抛出错误
 */
export function resolveAndValidate(workspacePath: string, relativePath: string): string {
  const resolved = path.resolve(workspacePath, relativePath);
  const normalized = path.normalize(resolved);
  if (!isWithinRoot(workspacePath, normalized)) {
    throw new Error('路径越权：不允许访问工作区外的文件');
  }
  return normalized;
}

/**
 * 候选路径（相对/绝对）逐根解析，命中任一根内即返回该绝对路径，全部不命中返回 null。
 * 相对路径按 roots 顺序优先落在首根（主根），与 agent 侧 resolveWithinPaths 语义一致
 */
export function resolveWithinRoots(roots: string[], candidate: string): string | null {
  for (const root of roots) {
    if (!root) continue;
    const resolved = path.normalize(path.resolve(root, candidate));
    if (isWithinRoot(root, resolved)) return resolved;
  }
  return null;
}

/**
 * 批量存在性校验：仅对落在 roots 内的路径做 stat，根外路径一律 false（不泄露工作区外文件信息）
 * @returns 入参 path → 是否存在
 */
export async function checkPathsExist(roots: string[], paths: string[]): Promise<Record<string, boolean>> {
  const result: Record<string, boolean> = {};
  for (const candidate of paths) {
    const abs = resolveWithinRoots(roots, candidate);
    if (!abs) {
      result[candidate] = false;
      continue;
    }
    try {
      await fs.stat(abs);
      result[candidate] = true;
    } catch {
      result[candidate] = false;
    }
  }
  return result;
}

/**
 * 递归扫描工作区目录，构建文件树（排除隐藏目录）
 */
export async function scanWorkspaceFiles(workspacePath: string): Promise<WorkspaceFileNode[]> {
  return scanDirectory(workspacePath, workspacePath);
}

/**
 * 递归扫描单个目录，返回该目录下的文件节点列表
 */
async function scanDirectory(dirPath: string, workspacePath: string): Promise<WorkspaceFileNode[]> {
  try {
    const entries = await fs.readdir(dirPath, { withFileTypes: true });
    const nodes: WorkspaceFileNode[] = [];

    for (const entry of entries) {
      // 跳过隐藏文件和目录
      if (HIDDEN_NAMES.includes(entry.name) || entry.name.startsWith('.')) continue;

      const fullPath = path.join(dirPath, entry.name);
      const relativePath = path.relative(workspacePath, fullPath).replace(/\\/g, '/');

      if (entry.isDirectory()) {
        const children = await scanDirectory(fullPath, workspacePath);
        nodes.push({
          name: entry.name,
          path: relativePath,
          type: 'directory',
          children,
        });
      } else {
        const ext = path.extname(entry.name).toLowerCase();
        nodes.push({
          name: entry.name,
          path: relativePath,
          type: 'file',
          ext,
        });
      }
    }

    // 文件夹在前，文件在后，各自按名称排序
    nodes.sort((a, b) => {
      if (a.type === 'directory' && b.type !== 'directory') return -1;
      if (a.type !== 'directory' && b.type === 'directory') return 1;
      return a.name.localeCompare(b.name, 'zh-CN');
    });

    return nodes;
  } catch {
    return [];
  }
}

/**
 * 创建文件夹
 */
export async function createFolder(workspacePath: string, parentRelPath: string, name: string, workspaceId?: string): Promise<void> {
  const parentAbsPath = resolveAndValidate(workspacePath, parentRelPath);
  const newFolderPath = path.join(parentAbsPath, name);
  // 二次校验新文件夹路径也在工作区内
  resolveAndValidate(workspacePath, path.relative(workspacePath, newFolderPath));
  await fs.mkdir(newFolderPath, { recursive: true });
  snapshotAfterUi(workspaceId, workspacePath, 'ui-create', path.relative(workspacePath, newFolderPath));
}

/**
 * 重命名文件或文件夹
 */
export async function renameItem(workspacePath: string, itemRelPath: string, newName: string, workspaceId?: string): Promise<void> {
  const oldAbsPath = resolveAndValidate(workspacePath, itemRelPath);
  const newAbsPath = path.join(path.dirname(oldAbsPath), newName);
  // 校验重命名后的路径仍在工作区内
  resolveAndValidate(workspacePath, path.relative(workspacePath, newAbsPath));
  try {
    await fs.rename(oldAbsPath, newAbsPath);
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code === 'EPERM') {
      await fs.cp(oldAbsPath, newAbsPath, { recursive: true });
      await fs.rm(oldAbsPath, { recursive: true, force: true });
    } else {
      throw err;
    }
  }
  snapshotAfterUi(workspaceId, workspacePath, 'ui-rename', path.relative(workspacePath, newAbsPath));
}

/**
 * 移动文件或文件夹
 */
export async function moveItem(workspacePath: string, sourceRelPath: string, targetFolderRelPath: string, workspaceId?: string): Promise<void> {
  const sourceAbsPath = resolveAndValidate(workspacePath, sourceRelPath);
  const targetFolderAbsPath = resolveAndValidate(workspacePath, targetFolderRelPath);
  const itemName = path.basename(sourceAbsPath);
  const targetAbsPath = path.join(targetFolderAbsPath, itemName);
  // 校验目标路径在工作区内
  resolveAndValidate(workspacePath, path.relative(workspacePath, targetAbsPath));
  try {
    await fs.rename(sourceAbsPath, targetAbsPath);
  } catch (err: unknown) {
    // Windows 上 rename 可能因文件锁报 EPERM，用 copy + delete 作为 fallback
    if ((err as NodeJS.ErrnoException).code === 'EPERM') {
      await fs.cp(sourceAbsPath, targetAbsPath, { recursive: true });
      await fs.rm(sourceAbsPath, { recursive: true, force: true });
    } else {
      throw err;
    }
  }
  snapshotAfterUi(workspaceId, workspacePath, 'ui-rename', path.relative(workspacePath, targetAbsPath));
}

/**
 * 复制文件或文件夹
 */
export async function copyItem(workspacePath: string, sourceRelPath: string, targetFolderRelPath: string, workspaceId?: string): Promise<void> {
  const sourceAbsPath = resolveAndValidate(workspacePath, sourceRelPath);
  const targetFolderAbsPath = resolveAndValidate(workspacePath, targetFolderRelPath);
  const itemName = path.basename(sourceAbsPath);
  const targetAbsPath = path.join(targetFolderAbsPath, itemName);
  // 校验目标路径在工作区内
  resolveAndValidate(workspacePath, path.relative(workspacePath, targetAbsPath));
  await fs.cp(sourceAbsPath, targetAbsPath, { recursive: true });
  snapshotAfterUi(workspaceId, workspacePath, 'ui-create', path.relative(workspacePath, targetAbsPath));
}

/**
 * 删除文件或文件夹
 */
export async function deleteItem(workspacePath: string, itemRelPath: string, workspaceId?: string): Promise<void> {
  const absPath = resolveAndValidate(workspacePath, itemRelPath);
  await fs.rm(absPath, { recursive: true, force: true });
  snapshotAfterUi(workspaceId, workspacePath, 'ui-delete', path.relative(workspacePath, absPath));
}

const ALLOWED_TEXT_EXT = ['.md', '.markdown', '.txt', '.json'];

export async function readWorkspaceTextFile(roots: string[], relPath: string): Promise<string> {
  const safePath = resolveWithinRoots(roots, relPath);
  if (!safePath) {
    throw new Error('路径越权：不允许访问工作区外的文件');
  }
  const ext = path.extname(safePath).toLowerCase();
  if (!ALLOWED_TEXT_EXT.includes(ext)) {
    throw new Error(`不支持的文件类型: ${ext}`);
  }
  const stat = await fs.stat(safePath);
  if (stat.size > 5 * 1024 * 1024) {
    throw new Error('文件过大（>5MB），不支持预览');
  }
  return fs.readFile(safePath, 'utf-8');
}
