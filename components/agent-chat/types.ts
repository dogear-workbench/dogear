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
  // 消息级稳定 ID = 主进程 SessionTreeEntry.id；assistant 合并消息 = 最后一个 entry id（与 sdkUuid 同值）
  id?: string;
  // assistant 合并消息覆盖的全部 SessionTreeEntry id（按落盘顺序）；user/compaction 为单元素
  entryIds?: string[];
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
    | 'tool_group';  // 虚拟分组类型，仅在前端渲染前预处理时生成
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
  // 是否为重放的历史消息（SDK resume 时使用）
  isReplay?: boolean;
  // 权限请求相关字段（type='permission_request' 时使用）
  permissionRequestId?: string;
  permissionToolName?: string;
  permissionInput?: any;
  permissionDecisionReason?: string;
  permissionResolved?: 'allow' | 'deny' | 'always_allow' | 'allow_session';  // 用户已响应的状态
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
  askUserCancelled?: boolean;               // 是否被用户中断（点了停止按钮）
  // compact_boundary 相关字段
  compactTrigger?: 'manual' | 'auto';  // 压缩触发方式
  compactPreTokens?: number;           // 压缩前 token 数
  /** tool_group 内部的子 block 列表（虚拟类型，不持久化） */
  children?: ContentBlock[];
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
  /** 会话所属工作区（tab 携带；缺省回落全局 workspace store，兼容不传 props 的调用点） */
  workspaceId?: string | null;
  /** 是否处于可见 tab；隐藏 tab 使用低频流刷新 */
  visible?: boolean;
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
  type?: 'file' | 'folder';
}
export interface ParsedConversationRef {
  title: string;
  conversationId: string;
  sessionId?: string;
  workspaceId?: string;
}
export interface ParsedSharedFileRef {
  groupId: string;
  relPath: string;
  absPath: string;
}
export interface ParsedUserMessage {
  articleRefs: ParsedArticleRef[];
  snippetRefs: ParsedSnippetRef[];
  fileRefs: ParsedFileRef[];
  conversationRefs: ParsedConversationRef[];
  sharedFileRefs: ParsedSharedFileRef[];
  userMessage: string;
  /** 跨会话消息来源标记；未标记默认按 role 推断（agent = 跨会话代表发来，human = 用户手打） */
  senderKind?: 'agent' | 'human';
  /** agent 消息时，发送者 sdk session id */
  senderSessionId?: string;
  /** 发送者显示名（拍照，避免后续重命名/删除后拿不到） */
  senderDisplayName?: string;
  /** 是否为正式交付（dogear__SendMessage 的 delivery=true） */
  senderIsDelivery?: boolean;
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
