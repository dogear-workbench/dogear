/**
 * 工作区文件系统服务
 * 文件树操作（扫描/创建/重命名/移动/复制/删除）限定在主根内；
 * 读盘与存在性检查（readWorkspaceTextFile/checkPathsExist）接受多根（主根 + enabled 附加根），
 * 与 agent 侧 allowedPaths 语义对齐，防止越权访问
 */
import fs from 'fs/promises';
import type { Dirent } from 'fs';
import path from 'path';
import type { WorkspaceFileNode } from '../types.js';
import { takeSnapshot, type SnapshotSource } from './git-service/index.js';
import { parseArticleFile } from './article/frontmatter.js';
import { isArticlesRelPath } from './article/types.js';

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
 * 逐根解析且要求真实存在：前缀解析会被主根遮蔽（任何相对路径都落在主根内），
 * 存在性场景（读盘/胶囊校验）必须逐根 stat 直到命中，否则后位根（组共享区等）永远轮不到
 */
async function resolveExistingWithinRoots(roots: string[], candidate: string): Promise<string | null> {
  for (const root of roots) {
    if (!root) continue;
    const resolved = path.normalize(path.resolve(root, candidate));
    if (!isWithinRoot(root, resolved)) continue;
    try {
      await fs.stat(resolved);
      return resolved;
    } catch {
      continue;
    }
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
    result[candidate] = (await resolveExistingWithinRoots(roots, candidate)) !== null;
  }
  return result;
}

/** 原地标注 git 未跟踪节点（?? 项：散文件或纯未跟踪目录折叠形式），命中即整棵子树归属该节点，不再深入 */
export function markUntrackedNodes(nodes: WorkspaceFileNode[], untrackedPaths: ReadonlySet<string>): void {
  for (const node of nodes) {
    if (untrackedPaths.has(node.path)) {
      node.gitStatus = 'untracked';
      continue;
    }
    if (node.type === 'directory' && node.children) markUntrackedNodes(node.children, untrackedPaths);
  }
}

/** 读文章 md 的 frontmatter 组树节点（显示标题）；解析失败返回 null 由调用方降级普通文件 */
async function readArticleNode(absPath: string, relPath: string, fileName: string): Promise<WorkspaceFileNode | null> {
  try {
    const parsed = parseArticleFile(await fs.readFile(absPath, 'utf-8'));
    if (!parsed) return null;
    return {
      name: parsed.meta.title || fileName,
      path: relPath,
      type: 'article',
      articleMeta: {
        id: parsed.meta.id,
        url: parsed.meta.url,
        siteName: parsed.meta.siteName,
        fetchedAt: parsed.meta.fetchedAt,
        wordCount: parsed.meta.wordCount,
        parseStatus: parsed.meta.parseStatus,
      },
    };
  } catch {
    return null;
  }
}

/**
 * 单层扫描目录（不递归），供文件树逐层懒加载：children 留空由前端展开时逐层拉取。
 * 文章库（dogear/articles）内的 .md 按 frontmatter 识别为文章节点（带元数据行），
 * 伴随 .raw.html 不单独列（跟随 md 增删改名）；frontmatter 缺损的 md 降级普通文件显示
 */
export async function scanDirectoryLevel(workspacePath: string, relPath: string): Promise<WorkspaceFileNode[]> {
  const dirAbsPath = resolveAndValidate(workspacePath, relPath);
  try {
    const entries = await fs.readdir(dirAbsPath, { withFileTypes: true });
    const nodes: WorkspaceFileNode[] = [];

    for (const entry of entries) {
      if (HIDDEN_NAMES.includes(entry.name) || entry.name.startsWith('.')) continue;

      const childRelPath = path.relative(workspacePath, path.join(dirAbsPath, entry.name)).replace(/\\/g, '/');
      if (entry.isDirectory()) {
        nodes.push({ name: entry.name, path: childRelPath, type: 'directory' });
      } else if (isArticlesRelPath(childRelPath)) {
        const lowerName = entry.name.toLowerCase();
        if (lowerName.endsWith('.raw.html')) continue;
        if (lowerName.endsWith('.md')) {
          const articleNode = await readArticleNode(path.join(dirAbsPath, entry.name), childRelPath, entry.name);
          if (articleNode) {
            nodes.push(articleNode);
            continue;
          }
        }
        nodes.push({ name: entry.name, path: childRelPath, type: 'file', ext: path.extname(entry.name).toLowerCase() });
      } else {
        nodes.push({ name: entry.name, path: childRelPath, type: 'file', ext: path.extname(entry.name).toLowerCase() });
      }
    }

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

export interface CollectedWorkspacePath {
  path: string;
  isDir: boolean;
}

/**
 * 并行收集工作区全部文件/目录相对路径（供工作区搜索索引）。
 * 忽略 `.` 开头项、node_modules、快照排除清单；50k 条上限 + 3s 超时兜底（超限截断不抛错，truncated 标记）
 */
export async function collectWorkspacePaths(workspacePath: string, excludedPaths?: ReadonlySet<string>): Promise<{ entries: CollectedWorkspacePath[]; truncated: boolean }> {
  const COLLECT_CAP = 50_000;
  const COLLECT_TIMEOUT_MS = 3000;
  const SCAN_IGNORE_DIRS = new Set(['node_modules']);
  const BATCH_SIZE = 16;
  const out: CollectedWorkspacePath[] = [];
  const deadline = Date.now() + COLLECT_TIMEOUT_MS;

  async function walk(dirAbsPath: string, relPrefix: string): Promise<void> {
    if (out.length >= COLLECT_CAP || Date.now() > deadline) return;
    let entries: Dirent[];
    try {
      entries = await fs.readdir(dirAbsPath, { withFileTypes: true });
    } catch {
      return;
    }
    const dirs: Dirent[] = [];
    for (const entry of entries) {
      if (out.length >= COLLECT_CAP || Date.now() > deadline) break;
      if (HIDDEN_NAMES.includes(entry.name) || entry.name.startsWith('.') || SCAN_IGNORE_DIRS.has(entry.name)) continue;
      const rel = relPrefix ? `${relPrefix}/${entry.name}` : entry.name;
      if (excludedPaths?.has(rel)) continue;
      const isDir = entry.isDirectory();
      out.push({ path: rel, isDir });
      if (isDir) dirs.push(entry);
    }
    for (let i = 0; i < dirs.length; i += BATCH_SIZE) {
      if (out.length >= COLLECT_CAP || Date.now() > deadline) break;
      await Promise.all(dirs.slice(i, i + BATCH_SIZE).map(entry =>
        walk(path.join(dirAbsPath, entry.name), relPrefix ? `${relPrefix}/${entry.name}` : entry.name),
      ));
    }
  }

  await walk(workspacePath, '');
  return { entries: out, truncated: out.length >= COLLECT_CAP || Date.now() > deadline };
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
  if (!resolveWithinRoots(roots, relPath)) {
    throw new Error('路径越权：不允许访问工作区外的文件');
  }
  const safePath = await resolveExistingWithinRoots(roots, relPath);
  if (!safePath) {
    throw new Error(`文件不存在: ${relPath}`);
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
