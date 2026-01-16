/**
 * Electron 预加载脚本入口
 * 将 API 安全地暴露给渲染进程
 */

const { contextBridge, ipcRenderer } = require('electron');

/**
 * 数据库操作 API
 */
const dbAPI = {
  /** 获取所有书籍列表 */
  getBooks: () => ipcRenderer.invoke('db:getBooks'),

  /** 根据 ID 获取书籍(UUID) */
  getBookById: (id: string) => ipcRenderer.invoke('db:getBookById', id),

  /** 添加新书籍,返回 UUID */
  addBook: (book: any) => ipcRenderer.invoke('db:addBook', book),

  /** 更新书籍信息(UUID) */
  updateBook: (id: string, data: any) => ipcRenderer.invoke('db:updateBook', id, data),

  /** 删除书籍(UUID) */
  deleteBook: (id: string) => ipcRenderer.invoke('db:deleteBook', id),
};

/**
 * 书籍内容读取 API
 */
const bookAPI = {
  /** 获取书籍的章节元数据列表(不含 content,用于目录导航) */
  getChapterMetadata: (bookId: string) => ipcRenderer.invoke('book:getChapterMetadata', bookId),

  /** 获取指定章节的完整内容(包含 content) */
  getChapter: (chapterId: string) => ipcRenderer.invoke('book:getChapter', chapterId),

  /** 保存阅读进度 */
  saveProgress: (bookId: string, chapterId: string) => ipcRenderer.invoke('book:saveProgress', bookId, chapterId),
};

/**
 * AI 服务 API
 */
const aiAPI = {
  /** AI 对话 */
  chat: (messages: any[]) => ipcRenderer.invoke('ai:chat', messages),

  /** 文本摘要 */
  summarize: (text: string) => ipcRenderer.invoke('ai:summarize', text),
};

/**
 * 文件操作 API
 */
const fileAPI = {
  /** 打开文件选择对话框 */
  selectFile: () => ipcRenderer.invoke('file:select'),

  /** 导入书籍文件 */
  importBook: (path: string) => ipcRenderer.invoke('file:importBook', path),
};

/**
 * Agent 任务 API
 */
const agentAPI = {
  /** 提交任务 */
  submitTask: (task: any) => ipcRenderer.invoke('agent:submitTask', task),

  /** 取消任务 */
  cancelTask: (taskId: string) => ipcRenderer.invoke('agent:cancelTask', taskId),

  /** 获取状态 */
  getStatus: () => ipcRenderer.invoke('agent:getStatus'),

  /** 监听任务更新事件 */
  onTaskUpdate: (callback: (update: any) => void) => {
    const listener = (_event: any, update: any) => callback(update);
    ipcRenderer.on('agent:taskUpdate', listener);
    return () => ipcRenderer.removeListener('agent:taskUpdate', listener);
  },

  /** 移除监听器 */
  removeTaskUpdateListener: (callback: (update: any) => void) => {
    ipcRenderer.removeListener('agent:taskUpdate', callback as any);
  }
};

/**
 * Electron API 实现
 * 通过 IPC 通信调用主进程的功能
 */
const electronAPI = {
  db: dbAPI,
  ai: aiAPI,
  file: fileAPI,
  book: bookAPI,
  agent: agentAPI,
};

/**
 * 将 API 暴露到渲染进程的全局对象 window.electronAPI
 * 使用 contextBridge 确保安全性,避免直接暴露 Node.js API
 */
contextBridge.exposeInMainWorld('electronAPI', electronAPI);
