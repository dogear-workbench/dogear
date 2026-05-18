/**
 * 工作区文件系统服务
 * 提供工作区级别的文件操作（扫描、创建、重命名、移动、复制、删除）
 * 所有操作限定在工作区目录内，防止越权访问
 */
import fs from 'fs/promises';
import path from 'path';
import type { WorkspaceFileNode } from '../types.js';

/** 隐藏的目录/文件名（不在文件树中显示） */
const HIDDEN_NAMES = ['.dogear', '.DS_Store', 'Thumbs.db', '.git'];

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
  if (!normalized.startsWith(path.normalize(workspacePath))) {
    throw new Error('路径越权：不允许访问工作区外的文件');
  }
  return normalized;
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
export async function createFolder(workspacePath: string, parentRelPath: string, name: string): Promise<void> {
  const parentAbsPath = resolveAndValidate(workspacePath, parentRelPath);
  const newFolderPath = path.join(parentAbsPath, name);
  // 二次校验新文件夹路径也在工作区内
  resolveAndValidate(workspacePath, path.relative(workspacePath, newFolderPath));
  await fs.mkdir(newFolderPath, { recursive: true });
}

/**
 * 重命名文件或文件夹
 */
export async function renameItem(workspacePath: string, itemRelPath: string, newName: string): Promise<void> {
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
}

/**
 * 移动文件或文件夹
 */
export async function moveItem(workspacePath: string, sourceRelPath: string, targetFolderRelPath: string): Promise<void> {
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
}

/**
 * 复制文件或文件夹
 */
export async function copyItem(workspacePath: string, sourceRelPath: string, targetFolderRelPath: string): Promise<void> {
  const sourceAbsPath = resolveAndValidate(workspacePath, sourceRelPath);
  const targetFolderAbsPath = resolveAndValidate(workspacePath, targetFolderRelPath);
  const itemName = path.basename(sourceAbsPath);
  const targetAbsPath = path.join(targetFolderAbsPath, itemName);
  // 校验目标路径在工作区内
  resolveAndValidate(workspacePath, path.relative(workspacePath, targetAbsPath));
  await fs.cp(sourceAbsPath, targetAbsPath, { recursive: true });
}

/**
 * 删除文件或文件夹
 */
export async function deleteItem(workspacePath: string, itemRelPath: string): Promise<void> {
  const absPath = resolveAndValidate(workspacePath, itemRelPath);
  await fs.rm(absPath, { recursive: true, force: true });
}

const ALLOWED_TEXT_EXT = ['.md', '.markdown', '.txt', '.json'];

export async function readWorkspaceTextFile(workspacePath: string, relPath: string): Promise<string> {
  const safePath = resolveAndValidate(workspacePath, relPath);
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
