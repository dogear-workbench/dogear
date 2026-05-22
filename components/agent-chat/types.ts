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
  // 系统注入消息标记（skill 加载、command caveat 等，isMeta=true 的 user 消息）
  isMeta?: boolean;
  // 排队中的消息（Agent 执行中发送的消息，等待 Agent 完成后处理）
  isQueued?: boolean;
  // 压缩摘要消息（isCompactSummary=true 的 user 消息）
  isCompactSummary?: boolean;
  // 压缩分隔标记（虚拟消息，用于在 UI 中画分隔线和折叠历史）
  isCompactBoundary?: boolean;
  // 压缩元数据
  compactMetadata?: { trigger?: string; preTokens?: number };
  // 消息来源（'wechat-bot' 表示微信 bot 发送）
  source?: string;
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
    | 'ask_user_question'
    // SDK 系统消息类型（斜杠命令相关）
    | 'compact_boundary' | 'compacting' | 'local_command_output'
    | 'tool_group'  // 虚拟分组类型，仅在前端渲染前预处理时生成
    | 'task_summary';  // 虚拟聚合块，累积 Task* CRUD 调用形成当前任务清单
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
  // compact_boundary 相关字段
  compactTrigger?: 'manual' | 'auto';  // 压缩触发方式
  compactPreTokens?: number;           // 压缩前 token 数
  // 子代理相关字段（Agent tool_use / tool_result）
  isSubAgent?: boolean;                // 是否为子代理调用
  subAgentDescription?: string;        // 子代理任务描述
  subAgentType?: string;               // 子代理类型（general-purpose 等）
  subAgentId?: string;                 // 子代理 ID（agentId）
  subAgentStatus?: string;             // 子代理执行状态（completed/failed 等）
  subAgentDurationMs?: number;         // 子代理执行时长
  subAgentTokens?: number;             // 子代理 token 消耗
  subAgentToolUseCount?: number;       // 子代理工具调用次数
  subAgentResultText?: string;         // 子代理返回的文本结果
  /** tool_group 内部的子 block 列表（虚拟类型，不持久化） */
  children?: ContentBlock[];
  /** task_summary 块：当前会话累积的任务清单（虚拟，不持久化） */
  tasks?: Array<{
    id: string;
    subject: string;
    activeForm?: string;
    status: 'pending' | 'in_progress' | 'completed';
  }>;
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
  /** 右侧面板折叠控制（主页/独立会话窗口传入，渲染到右侧工具轨道顶部） */
  rightPanelToggle?: {
    open: boolean;
    onToggle: () => void;
  };
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
export interface ParsedFileRef {
  name: string;
  path: string;
}
export interface ParsedConversationRef {
  title: string;
  conversationId: string;
  sdkSessionId?: string;
}
export interface ParsedUserMessage {
  articleRefs: ParsedArticleRef[];
  snippetRefs: ParsedSnippetRef[];
  fileRefs: ParsedFileRef[];
  conversationRefs: ParsedConversationRef[];
  userMessage: string;
  /** /model 命令切换模型（如 anthropic/claude-sonnet-4.6） */
  modelSwitch?: string;
  /** 是否为 <local-command-stdout> 输出包装的用户消息 */
  localCommandStdout?: string;
  /** SDK 斜杠命令（从 <command-name> 格式解析） */
  slashCommand?: { name: string; args?: string };
}

/** parseSlashCommandMessage 返回类型 */
export interface ParsedSlashCommand {
  isCommand: boolean;
  commandName?: string;
  commandArgs?: string;
}
