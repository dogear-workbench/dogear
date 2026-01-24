/**
 * 文件相关 IPC 处理器
 * 处理文件选择和书籍导入相关的 IPC 请求
 */

import { ipcMain, shell } from 'electron';
import * as bookService from '../services/book-service.js';

/**
 * 注册所有文件相关的 IPC 处理器
 */
export function registerFileHandlers() {
  /**
   * 打开文件选择对话框
   */
  ipcMain.handle('file:select', async () => {
    return bookService.selectBookFile();
  });

  /**
   * 导入书籍文件
   * @param filePath - 文件路径
   * @param workspaceId - 工作区 ID（可选，默认使用 'default'）
   */
  ipcMain.handle('file:importBook', async (_, filePath: string, workspaceId?: string) => {
    return bookService.importBook(filePath, workspaceId);
  });

  /**
   * 在文件管理器中打开文件所在目录并选中文件
   */
  ipcMain.handle('file:openInFolder', async (_, filePath: string) => {
    try {
      if (!filePath) {
        return { success: false, error: '文件路径为空' };
      }
      await shell.openPath(filePath);
      return { success: true };
    } catch (error) {
      console.error('打开文件失败:', error);
      return { success: false, error: String(error) };
    }
  });
}