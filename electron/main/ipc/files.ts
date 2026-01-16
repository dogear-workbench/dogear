/**
 * 文件相关 IPC 处理器
 * 处理文件选择和书籍导入相关的 IPC 请求
 */

import { ipcMain } from 'electron';
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
   */
  ipcMain.handle('file:importBook', async (_, filePath: string) => {
    return bookService.importBook(filePath);
  });
}
