// electron/main/tipc/workspace.ts
import { tipc } from '@egoist/tipc/main';
import electron from 'electron';
const { dialog } = electron;
import { dbWorkspaces, dbBooks } from '../database/index.js';
import { v4 as uuidv4 } from 'uuid';
import fs from 'fs/promises';
import * as articleService from '../services/article-service.js';
import * as workspaceFsService from '../services/workspace-fs-service.js';
import type { WorkspaceFileNode } from '../types.js';

const t = tipc.create();

export const workspaceRouter = {
  getAll: t.procedure
    .action(async () => {
      try {
        const workspaces = dbWorkspaces.getAll();
        return { workspaces };
      } catch (error) {
        console.error('获取工作区列表失败:', error);
        return { workspaces: [], error: String(error) };
      }
    }),

  getDefault: t.procedure
    .action(async () => {
      try {
        return dbWorkspaces.getDefault() ?? null;
      } catch (error) {
        console.error('获取默认工作区失败:', error);
        return null;
      }
    }),

  selectFolder: t.procedure
    .action(async () => {
      try {
        const result = await dialog.showOpenDialog({
          properties: ['openDirectory'],
          title: '选择工作区文件夹',
        });
        if (result.canceled || result.filePaths.length === 0) return { canceled: true };

        const selectedPath = result.filePaths[0];
        const existingWorkspaces = dbWorkspaces.getAll();
        const existing = existingWorkspaces.find(w => w.path === selectedPath);

        if (existing) {
          dbWorkspaces.setDefault(existing.id);
          return { workspace: { ...existing, is_default: 1 }, existed: true };
        }

        // 创建新工作区
        const workspace = {
          id: uuidv4(),
          name: selectedPath.split(/[/\\]/).filter(Boolean).pop() || '工作区',
          path: selectedPath,
          is_default: 1,
          created_at: Date.now(),
        };
        dbWorkspaces.add(workspace);

        // 确保工作区目录存在
        await fs.mkdir(selectedPath, { recursive: true });
        return { workspace, existed: false };
      } catch (error) {
        console.error('选择工作区文件夹失败:', error);
        return { error: String(error) };
      }
    }),

  setDefault: t.procedure
    .input<{ workspaceId: string }>()
    .action(async ({ input }) => {
      try {
        dbWorkspaces.setDefault(input.workspaceId);
        return { success: true };
      } catch (error) {
        console.error('设置默认工作区失败:', error);
        return { success: false, error: String(error) };
      }
    }),

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

        // 3. 为书籍目录附加 bookId 和书名
        const allBooks = dbBooks.getAll().filter(b => b.workspace_id === input.workspaceId);
        const booksByDir = new Map(allBooks.filter(b => b.id).map(b => [b.id!, b]));
        attachBookIds(workspaceFiles, booksByDir);

        // 4. 合并：文章树在前，普通文件在后
        return { files: [...articleTree, ...workspaceFiles] };
      } catch (error) {
        console.error('获取工作区文件树失败:', error);
        return { files: [], error: String(error) };
      }
    }),
};

/** 递归遍历文件树，为匹配 bookId 的目录附加 bookId 字段 */
function attachBookIds(
  nodes: WorkspaceFileNode[],
  booksByDir: Map<string, any>
): void {
  for (const node of nodes) {
    if (node.type === 'directory') {
      const dirName = node.path.split('/')[0];
      const book = booksByDir.get(dirName);
      if (book) {
        node.bookId = book.id;
        node.name = book.title;
      }
      if (node.children) {
        attachBookIds(node.children, booksByDir);
      }
    }
  }
}
