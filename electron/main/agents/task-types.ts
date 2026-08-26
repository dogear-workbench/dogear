/**
 * Agent 任务类型定义
 * 定义主进程与 Agent Worker 之间的通信协议
 */

import type { ModelSelection } from '../services/settings-types.js';

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
  READING_ASSIST = 'reading_assist', // 阅读辅助
  PARSE_ARTICLE = 'parse_article',  // 文章解析（质量检查 + AI 重新解析）
  GROUP_DIGEST_SESSION = 'group_digest_session', // 组级摘要卡提炼（Phase 3）
  REVIEW_SESSION = 'review_session', // 跨会话复盘（摘要卡 → 复盘卡）
  CATEGORIZE_SESSION = 'categorize_session', // 智能分类决策
  CATEGORIZE_ORGANIZE = 'categorize_organize', // 存量分类整理（压 anchorTags + 合并重合分类）
  CUSTOM_AGENT = 'custom_agent' // 定时计划自定义 agent 任务（prompt 驱动的一次性执行）
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
 * 阅读辅助任务负载
 */
export interface ReadingAssistPayload {
  text: string;
  action: 'explain' | 'translate' | 'expand';
  language?: string;
}

/**
 * 扩展的会话消息类型
 * 用于向前端传递完整的 AI 操作（工具调用、思考过程等）
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
    // SDK 系统消息类型（斜杠命令相关）
    | 'compact_boundary'    // 对话压缩分隔线
    | 'compacting'          // 正在压缩中
    | 'local_command_output'; // 本地命令输出
  content?: string;
  toolName?: string;
  toolInput?: any;
  toolOutput?: any;
  toolUseId?: string;
  status?: string;
  error?: string;
  isError?: boolean;               // 工具执行是否出错（用于 tool_result 类型）
  timestamp: number;
  isReplay?: boolean;              // 是否为重放的历史消息（SDK resume 时使用）
  uuid?: string;                   // 消息级稳定 ID：message_id 事件 = harness SessionTreeEntry.id（与历史 sdkUuid 同源）；compact_boundary = compaction entry id
  role?: 'user' | 'assistant';     // message_id 事件指向的落盘消息角色（user 无 model）
  model?: string;                  // AI 使用的实际模型名称
  // 权限请求相关字段（type='permission_request' 时使用）
  permissionRequestId?: string;    // 请求 ID（用于回传结果）
  permissionToolName?: string;     // 请求权限的工具名
  permissionInput?: any;           // 工具输入参数
  permissionDecisionReason?: string; // 权限请求原因说明
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
  // compact_boundary 相关字段
  compactTrigger?: 'manual' | 'auto';  // 压缩触发方式
  compactPreTokens?: number;           // 压缩前 token 数
  // 子代理相关字段（Agent 工具的 tool_result 附带的元数据）
  subAgentId?: string;                 // 子代理 agentId
  subAgentStatus?: string;             // 子代理执行状态
  subAgentDurationMs?: number;         // 子代理执行时长
  subAgentTokens?: number;             // 子代理 token 消耗
  subAgentToolUseCount?: number;       // 子代理工具调用次数
  subAgentResultText?: string;         // 子代理返回的文本结果
}

/**
 * 文章解析任务负载
 */
export interface ParseArticlePayload {
  articleId: string;
  articleDir: string;        // 绝对路径：<workspace>/.dogear/articles/<id>
  workspacePath: string;     // 工作区路径（saveArticle 需要）
  url: string;
  skillsDir: string;         // 全局 Skill 目录：<configDir>/skills/article-parser

  // V2: trigger context
  platform: string | null;
  trigger: 'script_failed' | 'parse_failed' | 'user_requested';
  scriptError?: { type: string; message: string };
  readabilityError?: string;

  modelSelection?: ModelSelection | null;

  // V1 compat (kept temporarily)
  fixedParseSuccess?: boolean;
}

/**
 * 组级摘要卡提炼任务负载（Phase 3）
 * 运行时上下文（configDir/isPackaged/cliPath）由 Worker 实例字段提供，不放 payload
 */
export interface GroupDigestSessionPayload {
  workspaceId: string;       // 工作区 ID
  workspacePath: string;     // 工作区绝对路径（定位 JSONL 用）
  groupId: string;           // 组 ID
  dirtyConversations: Array<{ conversationId: string; sessionId: string; mtime: number }>;
  hasExistingCard: boolean;
  modelSelection?: ModelSelection; // 任务级模型覆盖（缺省读 settings.digestModelSelection）
}

/**
 * 跨会话复盘任务负载
 * 运行时上下文（configDir/isPackaged/cliPath）由 Worker 实例字段提供，不放 payload
 */
export interface ReviewSessionPayload {
  workspaceId: string;   // 工作区 ID（读摘要卡 / 落复盘卡）
  workspacePath: string; // 工作区绝对路径（dogear__TraceSource 定位 JSONL 用）
  modelSelection?: ModelSelection; // 任务级模型覆盖（缺省读 settings.reviewModelSelection）
}

/**
 * 智能分类任务负载
 * mode='incremental'：处理单条新摘要卡（DigestSession 串联触发）
 * mode='full-rebuild'：清空索引后对所有摘要卡按 createdAt 升序串行决策（设置页"立即重跑全部分类"用）
 * 运行时上下文（configDir/isPackaged/cliPath）由 Worker 实例字段提供，不放 payload
 */
export interface CategorizeSessionPayload {
  workspaceId: string;       // 工作区 ID
  workspacePath: string;     // 工作区绝对路径（保留，未来 trace 用）
  mode: 'incremental' | 'full-rebuild';
  groupId?: string;              // incremental 必填
  groupDigestPath?: string;      // incremental 必填，组卡 .md 文件绝对路径
  modelSelection?: ModelSelection; // 任务级模型覆盖（缺省读 settings.categorizeModelSelection）
}

/**
 * 存量分类整理任务负载（一键整理现有标签，设置页按钮触发）
 * 与 CATEGORIZE_SESSION 共享同一串行队列（category-trigger），天然互斥。
 * 运行时上下文（configDir/isPackaged/cliPath）由 Worker 实例字段提供，不放 payload
 */
export interface CategorizeOrganizeSessionPayload {
  workspaceId: string;       // 工作区 ID
  modelSelection?: ModelSelection; // 任务级模型覆盖（缺省读 settings.categorizeModelSelection）
}

/**
 * 定时计划自定义 agent 任务负载（scheduler task-runner 派发）
 * 运行时上下文（configDir）由 Worker 实例字段提供，不放 payload
 */
export interface CustomAgentTaskPayload {
  taskName: string;             // 任务显示名（ScheduledTask.name）
  prompt: string;               // 用户编写的任务指令
  modelSelection?: ModelSelection; // 任务级模型覆盖（缺省读 settings.ai.defaultModelSelection）
  workspaceId: string;          // 工作区 ID（读工作区工具包开关用）
  workspacePath: string;        // 工作区绝对路径（文件工具边界根）
  toolPacksOverride?: string[]; // 任务级工具包覆盖（undefined = 跟随工作区 enabledToolPacks）
}

/**
 * Agent Worker 配置
 */
export interface AgentWorkerConfig {
  workerId: string;              // Worker ID
  taskId?: string;               // 当前处理任务 ID (可选)
  messagePort?: any;             // 通信端口
  workspacePath?: string;        // 工作区路径 (可选,用于 Worker 线程)
  configDir: string;             // .dogear 配置目录路径（由主进程预计算后传入）
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
  // Phase 3/4: 文章解析状态变化
  | { type: 'articleParseStatusChanged'; articleId: string; workspacePath: string; parseStatus: 'script_ok' | 'fixed' | 'ai_parsing' | 'ai_enhanced' | 'quality_warning' | 'failed' };