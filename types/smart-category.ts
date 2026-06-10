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
