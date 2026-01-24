/**
 * 工作区相关 IPC 处理器
 * 处理工作区选择、创建和查询相关的 IPC 请求
 */

import { ipcMain, dialog } from 'electron';
import { dbWorkspaces, dbBooks } from '../database/index.js';

/**
 * 注册所有工作区相关的 IPC 处理器
 */
export function registerWorkspaceHandlers() {
  /**
   * 获取所有工作区列表
   */
  ipcMain.handle('workspace:getAll', async () => {
    try {
      const workspaces = dbWorkspaces.getAll();
      return { workspaces };
    } catch (error) {
      console.error('获取工作区列表失败:', error);
      return { workspaces: [], error: String(error) };
    }
  });

  /**
   * 获取默认工作区
   * 如果没有默认工作区，返回 null 而不是自动创建
   * 前端应根据返回值决定是显示工作区信息还是提示用户选择
   */
  ipcMain.handle('workspace:getDefault', async () => {
    try {
      const workspace = dbWorkspaces.getDefault();
      // 不再自动创建，返回 null 让前端处理
      return workspace || null;
    } catch (error) {
      console.error('获取默认工作区失败:', error);
      return null;
    }
  });

  /**
   * 打开文件夹选择对话框，创建新工作区
   * 选择的工作区会自动设置为默认工作区
   */
  ipcMain.handle('workspace:selectFolder', async () => {
    try {
      const result = await dialog.showOpenDialog({
        properties: ['openDirectory'],
        title: '选择工作区文件夹'
      });

      if (result.canceled || result.filePaths.length === 0) {
        return { canceled: true };
      }

      const selectedPath = result.filePaths[0];

      // 检查是否已经存在该路径的工作区
      const existingWorkspaces = dbWorkspaces.getAll();
      const existing = existingWorkspaces.find(w => w.path === selectedPath);

      let workspace: { id: string; name: string; path: string; is_default: number; created_at: number };

      if (existing) {
        // 如果已存在，设置为默认工作区并返回
        dbWorkspaces.setDefault(existing.id);
        workspace = { ...existing, is_default: 1 };
        return { workspace, existed: true };
      }

      // 创建新工作区
      const { v4: uuidv4 } = await import('uuid');
      const newId = uuidv4();
      workspace = {
        id: newId,
        name: selectedPath.split(/[/\\]/).filter(Boolean).pop() || '工作区',
        path: selectedPath,
        is_default: 1,  // 新创建的工作区直接设为默认
        created_at: Date.now()
      };

      dbWorkspaces.add(workspace);

      // 确保工作区目录存在
      const fs = await import('fs/promises');
      await fs.mkdir(selectedPath, { recursive: true });

      return {
        workspace,
        existed: false
      };
    } catch (error) {
      console.error('选择工作区文件夹失败:', error);
      return { error: String(error) };
    }
  });

  /**
   * 设置默认工作区
   */
  ipcMain.handle('workspace:setDefault', async (_, workspaceId: string) => {
    try {
      dbWorkspaces.setDefault(workspaceId);
      return { success: true };
    } catch (error) {
      console.error('设置默认工作区失败:', error);
      return { success: false, error: String(error) };
    }
  });

  /**
   * 获取工作区的书籍列表
   * 返回指定工作区的书籍列表
   */
  ipcMain.handle('workspace:getFiles', async (_, workspaceId: string) => {
    try {
      const workspace = dbWorkspaces.getById(workspaceId);
      if (!workspace) {
        return { files: [], error: '工作区不存在' };
      }

      // 获取数据库中所有书籍，过滤出属于当前工作区的书籍
      const allBooks = dbBooks.getAll();
      const workspaceBooks = allBooks.filter(book => book.workspace_id === workspaceId);

      // 转换为文件节点格式
      const files: any[] = workspaceBooks.map(book => ({
        name: book.title,
        path: book.id,  // 使用 bookId 作为路径
        type: 'file' as const,
        ext: '.' + (book.file_type || 'txt'),
        bookId: book.id,  // 存储书籍 ID
        originalFilePath: book.original_file_path,  // 原始文件路径
      }));

      return { files };
    } catch (error) {
      console.error('获取工作区文件失败:', error);
      return { files: [], error: String(error) };
    }
  });
}
