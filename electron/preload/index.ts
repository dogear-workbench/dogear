const { contextBridge, ipcRenderer } = require('electron');

/**
 * Electron API 类型定义
 * 定义通过 contextBridge 暴露给渲染进程的 API 接口
 */
interface ElectronAPI {
  // 数据库操作接口
  db: {
    getBooks: () => Promise<any[]>;                 // 获取所有书籍列表
    getBookById: (id: number) => Promise<any>;      // 根据 ID 获取书籍
    addBook: (book: any) => Promise<number>;        // 添加新书籍
    updateBook: (id: number, data: any) => Promise<void>;  // 更新书籍信息
    deleteBook: (id: number) => Promise<void>;      // 删除书籍
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
    // 读取 TXT 文件指定页的内容
    getTxtPage: (filePath: string, pageIndex: number) => Promise<{
      content: string;      // 页面内容
      totalPages: number;   // 总页数
      currentPage: number;  // 当前页码
    }>;
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
    getBookById: (id: number) => ipcRenderer.invoke('db:getBookById', id),
    addBook: (book: any) => ipcRenderer.invoke('db:addBook', book),
    updateBook: (id: number, data: any) => ipcRenderer.invoke('db:updateBook', id, data),
    deleteBook: (id: number) => ipcRenderer.invoke('db:deleteBook', id),
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
    getTxtPage: (filePath: string, pageIndex: number) =>
      ipcRenderer.invoke('book:getTxtPage', filePath, pageIndex),
  },
};

/**
 * 将 API 暴露到渲染进程的全局对象 window.electronAPI
 * 使用 contextBridge 确保安全性,避免直接暴露 Node.js API
 */
contextBridge.exposeInMainWorld('electronAPI', electronAPI);
