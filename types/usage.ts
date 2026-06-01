import type { SDKPermissionDenial } from '@anthropic-ai/claude-agent-sdk';

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

  toolCalls: Array<{ name: string; count: number }>;
  subagentCalls?: Array<{
    agentId: string;
    totalTokens: number;
    totalToolUseCount: number;
    totalDurationMs: number;
    usage: ConversationUsageEntry['usage'];
  }>;
  permissionDenials?: SDKPermissionDenial[];
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
  | ({ kind: 'context' } & ContextSnapshot);
