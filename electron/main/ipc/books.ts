/**
 * 书籍相关 IPC 处理器
 * 处理数据库和书籍内容相关的 IPC 请求
 */

import { ipcMain } from 'electron';
import { dbBooks } from '../database/index.js';
import * as bookService from '../services/book-service.js';

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
}
