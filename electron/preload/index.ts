const { contextBridge, ipcRenderer } = require('electron');

/**
 * Electron API 类型定义
 * 定义通过 contextBridge 暴露给渲染进程的 API 接口
 */
interface ElectronAPI {
  // 数据库操作接口
  db: {
    getBooks: () => Promise<any[]>;                 // 获取所有书籍列表
    getBookById: (id: string) => Promise<any>;      // 根据 ID 获取书籍(UUID)
    addBook: (book: any) => Promise<string>;        // 添加新书籍,返回 UUID
    updateBook: (id: string, data: any) => Promise<void>;  // 更新书籍信息(UUID)
    deleteBook: (id: string) => Promise<void>;      // 删除书籍(UUID)
  };
  // AI 服务接口
  ai: {
    chat: (messages: any[]) => Promise<string>;     // AI 对话
    summarize: (text: string) => Promise<string>;   // 文本摘要
  };
  // 文件操作接口
  file: {
    selectFile: () => Promise<string | null>;       // 打开文件选择对话框
    importBook: (path: string) => Promise<any>;     // 导入书籍文件
  };
  // 书籍内容读取接口
  book: {
    // 获取书籍的章节元数据列表(不含 content,用于目录导航)
    getChapterMetadata: (bookId: string) => Promise<any[]>;
    // 获取指定章节的完整内容(包含 content)
    getChapter: (chapterId: string) => Promise<any>;
    // 保存阅读进度
    saveProgress: (bookId: string, chapterId: string) => Promise<void>;
  };
}

/**
 * Electron API 实现
 * 通过 IPC 通信调用主进程的功能
 */
const electronAPI: ElectronAPI = {
  // 数据库操作 - 与主进程的 IPC 处理器对应
  db: {
    getBooks: () => ipcRenderer.invoke('db:getBooks'),
    getBookById: (id: string) => ipcRenderer.invoke('db:getBookById', id),
    addBook: (book: any) => ipcRenderer.invoke('db:addBook', book),
    updateBook: (id: string, data: any) => ipcRenderer.invoke('db:updateBook', id, data),
    deleteBook: (id: string) => ipcRenderer.invoke('db:deleteBook', id),
  },
  // AI 服务
  ai: {
    chat: (messages: any[]) => ipcRenderer.invoke('ai:chat', messages),
    summarize: (text: string) => ipcRenderer.invoke('ai:summarize', text),
  },
  // 文件操作
  file: {
    selectFile: () => ipcRenderer.invoke('file:select'),
    importBook: (path: string) => ipcRenderer.invoke('file:importBook', path),
  },
  // 书籍内容读取
  book: {
    getChapterMetadata: (bookId: string) => ipcRenderer.invoke('book:getChapterMetadata', bookId),
    getChapter: (chapterId: string) => ipcRenderer.invoke('book:getChapter', chapterId),
    saveProgress: (bookId: string, chapterId: string) => ipcRenderer.invoke('book:saveProgress', bookId, chapterId),
  },
};

/**
 * 将 API 暴露到渲染进程的全局对象 window.electronAPI
 * 使用 contextBridge 确保安全性,避免直接暴露 Node.js API
 */
contextBridge.exposeInMainWorld('electronAPI', electronAPI);
