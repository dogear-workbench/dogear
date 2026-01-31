/**
 * Electron API 类型定义
 * 为渲染进程提供 window.electronAPI 的类型声明
 * 统一管理所有 Electron 相关的类型定义
 */

import { Book, Chapter, ChapterMetadata, BookAnalysis, ChapterAnalysis } from './books.js';
import { AIMessage } from './ai.js';
import { AgentTask, AgentTaskUpdate } from './agents.js';

/**
 * 数据库操作接口
 */
export interface DBAPI {
  /** 获取所有书籍列表 */
  getBooks: () => Promise<Book[]>;
  /** 根据 ID 获取书籍(UUID) */
  getBookById: (id: string) => Promise<Book>;
  /** 添加新书籍,返回 UUID */
  addBook: (book: Book) => Promise<string>;
  /** 更新书籍信息(UUID) */
  updateBook: (id: string, data: Partial<Book>) => Promise<void>;
  /** 删除书籍(UUID) */
  deleteBook: (id: string) => Promise<void>;
}

/**
 * AI 服务接口
 */
export interface AIAPI {
  /** AI 对话 */
  chat: (messages: AIMessage[]) => Promise<string>;
  /** 文本摘要 */
  summarize: (text: string) => Promise<string>;
}

/**
 * 文件操作接口
 */
export interface FileAPI {
  /** 打开文件选择对话框 */
  selectFile: () => Promise<string | null>;
  /** 导入书籍文件 */
  importBook: (path: string, workspaceId?: string) => Promise<Book>;
  /** 在文件管理器中打开文件所在目录并选中文件 */
  openInFolder: (filePath: string) => Promise<{ success: boolean; error?: string }>;
}

/**
 * 工作区接口
 */
export interface Workspace {
  id: string;
  name: string;
  path: string;
  is_default: number;
  created_at: number;
}

/**
 * 工作区文件节点
 */
export interface WorkspaceFileNode {
  name: string;
  path: string;
  type: 'file' | 'directory';
  ext?: string;
  children?: WorkspaceFileNode[];
}

/**
 * 工作区操作接口
 */
export interface WorkspaceAPI {
  /** 获取所有工作区列表 */
  getAll: () => Promise<{ workspaces: Workspace[]; error?: string }>;
  /** 获取默认工作区 */
  getDefault: () => Promise<Workspace | null>;
  /** 打开文件夹选择对话框，创建新工作区 */
  selectFolder: () => Promise<{ canceled?: boolean; workspace?: Workspace; existed?: boolean; error?: string }>;
  /** 设置默认工作区 */
  setDefault: (workspaceId: string) => Promise<{ success: boolean; error?: string }>;
  /** 获取工作区的文件结构 */
  getFiles: (workspaceId: string) => Promise<{ files: WorkspaceFileNode[]; error?: string }>;
}

/**
 * 书籍内容读取接口
 */
export interface BookAPI {
  /** 获取书籍的章节元数据列表(不含 content,用于目录导航) */
  getChapterMetadata: (bookId: string) => Promise<ChapterMetadata[]>;
  /** 获取指定章节的完整内容(包含 content) */
  getChapter: (chapterId: string) => Promise<Chapter>;
  /** 保存阅读进度 */
  saveProgress: (bookId: string, chapterId: string) => Promise<void>;

  // v2: AI 分析相关接口
  /** 分析书籍 */
  analyze: (bookId: string) => Promise<{ taskId?: string; error?: string }>;
  /** 获取书籍分析状态 */
  getAnalysisStatus: (bookId: string) => Promise<{
    status: 'none' | 'analyzing' | 'analyzed' | 'failed';
    result: BookAnalysis | null;
    error?: string;
  }>;
  /** 获取章节分析列表 */
  getChapterAnalyses: (bookId: string) => Promise<{ analyses: ChapterAnalysis[]; error?: string }>;
  /** 监听分析更新事件,返回取消监听函数 */
  onAnalysisUpdate: (callback: (data: BookAnalysisUpdate) => void) => () => void;
  /** 根据文件路径获取书籍信息 */
  getBookByFilePath: (filePath: string) => Promise<Book | undefined>;
  /** 获取书籍在工作区中的文件路径（绝对路径） */
  getWorkspaceFilePath: (bookId: string) => Promise<{ path: string | null; error?: string }>;
  /** 在文件管理器中打开书籍所在目录 */
  openInFolder: (bookId: string) => Promise<{ success: boolean; error?: string }>;

  // v3: 书籍问答相关接口
  /** 跳转到指定章节位置（用于引用跳转） */
  jumpToPosition: (chapterId: string, position?: { start: number; end: number }) => Promise<{ success: boolean; error?: string }>;
}

/**
 * 书籍分析更新事件数据
 */
export interface BookAnalysisUpdate {
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
}

/**
 * Agent 任务接口
 */
export interface AgentAPI {
  /** 提交 Agent 任务 */
  submitTask: (task: AgentTask) => Promise<{ taskId: string }>;
  /** 取消 Agent 任务 */
  cancelTask: (taskId: string) => Promise<{ success: boolean }>;
  /** 获取 Agent 状态 */
  getStatus: () => Promise<{
    workers: number;
    maxWorkers: number;
    queuedTasks: number;
    activeTasks: number;
  }>;
  /** 获取详细状态 */
  getDetailedStatus: () => Promise<{
    config: {
      maxWorkers: number;
      workerIdleTimeout: number;
      taskRetryLimit: number;
    };
    workers: Array<{
      workerId: string;
      isReady: boolean;
      currentTaskId: string | null;
      lastActivity: number;
      createdAt: number;
      idleTime: number;
    }>;
    queuedTasks: Array<{
      id: string;
      type: string;
      status: string;
      createdAt: number;
    }>;
    summary: {
      totalWorkers: number;
      activeWorkers: number;
      idleWorkers: number;
      queuedTasksCount: number;
    };
  }>;
  /** 打开监控窗口 */
  openMonitorWindow: () => Promise<{ success: boolean }>;
  /** 监听任务更新事件,返回取消监听函数 */
  onTaskUpdate: (callback: (update: AgentTaskUpdate) => void) => () => void;
  /** 监听流式消息块事件,返回取消监听函数 */
  onStreamChunk: (callback: (data: { taskId: string; chunk: string }) => void) => () => void;
  /** 监听会话消息事件,返回取消监听函数 */
  onSessionMessage: (callback: (data: { sessionId: string; message: string }) => void) => () => void;
  /** 向会话发送消息 */
  sendSessionMessage: (sessionId: string, message: { role: string; content: string }) => Promise<{ taskId: string }>;
  /** 关闭会话 */
  closeSession: (sessionId: string) => Promise<{ taskId: string; success: boolean }>;
  /** 移除任务更新监听器 */
  removeTaskUpdateListener: (callback: (update: AgentTaskUpdate) => void) => void;
}

/**
 * 扩展的会话消息类型
 * 用于显示完整的 AI 操作（工具调用、思考过程等）
 */
export interface ExtendedSessionMessage {
  type: 'text' | 'tool_use' | 'tool_result' | 'thinking' | 'status' | 'error' | 'result';
  content?: string;
  toolName?: string;
  toolInput?: any;
  toolOutput?: any;
  toolUseId?: string;
  status?: string;
  error?: string;
  timestamp: number;
  // 引用信息（用于书籍问答）
  citations?: Citation[];
}

/**
 * 引用信息
 * 用于标注答案来源，支持点击跳转到原文位置
 */
export interface Citation {
  chapterId: string;
  chapterTitle: string;
  chapterNumber?: number;
  position?: { start: number; end: number };
  text?: string;  // 引用的文本片段
}

/**
 * 主进程会话接口 (v2)
 * 使用 SDK 的 v2 API 在主进程中直接创建和管理会话
 */
export interface MainProcessSessionAPI {
  /** 创建主进程会话 */
  createSession: (config: {
    model?: string;
    allowedTools?: string[];
    context?: {
      bookId?: string;
      chapterId?: string;
      selectedText?: string;
    };
  }) => Promise<{ sessionId?: string; error?: string }>;
  /** 向主进程会话发送消息 */
  sendMessage: (sessionId: string, content: string) => Promise<{ success?: boolean; error?: string }>;
  /** 关闭主进程会话 */
  closeSession: (sessionId: string) => Promise<{ success?: boolean; error?: string }>;
  /** 监听会话消息事件,返回取消监听函数 */
  onMessage: (callback: (data: { sessionId: string; message: ExtendedSessionMessage }) => void) => () => void;
}

/**
 * 基于 Query 的会话接口 (支持 Skills)
 * 使用 SDK 的 query 函数创建会话，支持加载 .claude/skills/ 目录
 */
export interface QueryBasedSessionAPI {
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
  }) => Promise<{ sessionId?: string; error?: string }>;
  /** 向会话发送消息 */
  sendMessage: (sessionId: string, content: string) => Promise<{ success?: boolean; error?: string }>;
  /** 关闭会话 */
  closeSession: (sessionId: string) => Promise<{ success?: boolean; error?: string }>;
  /** 监听会话消息事件,返回取消监听函数 */
  onMessage: (callback: (data: { sessionId: string; message: ExtendedSessionMessage }) => void) => () => void;
  /** 监听会话完成事件,返回取消监听函数 */
  onComplete: (callback: (data: { sessionId: string; result: any }) => void) => () => void;
}

/**
 * Electron API 总接口
 * 定义通过 contextBridge 暴露给渲染进程的 API 接口
 */
export interface ElectronAPI {
  /** 数据库操作 */
  db: DBAPI;
  /** AI 服务 */
  ai: AIAPI;
  /** 文件操作 */
  file: FileAPI;
  /** 书籍内容读取 */
  book: BookAPI;
  /** Agent 任务操作 */
  agent: AgentAPI;
  /** 工作区操作 */
  workspace: WorkspaceAPI;
  /** 主进程会话操作 (v2) */
  mainProcessSession: MainProcessSessionAPI;
  /** 基于 Query 的会话操作 (支持 Skills) */
  queryBasedSession: QueryBasedSessionAPI;
}

/**
 * 全局 Window 接口扩展
 * 为 window.electronAPI 提供类型定义
 * 这个接口由 Electron 的预加载脚本注入到渲染进程
 */
declare global {
  interface Window {
    /**
     * Electron API 对象
     * 通过 contextBridge 从预加载脚本暴露到渲染进程
     */
    electronAPI: ElectronAPI;
  }
}

// 导出类型,供其他模块使用
export type { Book, Chapter, ChapterMetadata } from './books';
export type { AIMessage } from './ai';
export type { AgentTask, AgentTaskUpdate, TaskStatus, TaskType, ChatSessionPayload } from './agents';
