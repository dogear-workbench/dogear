# 工作区资源管理器 Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 将左侧文章列表升级为完整的工作区文件浏览器，支持文件夹分类和文件管理操作

**Architecture:** 后端通过文件系统扫描构建树形结构（文章树 + 普通文件树合并），前端用统一的 WorkspaceExplorer 组件渲染，右键菜单提供 CRUD 操作。`.dogear` 目录隐藏，`.dogear/articles/` 内容提升到顶层作为文章区域。

**Tech Stack:** Electron (fs) / Next.js 16 / React 19 / Zustand 5 / @egoist/tipc / shadcn/ui + Radix UI / lucide-react

---

### Task 1: 扩展 WorkspaceFileNode 类型

**Files:**
- Modify: `types/electron-api.ts:25-33`

**Step 1: 更新 WorkspaceFileNode 接口**

在 `types/electron-api.ts` 中修改 `WorkspaceFileNode`：

```typescript
/**
 * 工作区文件节点
 */
export interface WorkspaceFileNode {
  name: string;
  path: string;
  type: 'file' | 'directory' | 'article';
  ext?: string;
  children?: WorkspaceFileNode[];
  /** 书籍 ID（type='file' 且为已导入书籍时存在） */
  bookId?: string;
  /** 文章专属字段（type='article' 时存在） */
  articleMeta?: {
    id: string;
    url: string;
    siteName: string | null;
    fetchedAt: number;
    wordCount: number;
  };
}
```

**Step 2: 构建验证**

Run: `cd c:/dogear && npm run build:electron`
Expected: 编译成功（可能有使用处的类型警告，后续步骤修复）

**Step 3: Commit**

```bash
git add types/electron-api.ts
git commit -m "feat: extend WorkspaceFileNode type with article support"
```

---

### Task 2: 新增 workspace-fs-service.ts（工作区文件操作服务）

**Files:**
- Create: `electron/main/services/workspace-fs-service.ts`

**Step 1: 实现工作区文件系统扫描和 CRUD**

创建 `electron/main/services/workspace-fs-service.ts`：

```typescript
/**
 * 工作区文件系统服务
 * 提供工作区级别的文件操作（扫描、创建、重命名、移动、复制、删除）
 * 所有操作限定在工作区目录内，防止越权访问
 */
import fs from 'fs/promises';
import path from 'path';
import type { WorkspaceFileNode } from '../../types/electron-api.js';

/** 隐藏的目录/文件名（不在文件树中显示） */
const HIDDEN_NAMES = ['.dogear', '.DS_Store', 'Thumbs.db', '.git'];

/**
 * 路径安全校验：确保目标路径在工作区范围内
 * @param workspacePath - 工作区绝对路径
 * @param targetPath - 待校验的相对路径
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
 * @param workspacePath - 工作区绝对路径
 * @returns 文件树节点数组
 */
export async function scanWorkspaceFiles(workspacePath: string): Promise<WorkspaceFileNode[]> {
  return scanDirectory(workspacePath, workspacePath);
}

async function scanDirectory(dirPath: string, workspacePath: string): Promise<WorkspaceFileNode[]> {
  try {
    const entries = await fs.readdir(dirPath, { withFileTypes: true });
    const nodes: WorkspaceFileNode[] = [];

    for (const entry of entries) {
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
  // 二次校验新路径也在工作区内
  resolveAndValidate(workspacePath, path.relative(workspacePath, newFolderPath));
  await fs.mkdir(newFolderPath, { recursive: true });
}

/**
 * 重命名文件或文件夹
 */
export async function renameItem(workspacePath: string, itemRelPath: string, newName: string): Promise<void> {
  const oldAbsPath = resolveAndValidate(workspacePath, itemRelPath);
  const newAbsPath = path.join(path.dirname(oldAbsPath), newName);
  resolveAndValidate(workspacePath, path.relative(workspacePath, newAbsPath));
  await fs.rename(oldAbsPath, newAbsPath);
}

/**
 * 移动文件或文件夹
 */
export async function moveItem(workspacePath: string, sourceRelPath: string, targetFolderRelPath: string): Promise<void> {
  const sourceAbsPath = resolveAndValidate(workspacePath, sourceRelPath);
  const targetFolderAbsPath = resolveAndValidate(workspacePath, targetFolderRelPath);
  const itemName = path.basename(sourceAbsPath);
  const targetAbsPath = path.join(targetFolderAbsPath, itemName);
  resolveAndValidate(workspacePath, path.relative(workspacePath, targetAbsPath));
  await fs.rename(sourceAbsPath, targetAbsPath);
}

/**
 * 复制文件或文件夹
 */
export async function copyItem(workspacePath: string, sourceRelPath: string, targetFolderRelPath: string): Promise<void> {
  const sourceAbsPath = resolveAndValidate(workspacePath, sourceRelPath);
  const targetFolderAbsPath = resolveAndValidate(workspacePath, targetFolderRelPath);
  const itemName = path.basename(sourceAbsPath);
  const targetAbsPath = path.join(targetFolderAbsPath, itemName);
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
```

**Step 2: 构建验证**

Run: `cd c:/dogear && npm run build:electron`
Expected: 编译成功

**Step 3: Commit**

```bash
git add electron/main/services/workspace-fs-service.ts
git commit -m "feat: add workspace filesystem service with CRUD operations"
```

---

### Task 3: 改造 article-service.ts（树形扫描 + 文件夹 CRUD）

**Files:**
- Modify: `electron/main/services/article-service.ts:230-257`

**Step 1: 新增 listArticleTree 函数和文件夹操作函数**

在 `article-service.ts` 末尾（`deleteArticle` 函数之后）追加以下代码：

```typescript
/**
 * 递归扫描 .dogear/articles/ 目录，构建文章树
 * - 含 meta.json 的目录识别为文章节点（显示标题而非 UUID）
 * - 其他目录识别为分类文件夹
 * @param workspacePath - 工作区绝对路径
 * @returns 文章树节点数组
 */
export async function listArticleTree(workspacePath: string): Promise<WorkspaceFileNode[]> {
  const articlesDir = path.join(workspacePath, ARTICLES_DIR);
  return scanArticleDirectory(articlesDir, workspacePath);
}

async function scanArticleDirectory(dirPath: string, workspacePath: string): Promise<WorkspaceFileNode[]> {
  try {
    const entries = await fs.readdir(dirPath, { withFileTypes: true });
    const nodes: WorkspaceFileNode[] = [];

    for (const entry of entries) {
      // 跳过隐藏文件（如 .folders.json）和非目录
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
          },
        });
      } catch {
        // 没有 meta.json → 是分类文件夹，递归扫描
        const children = await scanArticleDirectory(fullPath, workspacePath);
        nodes.push({
          name: entry.name,
          path: relativePath,
          type: 'directory' as const,
          children,
        });
      }
    }

    // 文件夹在前，文章在后；文章按 fetchedAt 倒序
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
}

/**
 * 移动文章或文件夹到目标分类文件夹
 */
export async function moveArticleItem(
  workspacePath: string,
  sourceRelPath: string,
  targetFolderRelPath: string
): Promise<void> {
  const sourceAbsPath = path.join(workspacePath, sourceRelPath);
  const targetFolderAbsPath = path.join(workspacePath, targetFolderRelPath);
  const itemName = path.basename(sourceAbsPath);
  const targetAbsPath = path.join(targetFolderAbsPath, itemName);
  await fs.rename(sourceAbsPath, targetAbsPath);
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
  await fs.rename(oldAbsPath, newAbsPath);
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
}
```

同时在文件顶部添加导入（在现有 import 之后）：

```typescript
import type { WorkspaceFileNode } from '../../types/electron-api.js';
```

**Step 2: 构建验证**

Run: `cd c:/dogear && npm run build:electron`
Expected: 编译成功

**Step 3: Commit**

```bash
git add electron/main/services/article-service.ts
git commit -m "feat: add article tree scanning and folder CRUD to article-service"
```

---

### Task 4: 改造 IPC 路由（getFiles → getWorkspaceTree + 新增文件操作路由）

**Files:**
- Modify: `electron/main/tipc/workspace.ts:82-105`
- Modify: `electron/main/tipc/index.ts`
- Create: `electron/main/tipc/explorer.ts`

**Step 1: 改造 workspace.ts 中的 getFiles**

将 `workspace.ts` 第 82-105 行的 `getFiles` handler 替换为：

```typescript
  getFiles: t.procedure
    .input<{ workspaceId: string }>()
    .action(async ({ input }) => {
      try {
        const workspace = dbWorkspaces.getById(input.workspaceId);
        if (!workspace) return { files: [], error: '工作区不存在' };

        // 1. 扫描文章树（.dogear/articles/）
        const articleTree = await articleService.listArticleTree(workspace.path);

        // 2. 扫描工作区普通文件（排除 .dogear）
        const workspaceFiles = await workspaceFsService.scanWorkspaceFiles(workspace.path);

        // 3. 为书籍文件附加 bookId
        const allBooks = dbBooks.getAll().filter(b => b.workspace_id === input.workspaceId);
        const booksByDir = new Map(allBooks.map(b => [b.id, b]));
        attachBookIds(workspaceFiles, booksByDir);

        // 4. 合并：文章树在前，普通文件在后
        return { files: [...articleTree, ...workspaceFiles] };
      } catch (error) {
        console.error('获取工作区文件树失败:', error);
        return { files: [], error: String(error) };
      }
    }),
```

在 `workspace.ts` 顶部添加导入：

```typescript
import * as articleService from '../services/article-service.js';
import * as workspaceFsService from '../services/workspace-fs-service.js';
```

并在文件末尾（`workspaceRouter` 之外）添加辅助函数：

```typescript
import type { WorkspaceFileNode } from '../../types/electron-api.js';

/** 递归遍历文件树，为匹配 bookId 的目录附加 bookId 字段 */
function attachBookIds(
  nodes: WorkspaceFileNode[],
  booksByDir: Map<string, any>
): void {
  for (const node of nodes) {
    if (node.type === 'directory') {
      // 检查目录名是否是 book ID
      const dirName = node.path.split('/')[0];
      const book = booksByDir.get(dirName);
      if (book) {
        node.bookId = book.id;
        node.name = book.title; // 用书名替代 UUID 目录名
      }
      if (node.children) {
        attachBookIds(node.children, booksByDir);
      }
    }
  }
}
```

**Step 2: 创建 explorer.ts 路由（文件操作）**

创建 `electron/main/tipc/explorer.ts`：

```typescript
// electron/main/tipc/explorer.ts
import { tipc } from '@egoist/tipc/main';
import electron from 'electron';
const { shell } = electron;
import { dbWorkspaces } from '../database/index.js';
import * as workspaceFsService from '../services/workspace-fs-service.js';
import * as articleService from '../services/article-service.js';

const t = tipc.create();

export const explorerRouter = {
  /** 创建文件夹 */
  createFolder: t.procedure
    .input<{ workspaceId: string; parentPath: string; name: string }>()
    .action(async ({ input }) => {
      try {
        const workspace = dbWorkspaces.getById(input.workspaceId);
        if (!workspace) return { error: '工作区不存在' };

        const isArticleFolder = input.parentPath.startsWith('.dogear/articles');
        if (isArticleFolder) {
          await articleService.createArticleFolder(workspace.path, input.parentPath, input.name);
        } else {
          await workspaceFsService.createFolder(workspace.path, input.parentPath, input.name);
        }
        return { success: true };
      } catch (error) {
        console.error('创建文件夹失败:', error);
        return { error: String(error) };
      }
    }),

  /** 重命名文件或文件夹 */
  renameItem: t.procedure
    .input<{ workspaceId: string; itemPath: string; newName: string }>()
    .action(async ({ input }) => {
      try {
        const workspace = dbWorkspaces.getById(input.workspaceId);
        if (!workspace) return { error: '工作区不存在' };

        const isArticlePath = input.itemPath.startsWith('.dogear/articles');
        if (isArticlePath) {
          await articleService.renameArticleFolder(workspace.path, input.itemPath, input.newName);
        } else {
          await workspaceFsService.renameItem(workspace.path, input.itemPath, input.newName);
        }
        return { success: true };
      } catch (error) {
        console.error('重命名失败:', error);
        return { error: String(error) };
      }
    }),

  /** 移动文件或文件夹 */
  moveItem: t.procedure
    .input<{ workspaceId: string; sourcePath: string; targetPath: string }>()
    .action(async ({ input }) => {
      try {
        const workspace = dbWorkspaces.getById(input.workspaceId);
        if (!workspace) return { error: '工作区不存在' };

        const isArticlePath = input.sourcePath.startsWith('.dogear/articles');
        if (isArticlePath) {
          await articleService.moveArticleItem(workspace.path, input.sourcePath, input.targetPath);
        } else {
          await workspaceFsService.moveItem(workspace.path, input.sourcePath, input.targetPath);
        }
        return { success: true };
      } catch (error) {
        console.error('移动失败:', error);
        return { error: String(error) };
      }
    }),

  /** 复制文件或文件夹 */
  copyItem: t.procedure
    .input<{ workspaceId: string; sourcePath: string; targetPath: string }>()
    .action(async ({ input }) => {
      try {
        const workspace = dbWorkspaces.getById(input.workspaceId);
        if (!workspace) return { error: '工作区不存在' };

        await workspaceFsService.copyItem(workspace.path, input.sourcePath, input.targetPath);
        return { success: true };
      } catch (error) {
        console.error('复制失败:', error);
        return { error: String(error) };
      }
    }),

  /** 删除文件或文件夹 */
  deleteItem: t.procedure
    .input<{ workspaceId: string; itemPath: string }>()
    .action(async ({ input }) => {
      try {
        const workspace = dbWorkspaces.getById(input.workspaceId);
        if (!workspace) return { error: '工作区不存在' };

        const isArticlePath = input.itemPath.startsWith('.dogear/articles');
        if (isArticlePath) {
          await articleService.deleteArticleFolder(workspace.path, input.itemPath);
        } else {
          await workspaceFsService.deleteItem(workspace.path, input.itemPath);
        }
        return { success: true };
      } catch (error) {
        console.error('删除失败:', error);
        return { error: String(error) };
      }
    }),

  /** 在系统文件管理器中打开 */
  openInExplorer: t.procedure
    .input<{ workspaceId: string; itemPath: string }>()
    .action(async ({ input }) => {
      try {
        const workspace = dbWorkspaces.getById(input.workspaceId);
        if (!workspace) return { error: '工作区不存在' };

        const absPath = workspaceFsService.resolveAndValidate(workspace.path, input.itemPath);
        await shell.openPath(absPath);
        return { success: true };
      } catch (error) {
        console.error('打开文件管理器失败:', error);
        return { error: String(error) };
      }
    }),
};
```

**Step 3: 注册 explorerRouter**

在 `electron/main/tipc/index.ts` 中添加导入和注册：

```typescript
import { explorerRouter } from './explorer.js';

export const router = {
  ...dbRouter,
  ...bookRouter,
  ...aiRouter,
  ...fileRouter,
  ...workspaceRouter,
  ...agentRouter,
  ...conversationsRouter,
  ...articleRouter,
  ...explorerRouter,
};
```

**Step 4: 构建验证**

Run: `cd c:/dogear && npm run build:electron`
Expected: 编译成功

**Step 5: Commit**

```bash
git add electron/main/tipc/workspace.ts electron/main/tipc/explorer.ts electron/main/tipc/index.ts
git commit -m "feat: add workspace tree API and file explorer CRUD routes"
```

---

### Task 5: 改造 workspace-store.ts（新增文件操作 actions）

**Files:**
- Modify: `stores/workspace-store.ts`

**Step 1: 扩展 WorkspaceState 接口和实现**

改造 `stores/workspace-store.ts`，在现有接口中追加以下状态和 actions：

接口新增：
```typescript
  // 新增状态
  expandedPaths: string[];

  // 新增 Actions
  /** 创建文件夹 */
  createFolder: (parentPath: string, name: string) => Promise<void>;
  /** 重命名文件/文件夹 */
  renameItem: (itemPath: string, newName: string) => Promise<void>;
  /** 移动文件/文件夹 */
  moveItem: (sourcePath: string, targetPath: string) => Promise<void>;
  /** 复制文件/文件夹 */
  copyItem: (sourcePath: string, targetPath: string) => Promise<void>;
  /** 删除文件/文件夹 */
  deleteItem: (itemPath: string) => Promise<void>;
  /** 切换文件夹展开状态 */
  toggleExpand: (path: string) => void;
  /** 在系统文件管理器中打开 */
  openInExplorer: (itemPath: string) => Promise<void>;
```

实现新增（在 create 回调中追加）：
```typescript
  expandedPaths: [],

  createFolder: async (parentPath, name) => {
    const { workspace } = get();
    if (!workspace) return;
    try {
      const result = await client.createFolder({ workspaceId: workspace.id, parentPath, name });
      if (result.error) { alert(`创建失败: ${result.error}`); return; }
      await get().loadWorkspaceFiles();
    } catch (error) {
      console.error('创建文件夹失败:', error);
      alert(`创建失败: ${error instanceof Error ? error.message : String(error)}`);
    }
  },

  renameItem: async (itemPath, newName) => {
    const { workspace } = get();
    if (!workspace) return;
    try {
      const result = await client.renameItem({ workspaceId: workspace.id, itemPath, newName });
      if (result.error) { alert(`重命名失败: ${result.error}`); return; }
      await get().loadWorkspaceFiles();
    } catch (error) {
      console.error('重命名失败:', error);
      alert(`重命名失败: ${error instanceof Error ? error.message : String(error)}`);
    }
  },

  moveItem: async (sourcePath, targetPath) => {
    const { workspace } = get();
    if (!workspace) return;
    try {
      const result = await client.moveItem({ workspaceId: workspace.id, sourcePath, targetPath });
      if (result.error) { alert(`移动失败: ${result.error}`); return; }
      await get().loadWorkspaceFiles();
    } catch (error) {
      console.error('移动失败:', error);
      alert(`移动失败: ${error instanceof Error ? error.message : String(error)}`);
    }
  },

  copyItem: async (sourcePath, targetPath) => {
    const { workspace } = get();
    if (!workspace) return;
    try {
      const result = await client.copyItem({ workspaceId: workspace.id, sourcePath, targetPath });
      if (result.error) { alert(`复制失败: ${result.error}`); return; }
      await get().loadWorkspaceFiles();
    } catch (error) {
      console.error('复制失败:', error);
      alert(`复制失败: ${error instanceof Error ? error.message : String(error)}`);
    }
  },

  deleteItem: async (itemPath) => {
    const { workspace } = get();
    if (!workspace) return;
    if (!confirm('确定要删除吗？此操作不可恢复。')) return;
    try {
      const result = await client.deleteItem({ workspaceId: workspace.id, itemPath });
      if (result.error) { alert(`删除失败: ${result.error}`); return; }
      await get().loadWorkspaceFiles();
    } catch (error) {
      console.error('删除失败:', error);
      alert(`删除失败: ${error instanceof Error ? error.message : String(error)}`);
    }
  },

  toggleExpand: (nodePath) => {
    const { expandedPaths } = get();
    if (expandedPaths.includes(nodePath)) {
      set({ expandedPaths: expandedPaths.filter(p => p !== nodePath) });
    } else {
      set({ expandedPaths: [...expandedPaths, nodePath] });
    }
  },

  openInExplorer: async (itemPath) => {
    const { workspace } = get();
    if (!workspace) return;
    try {
      await client.openInExplorer({ workspaceId: workspace.id, itemPath });
    } catch (error) {
      console.error('打开文件管理器失败:', error);
    }
  },
```

**Step 2: 构建验证**

Run: `cd c:/dogear && npm run build:electron`
Expected: 编译成功（前端代码 Next.js 也应通过）

**Step 3: Commit**

```bash
git add stores/workspace-store.ts
git commit -m "feat: add file explorer CRUD actions to workspace store"
```

---

### Task 6: 精简 article-store.ts

**Files:**
- Modify: `stores/article-store.ts`

**Step 1: 移除文章列表状态，保留选中和导入逻辑**

改造 `stores/article-store.ts`：

1. 从接口中移除 `articles: ArticleMeta[]` 和 `loadingArticles: boolean` 和 `loadArticles()`
2. 从实现中移除对应的状态初始值和 action 实现
3. `deleteArticle` 改为调用 `client.deleteItem` 而不是 `client.deleteArticle`，删除后调用 `loadWorkspaceFiles()` 刷新树
4. 保留：`selectedArticle`、`selectArticle()`、`clearSelectedArticle()`、URL 输入相关所有状态和 actions

注意：`workspace-store.ts` 的 `setWorkspace` 中原本调用 `useArticleStore.getState().loadArticles()`，需要移除该行。

**Step 2: 更新 workspace-store.ts 的 setWorkspace**

在 `workspace-store.ts` 的 `setWorkspace` 方法中，移除对 `loadArticles` 的调用（第 56-58 行）。文章现在作为文件树的一部分由 `loadWorkspaceFiles` 一起加载。

**Step 3: 构建验证**

Run: `cd c:/dogear && npm run build:electron`
Expected: 编译成功

**Step 4: Commit**

```bash
git add stores/article-store.ts stores/workspace-store.ts
git commit -m "refactor: simplify article-store, remove list state (now in workspace tree)"
```

---

### Task 7: 安装 shadcn/ui context-menu 组件

**Files:**
- Create: `components/ui/context-menu.tsx`

**Step 1: 添加 context-menu 组件**

Run: `cd c:/dogear && npx shadcn@latest add context-menu`

如果 CLI 交互不可用，手动创建 `components/ui/context-menu.tsx`，内容从 shadcn/ui 官方源码获取（基于 `@radix-ui/react-context-menu`）。

确认 `radix-ui` 包已安装（当前项目使用 `radix-ui@^1.4.3` 统一包，应包含 context-menu）。

**Step 2: 构建验证**

Run: `cd c:/dogear && npm run build:electron`
Expected: 编译成功

**Step 3: Commit**

```bash
git add components/ui/context-menu.tsx package.json package-lock.json
git commit -m "feat: add shadcn context-menu component"
```

---

### Task 8: 新建 WorkspaceExplorer 组件

**Files:**
- Create: `components/WorkspaceExplorer.tsx`

**Step 1: 实现 WorkspaceExplorer 组件**

创建 `components/WorkspaceExplorer.tsx`，包含：

1. **工具栏区域**：新建文件夹按钮 + 刷新按钮（导入文章/书籍按钮保留在顶部 header）
2. **树形节点渲染**（递归 `ExplorerNode` 子组件）：
   - 根据 `node.type` 渲染不同图标和样式
   - `article` 节点：Globe 图标 + 标题 + 站点名/时间副文本
   - `directory` 节点：FolderOpen/Folder 图标 + 展开/折叠
   - `file` 节点：File/BookOpen 图标（根据扩展名）
   - 点击行为：article → `selectArticle()`，file → `selectFile()`，directory → `toggleExpand()`
3. **分隔线**：文章区域和普通文件区域之间
4. **右键菜单**：使用 shadcn ContextMenu，根据节点类型显示不同菜单项
5. **内联重命名**：点击重命名后，节点名称变为 input，回车确认，Escape 取消
6. **新建文件夹对话框**：简单的 prompt 或内联 input

组件从 store 获取数据：
- `useWorkspaceStore` → `files`, `expandedPaths`, `toggleExpand`, `loadWorkspaceFiles`, `selectFile`, `createFolder`, `renameItem`, `moveItem`, `copyItem`, `deleteItem`, `openInExplorer`
- `useArticleStore` → `selectedArticle`, `selectArticle`
- `useReferenceStore` → `toggleReferenceArticle`

**关键实现细节：**
- 文章区域和文件区域的分割：遍历顶层 `files` 数组，`path.startsWith('.dogear/articles')` 的为文章区域，其余为文件区域
- 空状态：文章区域为空时显示"暂无文章"，文件区域为空时显示"暂无文件"
- "移动到文件夹..."操作：弹出简单的文件夹选择列表（只列出当前区域的 directory 节点）

**Step 2: 构建验证**

Run: `cd c:/dogear && npm run build:electron`
Expected: 编译成功

**Step 3: Commit**

```bash
git add components/WorkspaceExplorer.tsx
git commit -m "feat: add WorkspaceExplorer component with tree view and context menu"
```

---

### Task 9: 改造 page.tsx（集成 WorkspaceExplorer）

**Files:**
- Modify: `app/page.tsx`

**Step 1: 替换 ArticleList 为 WorkspaceExplorer**

在 `app/page.tsx` 中：

1. 移除 `ArticleList` 导入，添加 `WorkspaceExplorer` 导入
2. 将左侧边栏的"文章列表区域"（第 135-144 行）替换为 `WorkspaceExplorer`
3. 移除顶部 header 中 `articles.length` 相关的引用
4. 移除不再使用的 article-store selectors（`articles`、`loadingArticles` 等已在 Task 6 移除）

左侧边栏改造后：
```tsx
<aside className="w-64 border-r bg-muted/30 flex flex-col">
  {/* 对话列表区域 */}
  <div className="p-3 border-b">
    <h2 className="text-sm font-semibold">对话列表</h2>
  </div>
  <div className="flex-1 overflow-hidden">
    <ConversationList />
  </div>

  {/* 工作区资源管理器 */}
  <div className="border-t flex-1 flex flex-col overflow-hidden">
    <WorkspaceExplorer />
  </div>
</aside>
```

注意：左侧边栏布局需要调整为对话列表和资源管理器各占一半空间（都设 `flex-1`），或者资源管理器使用可调节高度。第一版先让对话列表固定、资源管理器占据剩余空间。

**Step 2: 清理无用组件引用**

确认 `ArticleList` 组件不再被任何地方引用后，可以保留文件（后续可删除），也可以直接删除 `components/ArticleList.tsx`。

**Step 3: 构建验证**

Run: `cd c:/dogear && npm run build:electron`
Expected: 编译成功

**Step 4: 完整运行验证**

Run: `cd c:/dogear && npm run dev`
Expected: 应用启动，左侧边栏显示工作区资源管理器，文章和文件以树形结构展示

**Step 5: Commit**

```bash
git add app/page.tsx
git commit -m "feat: integrate WorkspaceExplorer into main layout, replace ArticleList"
```

---

### Task 10: 清理和收尾

**Files:**
- Delete: `components/ArticleList.tsx`（确认无引用后）
- Review: `components/file-tree.tsx`（确认是否仍被其他地方使用，如果只有旧的 workspace 文件显示用，可以删除）

**Step 1: 清理无用文件**

确认 `ArticleList.tsx` 和 `file-tree.tsx` 不再被引用后删除。

**Step 2: 最终构建验证**

Run: `cd c:/dogear && npm run build:electron`
Expected: 编译成功，无未使用的导入警告

**Step 3: Commit**

```bash
git add -A
git commit -m "chore: remove unused ArticleList and file-tree components"
```
