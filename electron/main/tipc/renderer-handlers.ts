/**
 * main→renderer 事件类型定义
 * 用于 getRendererHandlers<T> 和 createEventHandlers<T> 的类型约束
 */
import type { ExtendedSessionMessage } from '../agents/main-process-session.js';
import type { TaskStatus } from '../agents/task-types.js';

/**
 * 渲染进程事件处理器类型定义
 * 每个属性是一个函数签名，参数即为事件的 payload
 */
export type RendererHandlers = {
  // 书籍分析进度更新
  analysisUpdate: (data: {
    bookId: string;
    taskId?: string;
    status?: string;
    result?: unknown;
    error?: string;
    toolName?: string;
    toolInput?: unknown;
    chapterSaved?: boolean;
    chapterTitle?: string;
    message?: string;
    statusMessage?: string;
  }) => void;

  // Agent 任务状态更新
  agentTaskUpdate: (data: {
    taskId: string;
    status: TaskStatus;
    result?: unknown;
    error?: string;
  }) => void;

  // Agent 流式文本块
  agentStreamChunk: (data: {
    taskId: string;
    chunk: string;
  }) => void;

  // 旧版 Agent 会话消息
  agentSessionMessage: (data: {
    sessionId: string;
    message: string;
  }) => void;

  // 主进程会话消息（SDK v2）
  mainProcessSessionMessage: (data: {
    sessionId: string;
    message: ExtendedSessionMessage;
  }) => void;

  // 基于 Query 的会话消息
  queryBasedSessionMessage: (data: {
    sessionId: string;
    message: ExtendedSessionMessage;
  }) => void;

  // 基于 Query 的会话完成
  queryBasedSessionComplete: (data: {
    sessionId: string;
    result: unknown;
  }) => void;
};
