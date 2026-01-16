/**
 * Electron API 类型定义
 * 为渲染进程提供 window.electronAPI 的类型声明
 * 统一管理所有 Electron 相关的类型定义
 */

import { Book, Chapter, ChapterMetadata } from './books.js';
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
  importBook: (path: string) => Promise<Book>;
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
  getStatus: () => Promise<any>;
  /** 监听任务更新事件,返回取消监听函数 */
  onTaskUpdate: (callback: (update: AgentTaskUpdate) => void) => () => void;
  /** 移除任务更新监听器 */
  removeTaskUpdateListener: (callback: (update: AgentTaskUpdate) => void) => void;
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
export type { AgentTask, AgentTaskUpdate, TaskStatus, TaskType } from './agents';
