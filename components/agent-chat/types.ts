import { Citation } from '@/types/electron-api';

/**
 * 扩展的消息类型
 */
export interface Message {
  role: 'user' | 'assistant';
  content: string;
  timestamp?: number;
  isStreaming?: boolean;  // 是否正在流式输出中
  // 统一的内容块数组，按接收顺序存储所有内容
  contentBlocks?: ContentBlock[];
  // SDK 消息 UUID（用于分叉定位，v4 新增）
  sdkUuid?: string;
  forkPointSdkUuid?: string; // 用户消息上记录对应的分叉点 assistant UUID
  // AI 模型名称
  model?: string;
  // 用户附带的图片（预览用）
  images?: Array<{ preview: string }>;
}

/**
 * 内容块类型
 * 按照实际接收顺序存储和渲染
 */
export interface ContentBlock {
  type: 'text' | 'tool_use' | 'tool_result' | 'thinking' | 'status' | 'error' | 'result' | 'user' | 'permission_request'
    // Hook 事件类型
    | 'session_start' | 'session_end' | 'stop' | 'tool_failure' | 'notification' | 'task_notification'
    // AskUserQuestion 类型
    | 'ask_user_question';
  id?: string;
  content?: string;
  toolName?: string;
  toolInput?: any;
  toolOutput?: any;
  toolUseId?: string;  // 工具调用 ID，用于关联工具调用和结果
  status?: string;
  error?: string;
  isError?: boolean;   // 工具执行是否出错
  timestamp: number;
  citations?: Citation[];
  // 是否为重放的历史消息（SDK resume 时使用）
  isReplay?: boolean;
  // 权限请求相关字段（type='permission_request' 时使用）
  permissionRequestId?: string;
  permissionToolName?: string;
  permissionInput?: any;
  permissionDecisionReason?: string;
  permissionResolved?: 'allow' | 'deny' | 'always_allow';  // 用户已响应的状态
  permissionDenyMessage?: string;  // 用户自定义的拒绝理由
  // Hook 事件相关字段
  sessionStartSource?: string;           // SessionStart: 启动来源
  sessionEndReason?: string;             // SessionEnd: 结束原因
  stopHookActive?: boolean;              // Stop: 停止钩子激活
  failedToolName?: string;               // PostToolUseFailure: 失败工具名
  failedToolError?: string;              // PostToolUseFailure: 失败错误信息
  notificationTitle?: string;            // Notification: 通知标题
  notificationMessage?: string;          // Notification: 通知内容
  notificationType?: string;             // Notification: 通知类型
  taskId?: string;                       // 子代理任务 ID
  taskStatus?: string;                   // 子代理任务状态
  taskSummary?: string;                  // 子代理任务摘要
  // AskUserQuestion 相关字段
  askUserRequestId?: string;
  askUserQuestions?: Array<{
    question: string;
    header?: string;
    options: Array<{ label: string; description?: string }>;
    multiSelect?: boolean;
  }>;
  askUserAnswers?: Record<string, string>;  // 用户已提交的答案
  askUserResolved?: boolean;                // 是否已回答
}

export interface AgentChatProps {
  /** 占位符文本 */
  placeholder?: string;
  /** 是否显示状态提示 */
  showStatusHint?: boolean;
  /** 是否使用 SDK 的 resume 功能（默认 true） */
  useSdkResume?: boolean;
  /** 是否显示重放的历史消息（仅当 useSdkResume=true 时有效） */
  showReplayMessages?: boolean;
  /** 覆盖 conversationId（多标签页模式下使用） */
  conversationIdOverride?: string;
}

/**
 * 解析用户消息中的引用格式，返回引用信息和实际消息文本
 * 严格匹配我们自己定义的格式，避免误解析
 */
export interface ParsedArticleRef {
  title: string;
  articleId: string;
  siteName?: string;
}
export interface ParsedSnippetRef {
  articleTitle: string;
  text: string;
}
export interface ParsedUserMessage {
  articleRefs: ParsedArticleRef[];
  snippetRefs: ParsedSnippetRef[];
  userMessage: string;
}
