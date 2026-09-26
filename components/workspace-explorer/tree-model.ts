/**
 * WorkspaceExplorer 树数据模型与分区判定
 */
import type { WorkspaceFileNode } from '@/types/electron-api';
import type { ArticleMeta } from '@/types/article';

/** 判断路径是否属于文章目录 */
export function isArticlePath(path: string): boolean {
  return path.startsWith('.dogear/articles');
}

/** 从 WorkspaceFileNode 构建 ArticleMeta 对象 */
export function buildArticleMeta(node: WorkspaceFileNode): ArticleMeta | null {
  if (node.type !== 'article' || !node.articleMeta) return null;
  return {
    id: node.articleMeta.id,
    url: node.articleMeta.url,
    title: node.name,
    author: null,
    siteName: node.articleMeta.siteName,
    excerpt: null,
    wordCount: node.articleMeta.wordCount,
    fetchedAt: node.articleMeta.fetchedAt,
    language: null,
  };
}

/** headless-tree 的扁平节点 */
export interface FlatNode {
  id: string;
  name: string;
  isFolder: boolean;
  childrenIds: string[];
  nodeType: 'article' | 'file' | 'directory' | 'section-header';
  originalNode?: WorkspaceFileNode;
}

// 虚拟根节点和分区头 ID
export const ROOT_ID = '__root__';
export const ARTICLES_SECTION_ID = '__articles__';
export const FILES_SECTION_ID = '__files__';

/**
 * 递归遍历 WorkspaceFileNode 树，构建扁平 Record
 * 同时统计叶子节点（文章/文件）数量
 */
export function buildNodeMap(files: WorkspaceFileNode[]): {
  nodeMap: Record<string, FlatNode>;
  articleCount: number;
  fileCount: number;
} {
  const nodeMap: Record<string, FlatNode> = {};
  let articleCount = 0;
  let fileCount = 0;

  // 分离文章区和文件区
  const articleNodes = files.filter(f => isArticlePath(f.path));
  const fileNodes = files.filter(f => !isArticlePath(f.path));

  // 递归添加节点到 nodeMap
  function addNode(node: WorkspaceFileNode): void {
    const isDir = node.type === 'directory';
    const childIds: string[] = [];
    if (isDir && node.children) {
      for (const child of node.children) {
        childIds.push(child.path);
        addNode(child);
      }
    }
    // 统计叶子节点
    if (node.type === 'article') articleCount++;
    if (node.type === 'file') fileCount++;

    nodeMap[node.path] = {
      id: node.path,
      name: node.name,
      isFolder: isDir,
      childrenIds: childIds,
      nodeType: node.type === 'article' ? 'article' : (isDir ? 'directory' : 'file'),
      originalNode: node,
    };
  }

  // 构建文章区节点
  const articleChildIds: string[] = [];
  for (const node of articleNodes) {
    articleChildIds.push(node.path);
    addNode(node);
  }

  // 构建文件区节点
  const fileChildIds: string[] = [];
  for (const node of fileNodes) {
    fileChildIds.push(node.path);
    addNode(node);
  }

  // 文章分区头
  nodeMap[ARTICLES_SECTION_ID] = {
    id: ARTICLES_SECTION_ID,
    name: '文章',
    isFolder: true,
    childrenIds: articleChildIds,
    nodeType: 'section-header',
  };

  // 文件分区头
  nodeMap[FILES_SECTION_ID] = {
    id: FILES_SECTION_ID,
    name: '文件',
    isFolder: true,
    childrenIds: fileChildIds,
    nodeType: 'section-header',
  };

  // 虚拟根节点
  nodeMap[ROOT_ID] = {
    id: ROOT_ID,
    name: 'root',
    isFolder: true,
    childrenIds: [ARTICLES_SECTION_ID, FILES_SECTION_ID],
    nodeType: 'section-header',
  };

  return { nodeMap, articleCount, fileCount };
}

/** 判断节点是否属于文章分区 */
export function isInArticleSection(itemId: string, nodeMap: Record<string, FlatNode>): boolean {
  if (itemId === ARTICLES_SECTION_ID) return true;
  const node = nodeMap[itemId];
  if (!node) return false;
  if (node.originalNode && isArticlePath(node.originalNode.path)) return true;
  return false;
}

/** 判断节点是否属于文件分区 */
export function isInFileSection(itemId: string, nodeMap: Record<string, FlatNode>): boolean {
  if (itemId === FILES_SECTION_ID) return true;
  const node = nodeMap[itemId];
  if (!node) return false;
  if (node.originalNode && !isArticlePath(node.originalNode.path)) return true;
  return false;
}
