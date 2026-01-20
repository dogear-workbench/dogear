/**
 * 预加载脚本的类型声明
 * 为 window.electronAPI 和 window.electronDebug 提供类型支持
 */

import { TaskStatus } from './agents';

/**
 * Agent 任务更新
 */
export interface AgentTaskUpdate {
  taskId: string;
  status: TaskStatus;
  result?: any;
  error?: string;
}

/**
 * 会话消息
 */
export interface SessionMessage {
  sessionId: string;
  message: string;
}

/**
 * 数据库 API
 */
export interface DatabaseAPI {
  getBooks: () => Promise<any[]>;
  getBookById: (id: string) => Promise<any>;
  addBook: (book: any) => Promise<string>;
  updateBook: (id: string, data: any) => Promise<void>;
  deleteBook: (id: string) => Promise<void>;
}

/**
 * 书籍 API
 */
export interface BookAPI {
  getChapterMetadata: (bookId: string) => Promise<any[]>;
  getChapter: (chapterId: string) => Promise<any>;
  saveProgress: (bookId: string, chapterId: string) => Promise<void>;
}

/**
 * AI API
 */
export interface AIAPI {
  chat: (messages: any[]) => Promise<any>;
  summarize: (text: string) => Promise<string>;
}

/**
 * 文件 API
 */
export interface FileAPI {
  selectFile: () => Promise<string | null>;
  importBook: (path: string) => Promise<any>;
}

/**
 * Agent API
 */
export interface AgentAPI {
  submitTask: (task: any) => Promise<{ taskId: string }>;
  cancelTask: (taskId: string) => Promise<{ success: boolean }>;
  getStatus: () => Promise<{
    workers: number;
    maxWorkers: number;
    queuedTasks: number;
    activeTasks: number;
  }>;
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
  openMonitorWindow: () => Promise<{ success: boolean }>;
  onTaskUpdate: (callback: (update: AgentTaskUpdate) => void) => () => void;
  onStreamChunk: (callback: (data: { taskId: string; chunk: string }) => void) => () => void;
  onSessionMessage: (callback: (data: SessionMessage) => void) => () => void;
  sendSessionMessage: (sessionId: string, message: { role: string; content: string }) => Promise<{ taskId: string }>;
  closeSession: (sessionId: string) => Promise<{ taskId: string; success: boolean }>;
  removeTaskUpdateListener: (callback: (update: any) => void) => void;
}

/**
 * 主窗口的 Electron API
 */
export interface ElectronAPI {
  db: DatabaseAPI;
  ai: AIAPI;
  file: FileAPI;
  book: BookAPI;
  agent: AgentAPI;
}

/**
 * 调试窗口的 Electron API
 */
export interface DebugWindowAPI {
  sendAgentMessage: (prompt: string) => Promise<{ taskId: string }>;
  onAgentMessage: (callback: (message: any) => void) => () => void;
  onTaskUpdate: (callback: (update: any) => void) => () => void;
  getAgentStatus: () => Promise<{
    workers: number;
    maxWorkers: number;
    queuedTasks: number;
    activeTasks: number;
  }>;
}

// 扩展 Window 接口
declare global {
  interface Window {
    electronAPI: ElectronAPI;
    electronDebug?: DebugWindowAPI;
  }
}

export {};