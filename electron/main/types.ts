/**
 * Electron 主进程共享类型定义
 * 与 types/ 目录下的类型保持一致
 */
import type { SDKPermissionDenial } from '@anthropic-ai/claude-agent-sdk';

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
  permissionDenials?: SDKPermissionDenial[];
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

// ─── 智能分类类型（镜像自 types/smart-category.ts）───

export interface DigestTags {
  primary: string;
  secondary: string[];                  // 0–3 个
  scores: Record<string, number>;       // 含 primary 与 secondary 全部标签的 0–1 适配度
}

export interface SmartCategory {
  id: string;
  name: string;
  anchorTags: string[];
  conversationIds: string[];
  createdAt: string;                    // ISO
  updatedAt: string;                    // ISO
}

export interface CategorizeDecisionLog {
  time: string;                         // ISO
  conversationId: string;
  decision: 'match' | 'join' | 'new' | 'skip' | 'error';
  reason?: string;
}

export interface SmartCategoriesIndex {
  categories: SmartCategory[];
  recentDecisions: CategorizeDecisionLog[];   // 环形，最多 20 条
}

/** 智能分类任务一次执行的结果记录（环形缓冲项） */
export interface CategorizeRecentEntry {
  workspaceId: string;
  kind: 'incremental' | 'full-rebuild';
  conversationId?: string;
  finishedAt: number;
  outcome: 'match' | 'join' | 'new' | 'skip' | 'error' | 'cancelled';
  decisions?: Record<string, number>;
  tier?: string;
  profileName?: string;
  error?: string;
  durationMs: number;
}

/** 智能分类活动总览（全局单队列，不按 workspaceId 区分） */
export interface CategorizeActivity {
  current: {
    workspaceId: string;
    conversationId?: string;
    kind: 'incremental' | 'full-rebuild';
    startedAt: number;
    taskId: string;
  } | null;
  queueDepth: number;
  recent: CategorizeRecentEntry[];
  lastScan: { at: number; dirtyCount: number } | null;
}

// ─── 会话组（镜像自 types/group.ts）───

export interface SharedReferenceBase {
  id: string;
  addedAt: number;
  label?: string;
}

export type SharedReference =
  | (SharedReferenceBase & { type: 'file'; path: string })
  | (SharedReferenceBase & { type: 'conversation'; conversationId: string })
  | (SharedReferenceBase & { type: 'article'; articleId: string });

export interface Group {
  id: string;
  title?: string;
  createdAt: number;
  updatedAt: number;
  sharedReferences: SharedReference[];
}

export interface NativeFileEntry {
  relPath: string;
  size: number;
  mtime: number;
}
