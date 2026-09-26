/**
 * 文章目录树与文件夹操作
 */
import fs from 'fs/promises';
import path from 'path';
import {
  addToOrder,
  loadArticleOrder,
  moveInOrder,
  removeFromOrder,
  renameInOrder,
  saveArticleOrder,
} from './order-index.js';
import type { ArticleOrderFile } from './order-index.js';
import { ARTICLES_DIR } from './types.js';
import type { ArticleMeta } from './types.js';
import type { WorkspaceFileNode } from '../../types.js';

/**
 * 递归扫描 .dogear/articles/ 目录，构建文章树
 * - 含 meta.json 的目录识别为文章节点（显示标题而非 UUID）
 * - 其他目录识别为分类文件夹
 */
export async function listArticleTree(workspacePath: string): Promise<WorkspaceFileNode[]> {
  const articlesDir = path.join(workspacePath, ARTICLES_DIR);
  const order = await loadArticleOrder(workspacePath);
  return scanArticleDirectory(articlesDir, workspacePath, order);
}

async function scanArticleDirectory(
  dirPath: string,
  workspacePath: string,
  order: ArticleOrderFile,
): Promise<WorkspaceFileNode[]> {
  try {
    const entries = await fs.readdir(dirPath, { withFileTypes: true });
    const nodes: WorkspaceFileNode[] = [];

    for (const entry of entries) {
      // 跳过隐藏文件（如 .order.json）和非目录
      if (entry.name.startsWith('.') || !entry.isDirectory()) continue;

      const fullPath = path.join(dirPath, entry.name);
      const relativePath = path.relative(workspacePath, fullPath).replace(/\\/g, '/');

      // 检查是否为文章目录（含 meta.json）
      const metaPath = path.join(fullPath, 'meta.json');
      try {
        const metaContent = await fs.readFile(metaPath, 'utf-8');
        const meta: ArticleMeta = JSON.parse(metaContent);
        nodes.push({
          name: meta.title,
          path: relativePath,
          type: 'article' as const,
          articleMeta: {
            id: meta.id,
            url: meta.url,
            siteName: meta.siteName,
            fetchedAt: meta.fetchedAt,
            wordCount: meta.wordCount,
            parseStatus: meta.parseStatus,
          },
        });
      } catch {
        // 没有 meta.json → 是分类文件夹，递归扫描
        const children = await scanArticleDirectory(fullPath, workspacePath, order);
        nodes.push({
          name: entry.name,
          path: relativePath,
          type: 'directory' as const,
          children,
        });
      }
    }

    // 按排序索引排序，不在索引中的追加到末尾
    const dirRelPath = path.relative(workspacePath, dirPath).replace(/\\/g, '/');
    const savedOrder = order.children[dirRelPath];

    if (savedOrder && savedOrder.length > 0) {
      // 按索引排序：先按 savedOrder 中的顺序，未记录的追加到末尾
      const nodeByBasename = new Map<string, WorkspaceFileNode>();
      for (const node of nodes) {
        nodeByBasename.set(path.basename(node.path), node);
      }

      const sorted: WorkspaceFileNode[] = [];
      const placed = new Set<string>();

      // 先按索引顺序添加
      for (const basename of savedOrder) {
        const node = nodeByBasename.get(basename);
        if (node) {
          sorted.push(node);
          placed.add(basename);
        }
      }

      // 未记录的项追加到末尾（文件夹优先 + 文章按时间倒序）
      const unplaced = nodes.filter(n => !placed.has(path.basename(n.path)));
      unplaced.sort((a, b) => {
        if (a.type === 'directory' && b.type !== 'directory') return -1;
        if (a.type !== 'directory' && b.type === 'directory') return 1;
        if (a.type === 'article' && b.type === 'article') {
          return (b.articleMeta?.fetchedAt || 0) - (a.articleMeta?.fetchedAt || 0);
        }
        return a.name.localeCompare(b.name, 'zh-CN');
      });
      sorted.push(...unplaced);

      // 最终强制文件夹优先分区
      const folders = sorted.filter(n => n.type === 'directory');
      const articles = sorted.filter(n => n.type !== 'directory');
      return [...folders, ...articles];
    }

    // 无排序索引时，使用默认排序：文件夹在前，文章按 fetchedAt 倒序
    nodes.sort((a, b) => {
      if (a.type === 'directory' && b.type !== 'directory') return -1;
      if (a.type !== 'directory' && b.type === 'directory') return 1;
      if (a.type === 'article' && b.type === 'article') {
        return (b.articleMeta?.fetchedAt || 0) - (a.articleMeta?.fetchedAt || 0);
      }
      return a.name.localeCompare(b.name, 'zh-CN');
    });

    return nodes;
  } catch {
    return [];
  }
}

/**
 * 在 .dogear/articles/ 下创建分类文件夹
 */
export async function createArticleFolder(
  workspacePath: string,
  parentRelPath: string,
  name: string
): Promise<void> {
  const parentAbsPath = path.join(workspacePath, parentRelPath);
  const newFolderPath = path.join(parentAbsPath, name);
  await fs.mkdir(newFolderPath, { recursive: true });

  // 更新排序索引
  await addToOrder(workspacePath, parentRelPath, name, true);
}

/**
 * 移动文章或文件夹到目标分类文件夹
 */
export async function moveArticleItem(
  workspacePath: string,
  sourceRelPath: string,
  targetFolderRelPath: string,
  targetIndex?: number,
): Promise<void> {
  const sourceAbsPath = path.join(workspacePath, sourceRelPath);
  const targetFolderAbsPath = path.join(workspacePath, targetFolderRelPath);
  const itemName = path.basename(sourceAbsPath);
  const targetAbsPath = path.join(targetFolderAbsPath, itemName);

  // 获取源目录的相对路径
  const sourceParentRelPath = path.dirname(sourceRelPath).replace(/\\/g, '/');

  // 移动文件系统
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

  // 更新排序索引
  await moveInOrder(workspacePath, sourceParentRelPath, targetFolderRelPath, itemName, targetIndex);
}

/**
 * 重命名文章分类文件夹
 */
export async function renameArticleFolder(
  workspacePath: string,
  folderRelPath: string,
  newName: string
): Promise<void> {
  const oldAbsPath = path.join(workspacePath, folderRelPath);
  const newAbsPath = path.join(path.dirname(oldAbsPath), newName);
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

  // 更新排序索引
  const parentRelPath = path.dirname(folderRelPath).replace(/\\/g, '/');
  const oldBasename = path.basename(folderRelPath);
  await renameInOrder(workspacePath, parentRelPath, oldBasename, newName);
}

/**
 * 删除文章分类文件夹（含内容）
 */
export async function deleteArticleFolder(
  workspacePath: string,
  folderRelPath: string
): Promise<void> {
  const absPath = path.join(workspacePath, folderRelPath);
  await fs.rm(absPath, { recursive: true, force: true });

  // 更新排序索引：从父目录中移除
  const parentRelPath = path.dirname(folderRelPath).replace(/\\/g, '/');
  const basename = path.basename(folderRelPath);
  await removeFromOrder(workspacePath, parentRelPath, basename);

  // 同时清理该目录自身的索引条目
  const order = await loadArticleOrder(workspacePath);
  delete order.children[folderRelPath];
  await saveArticleOrder(workspacePath, order);
}
