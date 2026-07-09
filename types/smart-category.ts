export interface DigestTags {
  primary: string;
  secondary: string[];                  // 0–3 个
  scores: Record<string, number>;       // 含 primary 与 secondary 全部标签的 0–1 适配度
}

export interface SmartCategory {
  id: string;
  name: string;
  anchorTags: string[];
  groupIds: string[];
  createdAt: string;                    // ISO
  updatedAt: string;                    // ISO
}

export interface CategorizeDecisionLog {
  time: string;                         // ISO
  groupId: string;
  decision: 'match' | 'join' | 'new' | 'skip' | 'error' | 'merge' | 'prune';
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
  groupId?: string;                     // full-rebuild 时可能缺省
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
    groupId?: string;                   // full-rebuild 时可能缺省
    kind: 'incremental' | 'full-rebuild';
    startedAt: number;
    taskId: string;
  } | null;
  queueDepth: number;
  recent: CategorizeRecentEntry[];
  lastScan: { at: number; dirtyCount: number } | null;
}
