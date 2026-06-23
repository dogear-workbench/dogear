import type { SDKPermissionDenial } from '@anthropic-ai/claude-agent-sdk';

/** 单个工具的本 entry 调用记录 */
export interface ToolCallRecord {
  /** 工具名，如 'Read' / 'Edit' / 'Bash' */
  name: string;
  /** 本 entry 内该工具被调用次数 */
  count: number;
  /** Read 工具专属：命中的 file_path 列表（去重，按调用顺序） */
  files?: string[];
}

/** 工具活动聚合（结构预留扩展） */
export interface ToolActivity {
  /** 本 entry 内所有工具调用记录，按 count desc 排序 */
  calls: ToolCallRecord[];
  /** 本 entry 内工具调用总数（含重复） */
  totalCalls: number;
}

/** 一次权限请求的等待时长记录 */
export interface PermissionWaitRecord {
  /** 权限请求对应的 tool name（如 'Bash'） */
  toolName: string;
  /** 用户决策结果，与 SDK behavior 对齐 */
  decision: 'allow' | 'deny' | 'always_allow' | 'allow_session';
  /** 从请求发出到用户响应的等待毫秒数 */
  waitMs: number;
  /** 请求时间戳（ms，便于跨 entry 对齐） */
  requestedAt: number;
}

export interface ConversationUsageEntry {
  // 标识
  uuid: string;
  turnIndex: number;
  parentUuid?: string;
  timestamp: number;

  // 时序
  durationMs: number;
  durationApiMs: number;
  ttftMs?: number;
  numTurns: number;

  // 结果
  terminalReason?: string;
  stopReason?: string | null;
  isError: boolean;
  apiErrorStatus?: number;

  // 成本（存但 UI 不显示）
  totalCostUsd: number;

  usage: {
    inputTokens: number;
    outputTokens: number;
    cacheCreationInputTokens: number;
    cacheReadInputTokens: number;
    cacheCreation?: {
      ephemeral5mInputTokens: number;
      ephemeral1hInputTokens: number;
    };
    serviceTier?: 'standard' | 'priority' | 'batch';
    speed?: 'standard' | 'fast';
    serverToolUse?: {
      webSearchRequests: number;
      webFetchRequests: number;
    };
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

  /** 工具活动聚合；optional 兼容旧 JSONL 行（旧行此字段缺失） */
  toolActivity?: ToolActivity;
  subagentCalls?: Array<{
    agentId: string;
    totalTokens: number;
    totalToolUseCount: number;
    totalDurationMs: number;
    usage: ConversationUsageEntry['usage'];
  }>;
  permissionDenials?: SDKPermissionDenial[];
  /** 权限等待记录，由独立 JSONL 行（kind='permission'）聚合而来 */
  permissionWaits?: PermissionWaitRecord[];
}

export interface CompactMarker {
  uuid: string;
  timestamp: number;
  afterTurnIndex: number;
  trigger: 'manual' | 'auto';
  preTokens: number;
}

/** 某轮结束时的上下文窗口真实快照（来自 SDK query.getContextUsage()） */
export interface ContextSnapshot {
  turnIndex: number;
  timestamp: number;
  totalTokens: number;   // 当前上下文占用
  maxTokens: number;     // 压缩上限（SDK 权威值）
  percentage: number;
  model: string;
  categories: Array<{ name: string; tokens: number }>;
}

export interface ConversationUsage {
  entries: ConversationUsageEntry[];
  compactMarkers: CompactMarker[];
  /** 最近一次落盘的上下文快照；旧对话或采集失败时为空 */
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
