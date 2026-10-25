/**
 * WorkspaceExplorer 树数据模型与文章路径判定
 */
import type { WorkspaceFileNode } from '@/types/electron-api';
import type { ArticleMeta } from '@/types/article';

/** 判断路径是否属于文章目录（文章语义判定：dogear/articles 子树内） */
export function isArticlePath(path: string): boolean {
  return path.startsWith('dogear/articles');
}

/** 查找命中 relPath 的排除条目：与主进程 isExcludedRelPath 同语义（段数组前缀覆盖整子树），精确命中优先，无命中返回 null */
export function findExclusionEntry(relPath: string, excludedPaths: ReadonlySet<string>): string | null {
  const segments = relPath.split('/').filter(Boolean);
  let coveredBy: string | null = null;
  for (const entry of excludedPaths) {
    const entrySegs = entry.split('/').filter(Boolean);
    if (entrySegs.length === 0 || entrySegs.length > segments.length) continue;
    if (!entrySegs.every((s, i) => segments[i] === s)) continue;
    if (entrySegs.length === segments.length) return entry;
    coveredBy = coveredBy ?? entry;
  }
  return coveredBy;
}

/** 从 WorkspaceFileNode 构建 ArticleMeta 对象（path 供阅读 tab 打开与按路径加载详情） */
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
    path: node.path,
  };
}

/** 把已加载目录层缓存（loadCache）合并进懒加载树：命中缓存的目录替换 children 后递归合并 */
export function mergeDirChildren(nodes: WorkspaceFileNode[], cache: Readonly<Record<string, WorkspaceFileNode[]>>): WorkspaceFileNode[] {
  return nodes.map(node => {
    if (node.type !== 'directory') return node;
    const cached = cache[node.path];
    if (!cached) return node;
    return { ...node, children: mergeDirChildren(cached, cache) };
  });
}

/** headless-tree 的扁平节点 */
export interface FlatNode {
  id: string;
  name: string;
  isFolder: boolean;
  childrenIds: string[];
  nodeType: 'article' | 'file' | 'directory' | 'group-header';
  originalNode?: WorkspaceFileNode;
  /** 仅 group-header 使用：组内文件叶子数 */
  count?: number;
}

// 虚拟根节点与分组头 ID
export const ROOT_ID = '__root__';
export const UNTRACKED_GROUP_ID = '__files-untracked__';
export const TRACKED_GROUP_ID = '__files-tracked__';

/**
 * 从子树中摘出 untracked 子树（?? 项，任意深度）收进 collected，返回剔除后的副本；
 * 因此变空的目录一并剔除（原本为空的目录保留；过滤态下 untracked 项可留下仅含它的 tracked 祖先链，摘出后祖先空挂）
 */
function collectUntrackedAndStrip(node: WorkspaceFileNode, collected: WorkspaceFileNode[]): WorkspaceFileNode | null {
  if (node.gitStatus === 'untracked') {
    collected.push(node);
    return null;
  }
  if (node.type !== 'directory' || !node.children) return node;
  const kept: WorkspaceFileNode[] = [];
  for (const child of node.children) {
    const stripped = collectUntrackedAndStrip(child, collected);
    if (stripped) kept.push(stripped);
  }
  if (node.children.length > 0 && kept.length === 0) return null;
  // 引用全等才复用原节点：长度相等不代表内容未变（唯一子节点被替换成剔除后副本时长度不变）
  const unchanged = kept.length === node.children.length && kept.every((k, i) => k === node.children![i]);
  return unchanged ? node : { ...node, children: kept };
}

function countFileLeaves(nodes: WorkspaceFileNode[]): number {
  let count = 0;
  for (const node of nodes) {
    if (node.type === 'file' || node.type === 'article') count++;
    if (node.type === 'directory' && node.children) count += countFileLeaves(node.children);
  }
  return count;
}

/**
 * 递归遍历 WorkspaceFileNode 树，构建扁平 Record（单文件区；文章节点按 frontmatter 识别随目录层出现）
 */
export function buildNodeMap(files: WorkspaceFileNode[]): {
  nodeMap: Record<string, FlatNode>;
  articleCount: number;
  fileCount: number;
} {
  const nodeMap: Record<string, FlatNode> = {};
  let articleCount = 0;
  let fileCount = 0;

  function addNode(node: WorkspaceFileNode): void {
    const isDir = node.type === 'directory';
    const childIds: string[] = [];
    if (isDir && node.children) {
      for (const child of node.children) {
        childIds.push(child.path);
        addNode(child);
      }
    }
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

  // 成员节点：untracked 子树（?? 项，任意深度）摘出进「新生产」组置顶，其余归「仓库文件」组；无 untracked 时平铺（非 git 工作区降级）
  const collectedUntracked: WorkspaceFileNode[] = [];
  const trackedNodes = files
    .map(n => collectUntrackedAndStrip(n, collectedUntracked))
    .filter((n): n is WorkspaceFileNode => n !== null);
  const grouped = collectedUntracked.length > 0;

  const members = grouped ? trackedNodes : files;
  for (const node of members) addNode(node);

  const rootChildIds: string[] = [];
  if (grouped) {
    nodeMap[UNTRACKED_GROUP_ID] = {
      id: UNTRACKED_GROUP_ID,
      name: '新生产',
      isFolder: true,
      childrenIds: collectedUntracked.map(n => n.path),
      nodeType: 'group-header',
      count: countFileLeaves(collectedUntracked),
    };
    rootChildIds.push(UNTRACKED_GROUP_ID);
  }
  if (members.length > 0) {
    if (grouped) {
      nodeMap[TRACKED_GROUP_ID] = {
        id: TRACKED_GROUP_ID,
        name: '仓库文件',
        isFolder: true,
        childrenIds: trackedNodes.map(n => n.path),
        nodeType: 'group-header',
        count: countFileLeaves(trackedNodes),
      };
      rootChildIds.push(TRACKED_GROUP_ID);
    } else {
      rootChildIds.push(...members.map(n => n.path));
    }
  }

  // 虚拟根节点
  nodeMap[ROOT_ID] = {
    id: ROOT_ID,
    name: 'root',
    isFolder: true,
    childrenIds: rootChildIds,
    nodeType: 'directory',
  };

  return { nodeMap, articleCount, fileCount };
}

/** 目录节点：childrenIds 空 = 未加载，展开时逐层拉取 */
export function isLazyDirectory(entry: FlatNode): boolean {
  return entry.nodeType === 'directory';
}
