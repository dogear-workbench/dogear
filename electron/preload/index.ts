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

  // v2: AI 分析相关接口
  /** 分析书籍 */
  analyze: (bookId: string) => ipcRenderer.invoke('book:analyze', bookId),

  /** 获取书籍分析状态 */
  getAnalysisStatus: (bookId: string) => ipcRenderer.invoke('book:getAnalysisStatus', bookId),

  /** 获取章节分析列表 */
  getChapterAnalyses: (bookId: string) => ipcRenderer.invoke('book:getChapterAnalyses', bookId),

  /** 监听分析更新事件 */
  onAnalysisUpdate: (callback: (data: {
    bookId: string;
    taskId?: string;
    status?: string;
    result?: any;
    error?: string;
    toolName?: string;
    toolInput?: any;
    chapterSaved?: boolean;
    chapterTitle?: string;
    message?: string;
    statusMessage?: string;
  }) => void) => {
    const listener = (_event: any, data: any) => callback(data);
    ipcRenderer.on('book:analysisUpdate', listener);
    return () => ipcRenderer.removeListener('book:analysisUpdate', listener);
  },

  /** 根据文件路径获取书籍信息 */
  getBookByFilePath: (filePath: string) => ipcRenderer.invoke('book:getBookByFilePath', filePath),

  /** 获取书籍在工作区中的文件路径（绝对路径） */
  getWorkspaceFilePath: (bookId: string) => ipcRenderer.invoke('book:getWorkspaceFilePath', bookId),

  /** 在文件管理器中打开书籍所在目录 */
  openInFolder: (bookId: string) => ipcRenderer.invoke('book:openInFolder', bookId),

  // v3: 书籍问答相关接口
  /** 跳转到指定章节位置（用于引用跳转） */
  jumpToPosition: (chapterId: string, position?: { start: number; end: number }) =>
    ipcRenderer.invoke('book:jumpToPosition', chapterId, position),
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
  importBook: (path: string, workspaceId?: string) => ipcRenderer.invoke('file:importBook', path, workspaceId),

  /** 在文件管理器中打开文件所在目录并选中文件 */
  openInFolder: (filePath: string) => ipcRenderer.invoke('file:openInFolder', filePath),
};

/**
 * 工作区操作 API
 */
const workspaceAPI = {
  /** 获取所有工作区列表 */
  getAll: () => ipcRenderer.invoke('workspace:getAll'),

  /** 获取默认工作区 */
  getDefault: () => ipcRenderer.invoke('workspace:getDefault'),

  /** 打开文件夹选择对话框，创建新工作区 */
  selectFolder: () => ipcRenderer.invoke('workspace:selectFolder'),

  /** 设置默认工作区 */
  setDefault: (workspaceId: string) => ipcRenderer.invoke('workspace:setDefault', workspaceId),

  /** 获取工作区的文件结构 */
  getFiles: (workspaceId: string) => ipcRenderer.invoke('workspace:getFiles', workspaceId),
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

  /** 获取详细状态 */
  getDetailedStatus: () => ipcRenderer.invoke('agent:getDetailedStatus'),

  /** 打开监控窗口 */
  openMonitorWindow: () => ipcRenderer.invoke('agent:openMonitorWindow'),

  /** 监听任务更新事件 */
  onTaskUpdate: (callback: (update: any) => void) => {
    const listener = (_event: any, update: any) => callback(update);
    ipcRenderer.on('agent:taskUpdate', listener);
    return () => ipcRenderer.removeListener('agent:taskUpdate', listener);
  },

  /** 监听流式消息块事件 */
  onStreamChunk: (callback: (data: { taskId: string; chunk: string }) => void) => {
    const listener = (_event: any, data: any) => callback(data);
    ipcRenderer.on('agent:streamChunk', listener);
    return () => ipcRenderer.removeListener('agent:streamChunk', listener);
  },

  /** 监听会话消息事件 */
  onSessionMessage: (callback: (data: { sessionId: string; message: string }) => void) => {
    const listener = (_event: any, data: any) => callback(data);
    ipcRenderer.on('agent:sessionMessage', listener);
    return () => ipcRenderer.removeListener('agent:sessionMessage', listener);
  },

  /** 向会话发送消息 */
  sendSessionMessage: (sessionId: string, message: { role: string; content: string }) =>
    ipcRenderer.invoke('agent:sendSessionMessage', sessionId, message),

  /** 关闭会话 */
  closeSession: (sessionId: string) => ipcRenderer.invoke('agent:closeSession', sessionId),

  /** 移除监听器 */
  removeTaskUpdateListener: (callback: (update: any) => void) => {
    ipcRenderer.removeListener('agent:taskUpdate', callback as any);
  }
};

/**
 * 主进程会话 API (v2)
 * 使用 SDK 的 v2 API 在主进程中直接创建和管理会话
 */
const mainProcessSessionAPI = {
  /** 创建主进程会话 */
  createSession: (config: {
    model?: string;
    allowedTools?: string[];
    context?: {
      bookId?: string;
      chapterId?: string;
      selectedText?: string;
    };
  }) => ipcRenderer.invoke('agent:createMainProcessSession', config),

  /** 向主进程会话发送消息 */
  sendMessage: (sessionId: string, content: string) =>
    ipcRenderer.invoke('agent:sendMainProcessSessionMessage', sessionId, content),

  /** 关闭主进程会话 */
  closeSession: (sessionId: string) =>
    ipcRenderer.invoke('agent:closeMainProcessSession', sessionId),

  /** 监听会话消息事件 */
  onMessage: (callback: (data: { sessionId: string; message: any }) => void) => {
    const listener = (_event: any, data: any) => callback(data);
    ipcRenderer.on('agent:mainProcessSessionMessage', listener);
    return () => ipcRenderer.removeListener('agent:mainProcessSessionMessage', listener);
  }
};

/**
 * 基于 Query 的会话 API (支持 Skills)
 * 使用 SDK 的 query 函数创建会话，支持加载 .claude/skills/ 目录
 */
const queryBasedSessionAPI = {
  /** 创建基于 Query 的会话（支持 Skills） */
  createSession: (config: {
    model?: string;
    allowedTools?: string[];
    context?: {
      bookId?: string;
      chapterId?: string;
      selectedText?: string;
    };
    enableSkills?: boolean;        // 是否启用 Skill 功能
    projectRoot?: string;          // 项目根目录（用于查找 .claude/skills/）
  }) => ipcRenderer.invoke('agent:createQueryBasedSession', config),

  /** 向会话发送消息 */
  sendMessage: (sessionId: string, content: string) =>
    ipcRenderer.invoke('agent:sendQueryBasedSessionMessage', sessionId, content),

  /** 关闭会话 */
  closeSession: (sessionId: string) =>
    ipcRenderer.invoke('agent:closeQueryBasedSession', sessionId),

  /** 监听会话消息事件 */
  onMessage: (callback: (data: { sessionId: string; message: any }) => void) => {
    const listener = (_event: any, data: any) => callback(data);
    ipcRenderer.on('agent:queryBasedSessionMessage', listener);
    return () => ipcRenderer.removeListener('agent:queryBasedSessionMessage', listener);
  },

  /** 监听会话完成事件 */
  onComplete: (callback: (data: { sessionId: string; result: any }) => void) => {
    const listener = (_event: any, data: any) => callback(data);
    ipcRenderer.on('agent:queryBasedSessionComplete', listener);
    return () => ipcRenderer.removeListener('agent:queryBasedSessionComplete', listener);
  },

  /** 从 SDK 的会话文件中读取历史消息 */
  getSdkSessionHistory: (sdkSessionId: string, projectPath?: string) =>
    ipcRenderer.invoke('agent:getSdkSessionHistory', sdkSessionId, projectPath),

  /** 获取所有 SDK 会话列表 */
  getSdkSessions: (projectPath?: string) =>
    ipcRenderer.invoke('agent:getSdkSessions', projectPath)
};

/**
 * 对话管理 API (v3)
 * 管理书籍相关的对话和消息
 */
const conversationsAPI = {
  /** 获取书籍的所有对话 */
  getByBookId: (bookId: string) => ipcRenderer.invoke('conversations:getByBookId', bookId),

  /** 获取单个对话 */
  getById: (conversationId: string) => ipcRenderer.invoke('conversations:getById', conversationId),

  /** 创建新对话 */
  create: (bookId: string, title?: string) => ipcRenderer.invoke('conversations:create', bookId, title),

  /** 更新对话标题 */
  updateTitle: (conversationId: string, title: string) =>
    ipcRenderer.invoke('conversations:updateTitle', conversationId, title),

  /** 删除对话 */
  delete: (conversationId: string) => ipcRenderer.invoke('conversations:delete', conversationId),

  /** 获取对话的所有消息 */
  getMessages: (conversationId: string) => ipcRenderer.invoke('conversations:getMessages', conversationId),

  /** 添加消息到对话 */
  addMessage: (message: any) => ipcRenderer.invoke('conversations:addMessage', message),

  /** 批量添加消息 */
  addMessages: (messages: any[]) => ipcRenderer.invoke('conversations:addMessages', messages),

  /** 获取工作区中所有书籍及其对话 */
  getBooksWithConversations: (workspaceId?: string) =>
    ipcRenderer.invoke('conversations:getBooksWithConversations', workspaceId)
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
  workspace: workspaceAPI,
  mainProcessSession: mainProcessSessionAPI,
  queryBasedSession: queryBasedSessionAPI,
  conversations: conversationsAPI,
};

/**
 * 将 API 暴露到渲染进程的全局对象 window.electronAPI
 * 使用 contextBridge 确保安全性,避免直接暴露 Node.js API
 */
contextBridge.exposeInMainWorld('electronAPI', electronAPI);