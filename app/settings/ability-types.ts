export interface ToolInfo {
  name: string;
  shortDescription: string;
  description: string;
  server: string;
}

export interface ToolGroup {
  server: string;
  label: string;
  tools: ToolInfo[];
}

export interface ToolPack {
  name: string;
  label: string;
  description: string;
  mcpServer: string;
  toolCount: number;
  requiresWorkspace: boolean;
  requirements?: string;
  enabled: boolean;
}

export type SkillSource = 'builtin' | 'custom' | 'user';

export interface SkillEntry {
  source: SkillSource;
  name: string;
  description?: string;
  dir: string;
  filePath: string;
  enabled: boolean;
}

export interface SkillTemplate {
  name: string;
  description: string;
}

export const SKILL_PACK_MAP: Record<string, string[]> = {
  'stock-analysis': ['stock-quote', 'stock-analysis', 'stock-announcement'],
  'stock-picking': ['stock-picking'],
  'article-parser': ['article'],
};

export const RESIDENT_GROUPS = [
  { server: 'dogear-memory', label: '记忆系统', injectNote: '主会话且绑定工作区时注册' },
  { server: 'dogear-notes', label: '笔记卡片', injectNote: '主会话且绑定工作区时注册' },
  { server: 'dogear-delegation', label: 'Agent 协作', injectNote: '会话属于组时注册' },
  { server: 'dogear-group', label: '会话组共享区', injectNote: '会话属于组时注册' },
  { server: 'dogear-reference', label: '跨会话引用', injectNote: '会话属于组时注册' },
] as const;

export const SKILL_SOURCE_LABELS: Record<SkillSource, string> = {
  builtin: '内置',
  custom: '自定义',
  user: '用户级',
};
