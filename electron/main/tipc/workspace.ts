// electron/main/tipc/workspace.ts
import { tipc } from '@egoist/tipc/main';
import electron from 'electron';
const { dialog } = electron;
import { dbWorkspaces, dbBooks } from '../database/index.js';
import { v4 as uuidv4 } from 'uuid';
import fs from 'fs/promises';

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

        const allBooks = dbBooks.getAll();
        const files = allBooks
          .filter(book => book.workspace_id === input.workspaceId)
          .map(book => ({
            name: book.title,
            path: book.id,
            type: 'file' as const,
            ext: '.' + (book.file_type || 'txt'),
            bookId: book.id,
            originalFilePath: book.original_file_path,
          }));
        return { files };
      } catch (error) {
        console.error('获取工作区文件失败:', error);
        return { files: [], error: String(error) };
      }
    }),
};
