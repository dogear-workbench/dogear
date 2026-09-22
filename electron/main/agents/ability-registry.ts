/**
 * 能力包注册表（单一真源）
 *
 * 能力包 = 提示词段 + 工具组 + skill 的任意组合，是能力页展示与会话拼装的共同数据源。
 * 本文件只做数据与解析，不产生运行行为；拼装侧（pi-session）消费 resolveAbilities 的结果。
 */

import type { WorkspaceConfig } from '../services/workspace-config-service.js';
import type { SubAgentProfile } from '../services/settings-types.js';
import type { SystemPromptSegmentKey } from './session-append-templates.js';

export type AbilityPackType = 'prompt-only' | 'segment-tools' | 'skill-packs';

export interface AbilityPack {
  key: string;
  label: string;
  description: string;
  type: AbilityPackType;
  segmentKeys?: SystemPromptSegmentKey[];
  /**
   * 工具组标识，混合存两类 ID（集合不相交）：
   * - 常驻组存 MCP server 名（dogear-memory 等，不在 OPTIONAL_TOOL_PACKS）
   * - 可选包存工具包 name（stock-quote 等，可经 OPTIONAL_TOOL_PACKS 查 mcpServerName）；
   *   例外：browser 包的 'dogear-extension' 是 server 名（扩展通道并入包内展示，无独立开关）
   */
  toolGroups?: string[];
  skills?: string[];
  /** 仅主会话生效（子会话不挂载工具） */
  mainOnly?: boolean;
  defaultEnabled: boolean;
  icon?: string;
}

/**
 * skill → 可选工具包 name 映射（自 app/settings/ability-types.ts 迁入）。
 * skill 型包生效是总开关，包内单个 skill 的子开关在 workspace config 的 enabledSkills，生效 = 双开交集。
 */
export const SKILL_PACK_MAP: Record<string, string[]> = {
  'stock-analysis': ['stock-quote', 'stock-analysis', 'stock-announcement'],
  'stock-picking': ['stock-picking'],
  'article-parser': ['article'],
  'browser-exploration': ['browser'],
};

export const ABILITY_PACKS: AbilityPack[] = [
  {
    key: 'workspace-rules',
    label: '工作区规则',
    description: '读取工作区 agent.md 注入每个会话，承载项目级约定与偏好',
    type: 'prompt-only',
    defaultEnabled: true,
  },
  {
    key: 'global-rules',
    label: '全局规则',
    description: '读取用户级全局规则注入每个会话，跨工作区生效',
    type: 'prompt-only',
    defaultEnabled: true,
  },
  {
    key: 'core-profile',
    label: '核心画像',
    description: '核心画像文本注入每个会话，描述用户偏好与工作方式（数据中心维护）',
    type: 'prompt-only',
    defaultEnabled: true,
  },
  {
    key: 'memory',
    label: '记忆系统',
    description: '记忆工具（召回/保存）+ 记忆写入纪律段，绑定工作区时生效',
    type: 'segment-tools',
    segmentKeys: ['memory-guidance'],
    toolGroups: ['dogear-memory'],
    defaultEnabled: true,
  },
  {
    key: 'notes',
    label: '笔记卡片',
    description: '笔记卡片 + 任务系统两组工具 + 存卡纪律段，主会话且绑定工作区时生效（任务执行会话派单保底不受开关约束）',
    type: 'segment-tools',
    segmentKeys: ['notes-discipline'],
    toolGroups: ['dogear-notes', 'dogear-tasks'],
    defaultEnabled: true,
  },
  {
    key: 'workspace-git',
    label: 'git 版本管理',
    description: '工作区双层 git 工具组（查历史/diff/blame、正式提交、回退、影子快照）+ git 历史意识段，绑定工作区时生效（主/子会话）',
    type: 'segment-tools',
    segmentKeys: ['git-history-guidance'],
    toolGroups: ['dogear-git'],
    defaultEnabled: true,
  },
  {
    key: 'group-context',
    label: '会话组',
    description: '组上下文段（组头 + 话题状态）+ 组状态卡工具，会话属于某个组时生效',
    type: 'segment-tools',
    segmentKeys: ['group-context'],
    toolGroups: ['dogear-group-context'],
    defaultEnabled: true,
  },
  {
    key: 'agent-collab',
    label: 'Agent 协作',
    description: '派遣子会话、会话组共享区、兄弟会话三组工具 + 主会话协作规范段 + 子会话交付契约段（子会话强制生效）',
    type: 'segment-tools',
    segmentKeys: ['main-agent-delegation', 'sub-agent-contract'],
    toolGroups: ['dogear-delegation', 'dogear-group', 'dogear-sibling'],
    defaultEnabled: true,
  },
  {
    key: 'shunt',
    label: '会话分流',
    description: '岔题分流：岔题时输出建议卡，用户确认后平级分出新会话/新话题或记为笔记（note 动作依赖笔记卡片包的建卡工具）',
    type: 'segment-tools',
    segmentKeys: ['shunt-guidance'],
    toolGroups: ['dogear-shunt'],
    mainOnly: true,
    defaultEnabled: true,
  },
  {
    key: 'stock',
    label: '股票分析',
    description: '股票分析与选股 skill + 行情/分析/公告/候选池四个工具包',
    type: 'skill-packs',
    skills: ['stock-analysis', 'stock-picking'],
    toolGroups: ['stock-quote', 'stock-analysis', 'stock-announcement', 'stock-picking'],
    defaultEnabled: false,
  },
  {
    key: 'article',
    label: '文章解析',
    description: '文章解析 skill + 文章管理工具包（读取/列举工作区文章）',
    type: 'skill-packs',
    skills: ['article-parser'],
    toolGroups: ['article'],
    defaultEnabled: false,
  },
  {
    key: 'browser',
    label: '浏览器',
    description: '浏览器调研方法论 skill + 双通道工具组：内嵌浏览器（读文章/搜索/原子探索）+ 浏览器扩展通道（用户真实浏览器标签页操作，登录态站点优先）',
    type: 'skill-packs',
    skills: ['browser-exploration'],
    toolGroups: ['browser', 'dogear-extension'],
    defaultEnabled: false,
  },
  {
    key: 'web-mcp',
    label: '联网搜索',
    description: 'GLM 联网搜索与网页读取工具包（web_search_prime / webReader），API 直出快档，与浏览器工具互补；需在设置页配置 GLM Coding Plan API Key',
    type: 'skill-packs',
    toolGroups: ['web-mcp'],
    defaultEnabled: false,
  },
  {
    key: 'code-workflow',
    label: '代码工作流',
    description: '规划、实施、调试等开发流程 skill，无工具包',
    type: 'skill-packs',
    skills: [
      'brainstorming',
      'codebase-map',
      'doc-sync',
      'staged-execution',
      'staged-impl',
      'systematic-debugging',
    ],
    defaultEnabled: false,
  },
];

export interface ResolveAbilitiesOpts {
  role: 'main' | 'sub';
  /**
   * executor 只裁剪 notes 段不裁剪工具组（现状行为），包级解析不剔除任何包；
   * 段级裁剪发生在拼装侧，此字段仅供调用方透传上下文。
   */
  isExecutor?: boolean;
  groupId?: string | null;
  hasWorkspace: boolean;
  profile?: SubAgentProfile | null;
}

/**
 * 解析生效能力包：工作区包开关（abilityOverrides 覆盖 defaultEnabled，残留下线 key 静默忽略）
 * ∩ 触发条件 ∩ 子会话 Profile 过滤。子会话契约段与 Profile 子开关（enabledSkills）不在此处理。
 * reference 子开关已退役：ReadGroupBackground 随会话组包、ListSiblingSessions 随协作包，旧配置残留值静默忽略。
 */
export function resolveAbilities(config: WorkspaceConfig, opts: ResolveAbilitiesOpts): Set<string> {
  const result = new Set<string>();
  for (const pack of ABILITY_PACKS) {
    const enabled = config.abilityOverrides?.[pack.key] ?? pack.defaultEnabled;
    if (!enabled) continue;

    if (pack.key === 'memory') {
      if (opts.role === 'main' && !opts.hasWorkspace) continue;
      if (opts.role === 'sub' && opts.profile?.enabledAbilities.memory !== true) continue;
    }
    if (pack.key === 'notes' && (opts.role !== 'main' || !opts.hasWorkspace)) continue;
    if (pack.key === 'workspace-git' && !opts.hasWorkspace) continue;
    if ((pack.key === 'group-context' || pack.key === 'agent-collab') && !opts.groupId) continue;
    // executor 由拼装侧显式排除（同 notes-discipline 模式）：无人值守无分流场景
    if (pack.key === 'shunt' && (!opts.hasWorkspace || !opts.groupId)) continue;
    if (pack.mainOnly && opts.role !== 'main') continue;

    if (opts.role === 'sub' && opts.profile) {
      const ab = opts.profile.enabledAbilities;
      if (pack.key === 'stock' && ab.stock !== true) continue;
      if (pack.key === 'article' && ab.article !== true) continue;
      if (pack.key === 'browser' && ab.browser !== true) continue;
      if (pack.key === 'web-mcp' && ab.web !== true) continue;
    }

    result.add(pack.key);
  }
  return result;
}

/** 工具组标识 → 所属 skill 型能力包 key，供拼装侧与挂载反查共用；键含可选包 name 与并入包内的 server 名（dogear-extension）。 */
export const TOOL_PACK_TO_ABILITY = new Map<string, string>(
  ABILITY_PACKS
    .filter((p) => p.type === 'skill-packs')
    .flatMap((p) => (p.toolGroups ?? []).map((g) => [g, p.key] as const)),
);
