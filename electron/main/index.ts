import { app, BrowserWindow, ipcMain } from 'electron';
import * as path from 'path';
import { dbBooks, dbAI } from '../main/database/index.js';
import * as bookService from './services/book-service.js';
import * as aiService from './services/ai-service.js';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

// 获取当前文件的路径和目录名(ES Module 环境)
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// 判断是否为开发环境
const isDev = process.env.NODE_ENV === 'development';

// 主窗口实例
let mainWindow: BrowserWindow | null = null;

/**
 * 创建 Electron 主窗口
 * 配置窗口属性、加载页面并根据环境决定是否打开开发者工具
 */
function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: {
      // 预加载脚本路径
      preload: path.join(__dirname, '../preload/index.js'),
      // 启用上下文隔离,提高安全性
      contextIsolation: true,
      // 禁用 Node.js 集成,提高安全性
      nodeIntegration: false,
    },
  });

  // 根据环境加载不同的页面
  if (isDev) {
    // 开发环境:加载 Next.js 开发服务器
    mainWindow.loadURL('http://localhost:3000');
    // 打开开发者工具
    mainWindow.webContents.openDevTools();
  } else {
    // 生产环境:加载构建后的静态文件
    mainWindow.loadFile(path.join(__dirname, '../../out/index.html'));
  }
}

// 当 Electron 完成初始化时创建窗口
app.whenReady().then(() => {
  createWindow();

  // 当应用被激活时(如在 macOS 上点击 Dock 图标)
  // 如果没有其他窗口打开,则创建新窗口
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

// 当所有窗口都关闭时退出应用(在 macOS 上除外)
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

// ==================== IPC 通信处理器 ====================

// 数据库相关操作
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

// AI 相关操作
/**
 * AI 对话接口
 */
ipcMain.handle('ai:chat', async (_, messages) => {
  return aiService.chat(messages);
});

/**
 * AI 文本摘要接口
 */
ipcMain.handle('ai:summarize', async (_, text: string) => {
  return aiService.summarize(text);
});

// 文件相关操作
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

// 书籍内容读取
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
