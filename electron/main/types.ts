/**
 * Electron 主进程共享类型定义
 * 与 types/ 目录下的类型保持一致
 */

/** 权限拒绝记录（原 SDKPermissionDenial 的内联定义） */
export type PermissionDenial = {
  tool_name: string;
  tool_use_id: string;
  tool_input: Record<string, unknown>;
};

// ─── 用量监控类型（镜像自 types/usage.ts）───

export interface ToolCallRecord {
  name: string;
  count: number;
  files?: string[];
}

export interface ToolActivity {
  calls: ToolCallRecord[];
  totalCalls: number;
}

export interface PermissionWaitRecord {
  toolName: string;
  decision: 'allow' | 'deny' | 'always_allow' | 'allow_session';
  waitMs: number;
  requestedAt: number;
}

export interface ConversationUsageEntry {
  uuid: string;
  turnIndex: number;
  parentUuid?: string;
  timestamp: number;
  durationMs: number;
  durationApiMs: number;
  ttftMs?: number;
  numTurns: number;
  terminalReason?: string;
  stopReason?: string | null;
  isError: boolean;
  apiErrorStatus?: number;
  totalCostUsd: number;
  /** 本轮最后一次 LLM call 请求时点的真实上下文占用（轮内最后一条 CTX 的 totalTokens）；历史 entry 可能缺失 */
  lastContextTokens?: number;
  usage: {
    inputTokens: number;
    outputTokens: number;
    cacheCreationInputTokens: number;
    cacheReadInputTokens: number;
    cacheCreation?: { ephemeral5mInputTokens: number; ephemeral1hInputTokens: number };
    serviceTier?: 'standard' | 'priority' | 'batch';
    speed?: 'standard' | 'fast';
    serverToolUse?: { webSearchRequests: number; webFetchRequests: number };
  };
  modelUsage: Record<string, {
    inputTokens: number;
    outputTokens: number;
    cacheReadInputTokens: number;
    cacheCreationInputTokens: number;
    webSearchRequests: number;
    costUSD: number;
    contextWindow: number;
    maxOutputTokens: number;
  }>;
  toolActivity?: ToolActivity;
  subagentCalls?: Array<{
    agentId: string;
    totalTokens: number;
    totalToolUseCount: number;
    totalDurationMs: number;
    usage: ConversationUsageEntry['usage'];
  }>;
  permissionDenials?: PermissionDenial[];
  permissionWaits?: PermissionWaitRecord[];
}

export interface CompactMarker {
  uuid: string;
  timestamp: number;
  afterTurnIndex: number;
  trigger: 'manual' | 'auto';
  preTokens: number;
}

export interface ContextSnapshot {
  turnIndex: number;
  timestamp: number;
  totalTokens: number;
  maxTokens: number;
  percentage: number;
  model: string;
  categories: Array<{ name: string; tokens: number }>;
}

export interface ConversationUsage {
  entries: ConversationUsageEntry[];
  compactMarkers: CompactMarker[];
  latestContext?: ContextSnapshot;
  totals: {
    inputTokens: number;
    outputTokens: number;
    cacheCreationInputTokens: number;
    cacheReadInputTokens: number;
    totalCostUsd: number;
    turnCount: number;
    toolCallCount: number;
  };
}

export type UsageJsonlLine =
  | ({ kind: 'entry' } & ConversationUsageEntry)
  | ({ kind: 'compact' } & CompactMarker)
  | ({ kind: 'context' } & ContextSnapshot)
  | ({ kind: 'permission' } & PermissionWaitRecord);

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

// ─── 会话清洗 / 摘要类型（里程碑 2 Phase A）───

export interface CleanedTranscript {
  sessionId: string;
  transcript: string;
  turnCount: number;
  lastTimestamp: string;
  sourceMtime: number;
  stats: { originalBytes: number; cleanedChars: number; ratio: number };
}

// ─── 会话组（镜像自 types/group.ts）───

export interface Group {
  id: string;
  title?: string;
  /** title 为自动占坑名（首条消息截断）：AI 提炼 initialTitle / 用户改名可覆盖转正 */
  autoTitle?: boolean;
  createdAt: number;
  updatedAt: number;
  archivedAt?: number;
}

export interface NativeFileEntry {
  relPath: string;
  size: number;
  mtime: number;
}

// ─── Agent 协作模式（镜像自 types/delegation.ts）───

export type ChildStatus =
  | 'running'
  | 'stopped';

/** stopped 时的死因（调度内部字段，不进快照）：驱动重试决策与终态通知判定 */
export type ChildTerminalReason = 'failed' | 'hang' | 'timeout' | 'cancelled' | 'no_delivery';

export interface DelegateSpec {
  task: string;
  /** 交付文件在共享区的相对路径；缺省 = 通讯型交付（答案在交付消息正文） */
  outputPath?: string;
  title?: string;
  /** 子会话 Profile 名称或 id；未指定时用默认 Profile */
  profile?: string;
  /** 显式指定的模型 ID（piModels 里的模型 id 原文）；在所有完整 ModelProfile 的 piModels 里解析为 profileId+tier，解析不到则创建失败 */
  model?: string;
}

export interface ChildStateSnapshot {
  childId: string;
  parentConversationId: string;
  groupId: string;
  outputPath: string;
  /** 派遣时的任务描述（与 startChild 时 DelegateSpec.task 一致） */
  task: string;
  title: string;
  status: ChildStatus;
  /** 交付事实（dogear__SendMessage delivery:true 单调落上，与状态机独立） */
  delivered: boolean;
  startedAt: number;
  finishedAt?: number;
  /** stopped 时的死因文本 */
  lastError?: string;
  /** 实际命中的子会话 Profile 名（匹配不到时为 fallback 的「默认」） */
  profileName: string;
  /** 该会话自身的 Harness sessionId；attachConversation 完成、PiSession 启动后立即同步赋值 */
  sessionId?: string;
  /** 最近一次流事件时间戳（滑动 idle 计时打点，检测 hang 用） */
  lastActivityAt?: number;
}

// ─── 系统提示词展示段（session-append-templates 产出，tipc/ability 聚合消费）───

export interface SystemPromptSegment {
  key: string;
  label: string;
  category: 'reference' | 'group' | 'notes' | 'sub-agent' | 'tool-guide' | 'memory';
  template: string;
  triggerDescription: string;
  isDynamic: boolean;
}
