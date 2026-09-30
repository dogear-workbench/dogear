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

export type AbilityCategory = 'system' | 'context-memory' | 'extension';

export interface AbilityCategoryMeta {
  key: AbilityCategory;
  label: string;
  description: string;
}

/** 能力页/场景页共用的三大类分组头（有序），分组是展示维度不是配置单元，无开关 */
export const ABILITY_CATEGORIES: readonly AbilityCategoryMeta[] = [
  { key: 'system', label: '系统功能', description: '核心会话流程的基础能力，建议保持开启' },
  { key: 'context-memory', label: '上下文与记忆', description: '跨会话的上下文承载与记忆沉淀能力' },
  { key: 'extension', label: '扩展能力', description: '按需选装的领域扩展，默认关闭' },
];

export interface AbilityPack {
  key: string;
  label: string;
  description: string;
  category: AbilityCategory;
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
  /** 子会话 Profile 子开关独裁（唯一裁决者），工作区包开关退化为纯主会话开关；子开关字段名见 SUB_AUTONOMOUS_SWITCH */
  subAutonomous?: boolean;
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

/** 自治包 key → Profile enabledAbilities 子开关字段（subAutonomous 包的裁决入口） */
const SUB_AUTONOMOUS_SWITCH: Record<string, 'stock' | 'article' | 'browser' | 'web'> = {
  stock: 'stock',
  article: 'article',
  browser: 'browser',
  'web-mcp': 'web',
};

export const ABILITY_PACKS: AbilityPack[] = [
  {
    key: 'workspace-rules',
    label: '工作区规则',
    description: '读取工作区 agent.md 注入每个会话，承载项目级约定与偏好',
    category: 'system',
    type: 'prompt-only',
    defaultEnabled: true,
  },
  {
    key: 'global-rules',
    label: '全局规则',
    description: '读取用户级全局规则注入每个会话，跨工作区生效',
    category: 'system',
    type: 'prompt-only',
    defaultEnabled: true,
  },
  {
    key: 'memory',
    label: '记忆系统',
    description: '记忆工具（召回/保存）+ 记忆写入纪律段，绑定工作区时生效',
    category: 'context-memory',
    type: 'segment-tools',
    segmentKeys: ['memory-guidance'],
    toolGroups: ['dogear-memory'],
    defaultEnabled: true,
  },
  {
    key: 'notes',
    label: '笔记卡片',
    description: '笔记卡片 + 任务系统两组工具 + 存卡纪律段，主会话且绑定工作区时生效（任务执行会话派单保底不受开关约束）',
    category: 'system',
    type: 'segment-tools',
    segmentKeys: ['notes-discipline'],
    toolGroups: ['dogear-notes', 'dogear-tasks'],
    defaultEnabled: true,
  },
  {
    key: 'workspace-git',
    label: 'git 版本管理',
    description: '工作区双层 git 工具组（查历史/diff/blame、正式提交、回退、自动快照）+ git 历史意识段，绑定工作区时生效（主/子会话）',
    category: 'context-memory',
    type: 'segment-tools',
    segmentKeys: ['git-history-guidance'],
    toolGroups: ['dogear-git'],
    defaultEnabled: true,
  },
  {
    key: 'group-context',
    label: '会话组',
    description: '组上下文段（组头 + 话题状态）+ 组状态卡工具，会话属于某个组时生效',
    category: 'context-memory',
    type: 'segment-tools',
    segmentKeys: ['group-context'],
    toolGroups: ['dogear-group-context'],
    defaultEnabled: true,
  },
  {
    key: 'agent-collab',
    label: 'Agent 协作',
    description: '派遣子会话、会话组共享区、兄弟会话三组工具 + 主会话协作规范段 + 子会话交付契约段（子会话强制生效）',
    category: 'system',
    type: 'segment-tools',
    segmentKeys: ['main-agent-delegation', 'sub-agent-contract'],
    toolGroups: ['dogear-delegation', 'dogear-group', 'dogear-sibling'],
    defaultEnabled: true,
  },
  {
    key: 'shunt',
    label: '会话分流',
    description: '岔题分流：岔题时输出建议卡，用户确认后平级分出新会话/新话题或记为笔记（note 动作依赖笔记卡片包的建卡工具）',
    category: 'system',
    type: 'segment-tools',
    segmentKeys: ['shunt-guidance'],
    toolGroups: ['dogear-shunt'],
    mainOnly: true,
    defaultEnabled: true,
  },
  {
    key: 'stock',
    label: '股票分析',
    description: '股票分析与选股 skill + 行情/分析/公告/候选池四个工具包；子会话 Profile 独立生效，不受此开关约束',
    category: 'extension',
    type: 'skill-packs',
    skills: ['stock-analysis', 'stock-picking'],
    toolGroups: ['stock-quote', 'stock-analysis', 'stock-announcement', 'stock-picking'],
    subAutonomous: true,
    defaultEnabled: false,
  },
  {
    key: 'article',
    label: '文章解析',
    description: '文章解析 skill + 文章管理工具包（读取/列举工作区文章）；子会话 Profile 独立生效，不受此开关约束',
    category: 'extension',
    type: 'skill-packs',
    skills: ['article-parser'],
    toolGroups: ['article'],
    subAutonomous: true,
    defaultEnabled: false,
  },
  {
    key: 'browser',
    label: '浏览器',
    description: '浏览器调研方法论 skill + 双通道工具组：内嵌浏览器（读文章/搜索/原子探索）+ 浏览器扩展通道（用户真实浏览器标签页操作，风控后备）；子会话 Profile 独立生效，不受此开关约束',
    category: 'extension',
    type: 'skill-packs',
    skills: ['browser-exploration'],
    toolGroups: ['browser', 'dogear-extension'],
    subAutonomous: true,
    defaultEnabled: false,
  },
  {
    key: 'web-mcp',
    label: '联网搜索',
    description: 'GLM 联网搜索与网页读取工具包（web_search_prime / webReader），API 直出快档，与浏览器工具互补；需在设置页配置 GLM Coding Plan API Key；子会话 Profile 独立生效，不受此开关约束',
    category: 'extension',
    type: 'skill-packs',
    toolGroups: ['web-mcp'],
    subAutonomous: true,
    defaultEnabled: false,
  },
  {
    key: 'code-workflow',
    label: '代码工作流',
    description: '规划、实施、调试等开发流程 skill，无工具包',
    category: 'extension',
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

/** 自治包内 skill 全集：子会话装配时绕过工作区 enabledSkills/disabledPackSkills 两层闸，由 Profile 裁决 */
export const SUB_AUTONOMOUS_SKILLS: ReadonlySet<string> = new Set(
  ABILITY_PACKS.filter((p) => p.subAutonomous).flatMap((p) => p.skills ?? []),
);

/** 场景固定层覆盖键（WorkspaceConfig.sceneOverrides 的三个场景维度，与 ability-registry 解析共用） */
export const SCENE_KEYS = ['sub', 'executor', 'scheduler'] as const;
export type SceneOverrideKey = (typeof SCENE_KEYS)[number];

/** 场景包开关三级回退：场景覆盖 → 工作区总闸 → 注册表默认；残留下线 key 与缺省键自然回退 */
export function scenePackEnabled(pack: AbilityPack, config: WorkspaceConfig, scene: SceneOverrideKey): boolean {
  return config.sceneOverrides?.[scene]?.[pack.key] ?? config.abilityOverrides?.[pack.key] ?? pack.defaultEnabled;
}

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
  /** 场景固定层覆盖（sub/executor/scheduler）：传入时包开关改走 scenePackEnabled 三级回退；未传保持裸 abilityOverrides 读取（现状行为） */
  sceneOverride?: SceneOverrideKey;
}

/**
 * 解析生效能力包：包开关 ∩ 触发条件 ∩ 子会话 Profile 过滤。
 * 包开关取值：传 sceneOverride 时走三级回退（sceneOverrides[scene] → abilityOverrides → defaultEnabled），
 * 未传为 abilityOverrides ?? defaultEnabled；残留下线 key 静默忽略。场景代码条件（mainOnly/hasWorkspace/属组等）
 * 不受 sceneOverride 影响。
 * 子会话契约段与 Profile 子开关（enabledSkills）不在此处理；memory 对子会话归场景层裁决（不再查 Profile 闸）。
 * subAutonomous 包（browser/web-mcp/stock/article）例外：Profile 子开关是唯一裁决者，跳过包开关闸门；
 * profile 缺失则不生效（无授权即无能力）。
 * reference 子开关已退役：ReadGroupBackground 随会话组包、ListSiblingSessions 随协作包，旧配置残留值静默忽略。
 */
export function resolveAbilities(config: WorkspaceConfig, opts: ResolveAbilitiesOpts): Set<string> {
  const result = new Set<string>();
  for (const pack of ABILITY_PACKS) {
    if (opts.role === 'sub' && pack.subAutonomous) {
      const subSwitch = SUB_AUTONOMOUS_SWITCH[pack.key];
      if (!subSwitch || opts.profile?.enabledAbilities[subSwitch] !== true) continue;
      result.add(pack.key);
      continue;
    }

    const enabled = opts.sceneOverride
      ? scenePackEnabled(pack, config, opts.sceneOverride)
      : config.abilityOverrides?.[pack.key] ?? pack.defaultEnabled;
    if (!enabled) continue;

    if (pack.key === 'memory' && opts.role === 'main' && !opts.hasWorkspace) continue;
    if (pack.key === 'notes' && (opts.role !== 'main' || !opts.hasWorkspace)) continue;
    if (pack.key === 'workspace-git' && !opts.hasWorkspace) continue;
    if ((pack.key === 'group-context' || pack.key === 'agent-collab') && !opts.groupId) continue;
    // executor 由拼装侧显式排除（同 notes-discipline 模式）：无人值守无分流场景
    if (pack.key === 'shunt' && (!opts.hasWorkspace || !opts.groupId)) continue;
    if (pack.mainOnly && opts.role !== 'main') continue;

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
