/**
 * 书籍相关 IPC 处理器
 * 处理数据库和书籍内容相关的 IPC 请求
 */

import { ipcMain, shell } from 'electron';
import { dbBooks } from '../database/index.js';
import * as bookService from '../services/book-service.js';
import * as workspaceService from '../services/workspace-service.js';

/**
 * 注册所有书籍相关的 IPC 处理器
 */
export function registerBookHandlers() {
  /**
   * 获取所有书籍列表
   */
  ipcMain.handle('db:getBooks', () => {
    return dbBooks.getAll();
  });

  /**
   * 根据 ID 获取单本书籍信息
   */
  ipcMain.handle('db:getBookById', (_, id: string) => {
    return dbBooks.getById(id);
  });

  /**
   * 添加新书籍到数据库
   */
  ipcMain.handle('db:addBook', (_, book) => {
    return dbBooks.add(book);
  });

  /**
   * 更新书籍信息
   */
  ipcMain.handle('db:updateBook', (_, id: string, data) => {
    return dbBooks.update(id, data);
  });

  /**
   * 删除书籍
   */
  ipcMain.handle('db:deleteBook', (_, id: string) => {
    return dbBooks.delete(id);
  });

  /**
   * 获取书籍的章节元数据列表(不含 content,用于目录导航)
   */
  ipcMain.handle('book:getChapterMetadata', async (_, bookId: string) => {
    return bookService.getChapterMetadata(bookId);
  });

  /**
   * 获取指定章节的完整内容(包含 content)
   */
  ipcMain.handle('book:getChapter', async (_, chapterId: string) => {
    return bookService.getChapter(chapterId);
  });

  /**
   * 保存阅读进度
   */
  ipcMain.handle('book:saveProgress', async (_, bookId: string, chapterId: string) => {
    return bookService.saveReadingProgress(bookId, chapterId);
  });

  /**
   * 根据文件路径获取书籍信息
   * 支持：
   * 1. 通过 bookId 直接查找（优先）
   * 2. 通过文件路径匹配（file_path 或 original_file_path）
   * 3. 通过书名匹配（去除扩展名后）
   */
  ipcMain.handle('book:getBookByFilePath', async (_, filePathOrBookId: string) => {
    const books = dbBooks.getAll();

    // 首先尝试作为 bookId 查找
    const byId = books.find(book => book.id === filePathOrBookId);
    if (byId) {
      return byId;
    }

    // 然后尝试通过文件路径匹配
    const byPath = books.find(book => book.file_path === filePathOrBookId || book.original_file_path === filePathOrBookId);
    if (byPath) {
      return byPath;
    }

    // 最后尝试通过书名匹配（去除扩展名）
    const path = await import('path');
    const baseName = path.basename(filePathOrBookId, path.extname(filePathOrBookId));
    const byTitle = books.find(book => book.title === baseName);
    if (byTitle) {
      return byTitle;
    }

    return undefined;
  });

  /**
   * 获取书籍在工作区中的文件路径（绝对路径）
   */
  ipcMain.handle('book:getWorkspaceFilePath', async (_, bookId: string) => {
    try {
      const book = dbBooks.getById(bookId);
      if (!book) {
        return { path: null, error: '书籍不存在' };
      }

      // 获取当前工作区
      const workspace = await workspaceService.getCurrentWorkspace();
      if (!workspace) {
        return { path: null, error: '未设置默认工作区' };
      }

      // 使用 file_path 获取工作区中的绝对路径
      const workspaceFilePath = await workspaceService.getBookFilePath(workspace, bookId, book.file_path);

      return { path: workspaceFilePath };
    } catch (error) {
      return { path: null, error: String(error) };
    }
  });

  /**
   * 在文件管理器中打开书籍所在目录
   */
  ipcMain.handle('book:openInFolder', async (_, bookId: string) => {
    try {
      // 获取当前工作区
      const workspace = await workspaceService.getCurrentWorkspace();
      if (!workspace) {
        return { success: false, error: '未设置默认工作区' };
      }

      const workspaceFilePath = await workspaceService.getBookFilePath(workspace, bookId);
      await shell.openPath(workspaceFilePath);
      return { success: true };
    } catch (error) {
      console.error('打开文件失败:', error);
      return { success: false, error: String(error) };
    }
  });
}
