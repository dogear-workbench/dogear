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
  'article-parser': ['article', 'browser'],
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

export interface AbilityDomainMeta {
  id: string;
  label: string;
  description: string;
  skills: string[];
}

export const ABILITY_DOMAINS: AbilityDomainMeta[] = [
  {
    id: 'stock',
    label: '股票分析',
    description: '行情、技术指标、公告与长期候选池',
    skills: ['stock-analysis', 'stock-picking'],
  },
  {
    id: 'article',
    label: '文章解析',
    description: '文章读取、网页渲染解析与管理（含内嵌浏览器工具包）',
    skills: ['article-parser'],
  },
  {
    id: 'code-workflow',
    label: '代码工作流',
    description: '规划、实施、调试等开发流程 Skill，无工具包',
    skills: [
      'brainstorming',
      'codebase-map',
      'doc-sync',
      'staged-execution',
      'staged-impl',
      'systematic-debugging',
    ],
  },
];

export const CUSTOM_DOMAIN_META: AbilityDomainMeta = {
  id: 'custom',
  label: '自定义 Skill',
  description: '工作区 .dogear/skills 下的自有 Skill',
  skills: [],
};

export const GENERIC_DOMAIN_META: AbilityDomainMeta = {
  id: 'generic',
  label: '通用 Skill',
  description: '未归类到具体能力域的 Skill 模板',
  skills: [],
};

export interface DomainSkillItem {
  name: string;
  description?: string;
  badge?: string;
  enabled: boolean;
  packServers: string[];
}

export interface DomainPackItem {
  name: string;
  server: string;
  label: string;
  description: string;
  requirements?: string;
  enabled: boolean;
  toolCount: number;
  tools?: ToolInfo[];
}

export interface AbilityDomainView {
  id: string;
  label: string;
  description: string;
  skills: DomainSkillItem[];
  packs: DomainPackItem[];
  allOn: boolean;
}

export function buildDomainViews(args: {
  templates: SkillTemplate[];
  skills: SkillEntry[];
  packs: ToolPack[];
  groupByServer: Record<string, ToolGroup>;
  enabledSkills: Set<string>;
}): AbilityDomainView[] {
  const { templates, skills, packs, groupByServer, enabledSkills } = args;
  const packByName = new Map(packs.map((p) => [p.name, p]));
  const templateByName = new Map(templates.map((t) => [t.name, t]));
  const templateNames = new Set(templates.map((t) => t.name));

  const buildSkills = (names: string[], badge?: string): DomainSkillItem[] =>
    names
      .map((name): DomainSkillItem | null => {
        const packServers = (SKILL_PACK_MAP[name] ?? [])
          .map((n) => packByName.get(n)?.mcpServer)
          .filter((s): s is string => !!s);
        const fromTemplate = templateByName.get(name);
        const fromEntry = skills.find((s) => s.name === name);
        if (!fromTemplate && !fromEntry) return null;
        return {
          name,
          description: fromTemplate?.description || fromEntry?.description,
          badge,
          enabled: enabledSkills.has(name),
          packServers,
        };
      })
      .filter((s): s is DomainSkillItem => s !== null);

  const buildPacks = (skillNames: string[]): DomainPackItem[] => {
    const packNames = new Set<string>();
    for (const n of skillNames) {
      for (const p of SKILL_PACK_MAP[n] ?? []) packNames.add(p);
    }
    return Array.from(packNames)
      .map((n): DomainPackItem | null => {
        const p = packByName.get(n);
        if (!p) return null;
        return {
          name: p.name,
          server: p.mcpServer,
          label: p.label,
          description: p.description,
          requirements: p.requirements,
          enabled: p.enabled,
          toolCount: p.toolCount,
          tools: groupByServer[p.mcpServer]?.tools,
        };
      })
      .filter((p): p is DomainPackItem => p !== null);
  };

  const views: AbilityDomainView[] = [];
  const assigned = new Set(ABILITY_DOMAINS.flatMap((d) => d.skills));

  for (const meta of ABILITY_DOMAINS) {
    const domainSkills = buildSkills(meta.skills, '可选');
    if (domainSkills.length === 0) continue;
    views.push({
      id: meta.id,
      label: meta.label,
      description: meta.description,
      skills: domainSkills,
      packs: buildPacks(meta.skills),
      allOn: domainSkills.every((s) => s.enabled),
    });
  }

  const genericNames = templates.filter((t) => !assigned.has(t.name)).map((t) => t.name);
  if (genericNames.length > 0) {
    const domainSkills = buildSkills(genericNames, '可选');
    views.push({
      id: GENERIC_DOMAIN_META.id,
      label: GENERIC_DOMAIN_META.label,
      description: GENERIC_DOMAIN_META.description,
      skills: domainSkills,
      packs: [],
      allOn: domainSkills.every((s) => s.enabled),
    });
  }

  const customSkills = skills.filter((s) => s.source !== 'builtin' && !templateNames.has(s.name));
  if (customSkills.length > 0) {
    const domainSkills = customSkills.map((s) => ({
      name: s.name,
      description: s.description,
      badge: SKILL_SOURCE_LABELS[s.source],
      enabled: enabledSkills.has(s.name),
      packServers: [],
    }));
    views.push({
      id: CUSTOM_DOMAIN_META.id,
      label: CUSTOM_DOMAIN_META.label,
      description: CUSTOM_DOMAIN_META.description,
      skills: domainSkills,
      packs: [],
      allOn: domainSkills.every((s) => s.enabled),
    });
  }

  return views;
}
