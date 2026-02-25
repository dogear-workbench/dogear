/**
 * Agent 任务类型定义
 * 定义主进程与 Agent Worker 之间的通信协议
 */

/**
 * 任务状态枚举
 */
export enum TaskStatus {
  PENDING = 'pending',       // 等待执行
  IN_PROGRESS = 'in_progress', // 执行中
  COMPLETED = 'completed',   // 已完成
  FAILED = 'failed',         // 失败
  CANCELLED = 'cancelled'    // 已取消
}

/**
 * 任务类型枚举
 */
export enum TaskType {
  SUMMARIZE = 'summarize',          // 文本摘要
  ANALYZE_BOOK = 'analyze_book',    // 书籍分析
  READING_ASSIST = 'reading_assist', // 阅读辅助
  CHAT_SESSION = 'chat_session'     // 持续对话会话
}

/**
 * 基础任务接口
 */
export interface AgentTask {
  id: string;                       // 任务唯一标识
  type: TaskType;                   // 任务类型
  status: TaskStatus;               // 当前状态
  payload: any;                     // 任务负载数据
  createdAt: number;                // 创建时间戳
  updatedAt?: number;               // 更新时间戳
  result?: any;                     // 任务结果
  error?: string;                   // 错误信息
  retryCount?: number;              // 重试次数 (内部使用)
}

/**
 * AI 对话任务负载
 */
export interface ChatTaskPayload {
  messages: Array<{
    role: 'user' | 'assistant' | 'system';
    content: string;
  }>;
  context?: {
    bookId?: string;
    chapterId?: string;
    selectedText?: string;
  };
}

/**
 * 持续对话会话任务负载
 */
export interface ChatSessionPayload {
  action: 'start' | 'message' | 'close';  // 会话操作
  sessionId?: string;                      // 会话 ID（start 时可选，message/close 时必需）
  message?: {                              // 用户消息（action=message 时使用）
    role: 'user' | 'assistant' | 'system';
    content: string;
  };
  context?: {                              // 上下文信息（action=start 时使用）
    bookId?: string;
    chapterId?: string;
    selectedText?: string;
  };
}

/**
 * 文本摘要任务负载
 */
export interface SummarizeTaskPayload {
  text: string;
  maxLength?: number;
  language?: string;
}

/**
 * 书籍分析任务负载
 */
export interface AnalyzeBookPayload {
  bookId: string;
  analysisTypes?: ('summary' | 'keywords' | 'structure')[];
}

/**
 * 阅读辅助任务负载
 */
export interface ReadingAssistPayload {
  text: string;
  action: 'explain' | 'translate' | 'expand';
  language?: string;
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
  text?: string;
}

/**
 * 扩展的会话消息类型
 * 用于向前端传递完整的 AI 操作（工具调用、思考过程等）
 */
export interface ExtendedSessionMessage {
  type: 'text' | 'tool_use' | 'tool_result' | 'thinking' | 'status' | 'error' | 'result' | 'user' | 'assistant_uuid';
  content?: string;
  toolName?: string;
  toolInput?: any;
  toolOutput?: any;
  toolUseId?: string;
  status?: string;
  error?: string;
  isError?: boolean;               // 工具执行是否出错（用于 tool_result 类型）
  timestamp: number;
  citations?: Citation[];          // 引用信息（用于书籍问答）
  isReplay?: boolean;              // 是否为重放的历史消息（SDK resume 时使用）
  uuid?: string;                   // 消息 UUID（SDK 提供）
}

/**
 * Agent Worker 配置
 */
export interface AgentWorkerConfig {
  workerId: string;              // Worker ID
  taskId?: string;               // 当前处理任务 ID (可选)
  messagePort?: any;             // 通信端口
  dbPath?: string;               // 数据库路径 (可选,用于 Worker 线程)
  workspacePath?: string;        // 工作区路径 (可选,用于 Worker 线程)
}

/**
 * 主进程 -> Agent Worker 消息类型
 */
export type MainToWorkerMessage =
  | { type: 'init'; config: AgentWorkerConfig }
  | { type: 'task'; task: AgentTask }
  | { type: 'cancel'; taskId: string }
  | { type: 'ping' };

/**
 * Agent Worker -> 主进程消息类型
 */
export type WorkerToMainMessage =
  | { type: 'ready'; workerId: string }
  | { type: 'taskUpdate'; taskId: string; status: TaskStatus; result?: any; error?: string }
  | { type: 'taskStreamChunk'; taskId: string; chunk: string }  // 流式消息块
  | { type: 'taskStreamEnd'; taskId: string }  // 流式消息结束
  | { type: 'sessionMessage'; sessionId: string; message: string }  // 会话消息
  | { type: 'sessionStarted'; sessionId: string }  // 会话已启动
  | { type: 'sessionClosed'; sessionId: string }  // 会话已关闭
  | { type: 'pong' }
  | { type: 'error'; error: string }
  // v2: 分析进度消息
  | { type: 'analysisProgress'; bookId: string; toolName?: string; toolInput?: any; chapterSaved?: boolean; chapterTitle?: string; message?: string; status?: string };