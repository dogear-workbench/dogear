/**
 * 共享数据类型定义
 * 供主进程和渲染进程共同使用的数据结构类型
 * 注意：IPC 通信的类型安全由 @egoist/tipc 提供，不再需要手动定义 API 接口
 */

/**
 * 权限模式（与 SDK 的 PermissionMode 保持一致）
 * 前端无法直接导入 @anthropic-ai/claude-agent-sdk，因此在此重新定义
 */
export type PermissionMode = 'default' | 'acceptEdits' | 'bypassPermissions' | 'plan' | 'dontAsk' | 'auto';

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
  type: 'file' | 'directory' | 'article';
  ext?: string;
  children?: WorkspaceFileNode[];
  /** 书籍 ID（type='file' 且为已导入书籍时存在） */
  bookId?: string;
  /** 文章专属字段（type='article' 时存在） */
  articleMeta?: {
    id: string;
    url: string;
    siteName: string | null;
    fetchedAt: number;
    wordCount: number;
  };
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
 * 扩展的会话消息类型
 * 用于显示完整的 AI 操作（工具调用、思考过程等）
 */
export interface ExtendedSessionMessage {
  type: 'text' | 'tool_use' | 'tool_result' | 'thinking' | 'status' | 'error' | 'result' | 'user' | 'assistant_uuid' | 'permission_request'
    // Hook 事件类型
    | 'session_start'       // SessionStart hook 触发
    | 'session_end'         // SessionEnd hook 触发
    | 'stop'                // Stop hook 触发
    | 'tool_failure'        // PostToolUseFailure hook 触发
    | 'notification'        // Notification hook 触发
    | 'task_notification'   // 子代理任务通知
    | 'ask_user_question'   // AskUserQuestion 工具触发
    | 'prompt_suggestion';  // SDK 0.2.119+ 每轮结束后的下一步提示
  content?: string;
  toolName?: string;
  toolInput?: any;
  toolOutput?: any;
  toolUseId?: string;
  status?: string;
  error?: string;
  // 工具执行是否出错（用于 tool_result 类型）
  isError?: boolean;
  timestamp: number;
  // 引用信息（用于书籍问答）
  citations?: Citation[];
  // 是否为重放的历史消息（SDK resume 时使用）
  isReplay?: boolean;
  // 消息 UUID（SDK 提供）
  uuid?: string;
  // AI 使用的实际模型名称
  model?: string;
  // 权限请求相关字段（type='permission_request' 时使用）
  permissionRequestId?: string;
  permissionToolName?: string;
  permissionInput?: any;
  permissionDecisionReason?: string;
  // SessionStart hook 相关字段
  sessionStartSource?: 'startup' | 'resume' | 'clear' | 'compact';
  // SessionEnd hook 相关字段
  sessionEndReason?: string;
  // Stop hook 相关字段
  stopHookActive?: boolean;
  // PostToolUseFailure hook 相关字段
  failedToolName?: string;
  failedToolError?: string;
  // Notification hook 相关字段
  notificationTitle?: string;
  notificationMessage?: string;
  notificationType?: string;
  // 子代理任务通知相关字段
  taskId?: string;
  taskStatus?: string;
  taskSummary?: string;
  // AskUserQuestion 相关字段
  askUserRequestId?: string;
  askUserQuestions?: Array<{
    question: string;
    header?: string;
    options: Array<{ label: string; description?: string }>;
    multiSelect?: boolean;
  }>;
  // 下一步建议（type='prompt_suggestion' 时使用）
  suggestion?: string;
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
 * 对话接口 (v5: 对话属于工作区，book_id 可选)
 */
export interface Conversation {
  id: string;
  book_id?: string;                  // 可选：关联的书籍ID
  workspace_id: string;              // 关联的工作区ID
  title: string;
  model: string;
  sdk_session_id?: string;           // SDK 返回的 session_id（用于 resume 功能）
  parent_conversation_id?: string;   // 父对话ID（分叉对话，v4）
  fork_message_sdk_uuid?: string;    // 分叉点 assistant 消息 UUID（v4）
  persona_id?: string;               // 关联的人设 ID
  temp_prompt?: string;              // 临时提示词（仅当前对话生效）
  fork_pending?: boolean;            // 分叉已创建但 SDK 会话未建立
  archived_at?: string;              // 归档时间（ISO 8601），有值=已归档
  created_at: number;
  updated_at: number;
}

/**
 * 对话文件夹
 */
export interface ConversationFolder {
  id: string;
  name: string;
  createdAt: string;
}

/**
 * 对话树数据
 */
export interface ConversationTreeData {
  folders: Record<string, ConversationFolder>;
  children: Record<string, string[]>;
}

// 导出类型,供其他模块使用
export type { Book, Chapter, ChapterMetadata } from './books';
export type { AIMessage } from './ai';
export type { AgentTask, AgentTaskUpdate, TaskStatus, TaskType, ChatSessionPayload } from './agents';
