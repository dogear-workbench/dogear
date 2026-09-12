/**
 * 共享数据类型定义
 * 供主进程和渲染进程共同使用的数据结构类型
 * 注意：IPC 通信的类型安全由 @egoist/tipc 提供，不再需要手动定义 API 接口
 */

import type { ModelSelection } from './settings';

/** Pi 会话权限模式。 */
export type PermissionMode = 'default' | 'autoExecute';

/**
 * 附加路径（兼容格式）
 */
export interface AdditionalPathData {
  path: string;
  enabled: boolean;
}

/**
 * 工作区配置（.dogear/workspaces/<id>/config.json）
 */
export interface WorkspaceConfig {
  enabledToolPacks: string[];
  enabledSkills: string[];
  /** 只存显式拨过的能力包开关，缺省走注册表 defaultEnabled；残留下线 key 静默忽略 */
  abilityOverrides?: Record<string, boolean>;
}

/**
 * 工作区接口
 */
export interface Workspace {
  id: string;
  name: string;
  path: string;
  additional_paths: AdditionalPathData[];
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
  /** 文章专属字段（type='article' 时存在） */
  articleMeta?: {
    id: string;
    url: string;
    siteName: string | null;
    fetchedAt: number;
    wordCount: number;
    parseStatus?: string;
  };
}

/**
 * 扩展的会话消息类型
 * 用于显示完整的 AI 操作（工具调用、思考过程等）
 */
export interface ExtendedSessionMessage {
  type: 'text' | 'tool_use' | 'tool_result' | 'thinking' | 'status' | 'error' | 'result' | 'user' | 'message_id' | 'permission_request'
    // Hook 事件类型
    | 'session_start'       // SessionStart hook 触发
    | 'session_end'         // SessionEnd hook 触发
    | 'stop'                // Stop hook 触发
    | 'tool_failure'        // PostToolUseFailure hook 触发
    | 'notification'        // Notification hook 触发
    | 'task_notification'   // 子代理任务通知
    | 'ask_user_question'   // AskUserQuestion 工具触发
  ;
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
  // 是否为重放的历史消息（SDK resume 时使用）
  isReplay?: boolean;
  // 消息级稳定 ID：message_id 事件 = harness SessionTreeEntry.id（与历史 sdkUuid 同源）；compact_boundary = compaction entry id
  uuid?: string;
  // message_id 事件指向的落盘消息角色（user 无 model）
  role?: 'user' | 'assistant';
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
}

/**
 * 契约元数据（Agent 协作模式）
 * 手动创建的会话此字段为 undefined；agent 派出的会话必填
 */
export interface ContractMetadata {
  parentSessionId: string;           // 派出者的 sessionId
  task: string;                      // 派出时的任务描述
  expectedOutputPath?: string;       // 约定的交付路径
  createdBy: 'agent' | 'human';
  subAgentProfileId?: string;        // 派出时选用的子会话 Profile id；缺省视为默认 Profile
}

/**
 * 对话接口
 */
export interface Conversation {
  id: string;
  workspace_id: string;              // 关联的工作区ID
  title: string;
  model: string;
  session_id?: string;               // Harness 持久化 sessionId（用于恢复/删除/分叉）
  parent_conversation_id?: string;   // 父对话ID（分叉对话，v4）
  fork_message_sdk_uuid?: string;    // 分叉点标识（Harness 迁移后是 SessionTreeEntry id）
  modelSelection: ModelSelection | null;  // 对话级模型；null=未选(发送被门禁拦下)
  fork_pending?: boolean;            // @deprecated SDK 时代的分叉待定态，Harness fork 已同步创建不再产生
  groupId: string;                   // 所属会话组 ID
  role: 'main' | 'sub';             // P1 只产生 'main'
  contractMetadata?: ContractMetadata; // Agent 派出契约元数据；手动会话为 undefined
  usageSummary?: {
    turnCount: number;
    totalInputTokens: number;
    totalOutputTokens: number;
    totalCacheReadTokens: number;
    lastContextSize?: number;
    lastContextWindow?: number;
  };
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
export type { AIMessage } from './ai';
export type { AgentTask, AgentTaskUpdate, TaskStatus, TaskType, ChatSessionPayload } from './agents';
