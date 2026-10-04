// 场景维度能力数据：挂载矩阵（按包看场景）与场景总览（按场景看包）的共同底座
import {
  ABILITY_CATEGORIES,
  ABILITY_PACKS,
  resolveAbilities,
  scenePackEnabled,
  type AbilityCategoryMeta,
  type AbilityPack,
} from '../agents/ability-registry.js';
import { listSkillTemplates, type SkillTemplateMeta } from '../services/skill-template-service.js';
import {
  createDefaultSubAgentProfile,
  type AppSettings,
  type SubAgentProfile,
} from '../services/settings-types.js';
import { getWorkspaceConfig, type WorkspaceConfig } from '../services/workspace-config-service.js';
import { getAll as getAllWorkspaces } from '../services/workspace-json-service.js';
import { PERSONAL_WORKSPACE_ID } from '../types.js';
import { buildExecutionPrompt, EXECUTION_PROMPT_PREVIEW } from '../services/task-execution-prompt.js';

export type AbilityMountSceneKind = 'main' | 'personal' | 'sub-default' | 'profile' | 'executor' | 'scheduler';

export interface AbilityMountSceneRow {
  kind: AbilityMountSceneKind;
  /** 场景稳定标识：main / sub-default / executor / custom-agent / state-extract / parse-article / Profile id */
  id: string;
  label: string;
  /** 系统预设固定行：加载行为由代码定死，用户无 Profile 子开关可改 */
  system: boolean;
  /** 该场景此能力是否加载（触发条件按已满足计，具体条件见 reason） */
  loaded: boolean;
  reason: string;
  /** 仅 profile 行：Profile 已停用不可派遣，loaded 仅供说明 */
  profileDisabled?: boolean;
}

/** 系统行为详情页的矩阵 key：基础工具 + 常驻工具组的场景加载情况 */
export const SYSTEM_MOUNTS_PACK_KEY = '__system__';

/** 矩阵按「触发条件已满足」计算，属组类条件用占位组 ID 放行，条件本身文字化进 reason */
const MOUNT_GROUP_PLACEHOLDER = 'mount-matrix-group';

const PROFILE_FILTER_LABELS: Record<string, string> = {
  stock: '股票分析',
  article: '文章',
  browser: '内嵌浏览器',
  'browser-extension': '浏览器扩展',
  'browser-methodology': '浏览器方法论',
  'code-workflow': '代码工作流 Skill',
};

/** Profile 布尔字段过滤的包 key → enabledAbilities 字段名（browser-extension 沿用 extension 字段） */
const PROFILE_FILTER_FIELDS: Record<string, 'stock' | 'article' | 'browser' | 'extension'> = {
  stock: 'stock',
  article: 'article',
  browser: 'browser',
  'browser-extension': 'extension',
};

/** skill 细选过滤的包：Profile 勾选决定，方法论包与通道解耦后同 code-workflow 模式 */
const SKILL_FILTER_PACK_KEYS: ReadonlySet<string> = new Set(['code-workflow', 'browser-methodology']);

const STATE_EXTRACT_REASON = '后台任务不走能力包：固定提示词 + 单工具';
const PARSE_ARTICLE_REASON = '后台任务不走能力包，提示词单独写死';

export function packEnabledOf(pack: AbilityPack, config: WorkspaceConfig): boolean {
  return config.abilityOverrides?.[pack.key] ?? pack.defaultEnabled;
}

/** 包开关开启时该格的场景说明；触发条件文字化，是否满足由 resolveAbilities 判定 */
function sceneReason(pack: AbilityPack, kind: AbilityMountSceneKind, hasWorkspace: boolean): string {
  if (kind === 'main' || kind === 'executor') {
    if (kind === 'executor' && pack.key === 'notes') {
      return '笔记工具组随包注册（申报任务结果要用），存卡纪律段不注入';
    }
    if (kind === 'executor' && pack.key === 'group-context') {
      return '会话属于组时只注入组头，不注入话题状态';
    }
    if (pack.key === 'memory' || pack.key === 'notes') {
      return hasWorkspace
        ? `绑定工作区后生效${pack.key === 'notes' ? '（含任务申报工具）' : ''}`
        : '没绑定工作区，用不了';
    }
    if (pack.key === 'workspace-git') {
      return hasWorkspace ? '绑定工作区后生效' : '没绑定工作区，用不了';
    }
    switch (pack.key) {
      case 'workspace-rules':
      case 'global-rules':
        return '包开着就注入';
      case 'group-context':
        return '会话属于组时注入组上下文';
      case 'agent-collab':
        return '会话属于组时注册协作工具、注入协作规范';
      case 'shunt':
        return '会话属于组时注入分流段并注册分流工具';
      case 'web-mcp':
        return '包开着就挂载联网搜索工具，GLM API Key 在设置页配置';
      default:
        return '包开着就装载，包内 skill 与工具包受子开关控制';
    }
  }
  switch (pack.key) {
    case 'workspace-rules':
    case 'global-rules':
      return '包开着就注入子会话';
    case 'memory':
      return '绑定工作区后生效';
    case 'notes':
      return '子会话不用笔记，产物走交付契约';
    case 'workspace-git':
      return '绑定工作区后生效';
    case 'shunt':
      return '分流只对主会话的回复有意义';
    case 'group-context':
      return '会话属于组时生效';
    case 'agent-collab':
      return '交付契约段恒注入；协作工具属组时注册，开关只管 sibling 工具组';
    case 'web-mcp':
      return '子会话不挂载联网搜索工具';
    default:
      return '包开着就装载，包内 skill 与工具包受子开关控制';
  }
}

/** personal 场景固定行的加载说明：loaded 由 personal 自己的 config 解析（无工作区路径、无组），如实反映临时会话装配 */
function personalSceneReason(pack: AbilityPack): string {
  switch (pack.key) {
    case 'workspace-rules':
      return '读 personal 的 agent.md，文件是空的就等于没注入';
    case 'global-rules':
      return '包开着就注入临时会话';
    case 'memory':
    case 'notes':
    case 'workspace-git':
      return '临时会话没有工作区，用不了';
    case 'group-context':
    case 'agent-collab':
    case 'shunt':
      return '临时会话没有工作区也没有组，用不了';
    default:
      return '包开着就生效，包内 skill 与工具包受临时会话自己的子开关控制';
  }
}

/** 有 Profile 过滤维度的包：按该 Profile 勾选状态生成原因；无过滤维度返回 null */
function profileFilterReason(pack: AbilityPack, profile: SubAgentProfile): string | null {
  const label = PROFILE_FILTER_LABELS[pack.key];
  if (!label) return null;
  const ab = profile.enabledAbilities;
  if (SKILL_FILTER_PACK_KEYS.has(pack.key)) {
    const matched = (pack.skills ?? []).filter((s) => ab.skills?.includes(s));
    return matched.length > 0 ? `Profile 勾了 ${matched.length} 个 skill` : 'Profile 没勾包内 skill';
  }
  const field = PROFILE_FILTER_FIELDS[pack.key];
  if (!field) return null;
  const on = ab[field] === true;
  return on ? `Profile 勾了${label}` : `Profile 没勾${label}`;
}

/** 定时自定义任务行的 loaded/reason：memory/notes 按 sceneOverrides.scheduler 三级回退（无键=装载），其余不随定时任务场景裁决 */
function schedulerCustomAgentCell(
  pack: AbilityPack,
  config: WorkspaceConfig,
): { loaded: boolean; reason: string } {
  switch (pack.key) {
    case 'memory': {
      const on = scenePackEnabled(pack, config, 'scheduler');
      return on
        ? { loaded: true, reason: '记忆工具随开关装载，默认开' }
        : { loaded: false, reason: '开关已关，不装记忆工具' };
    }
    case 'notes': {
      const on = scenePackEnabled(pack, config, 'scheduler');
      return on
        ? { loaded: true, reason: '笔记工具组随开关装载（产物落卡片）；任务系统工具不装，那是主会话专属' }
        : { loaded: false, reason: '开关已关，不装笔记工具组' };
    }
    case 'workspace-rules':
    case 'global-rules':
      return { loaded: false, reason: '后台任务不读规则段' };
    case 'group-context':
      return { loaded: false, reason: '后台任务没有会话组' };
    case 'agent-collab':
      return { loaded: false, reason: '后台任务没有派遣交付通道' };
    case 'code-workflow':
    case 'browser-methodology':
      return { loaded: false, reason: 'skill 挂载在定时任务编辑页按任务配置' };
    case 'browser-extension':
      return { loaded: false, reason: '定时任务不挂扩展通道工具' };
    default:
      return pack.type === 'skill-packs'
        ? { loaded: false, reason: '工具包与 skill 在定时任务编辑页按任务配置' }
        : { loaded: false, reason: '后台任务用不上这个能力包' };
  }
}

export function buildMountRows(
  pack: AbilityPack,
  config: WorkspaceConfig,
  settings: AppSettings,
  hasWorkspace: boolean,
  personalConfig: WorkspaceConfig,
): AbilityMountSceneRow[] {
  const enabled = packEnabledOf(pack, config);
  const profiles = settings.subAgent?.profiles ?? [];
  const defaultProfile = profiles.find((p) => p.id === 'default') ?? createDefaultSubAgentProfile();
  const rows: AbilityMountSceneRow[] = [];

  const mainActive = resolveAbilities(config, { role: 'main', hasWorkspace, groupId: MOUNT_GROUP_PLACEHOLDER });
  rows.push({
    kind: 'main',
    id: 'main',
    label: '主会话',
    system: true,
    loaded: mainActive.has(pack.key),
    reason: enabled ? sceneReason(pack, 'main', hasWorkspace) : '开关已关，不装载',
  });

  const personalActive = resolveAbilities(personalConfig, { role: 'main', hasWorkspace: false, groupId: null });
  const personalEnabled = packEnabledOf(pack, personalConfig);
  rows.push({
    kind: 'personal',
    id: 'personal',
    label: '临时会话',
    system: true,
    loaded: personalActive.has(pack.key),
    reason: personalEnabled ? personalSceneReason(pack) : '临时会话默认只开联网搜索',
  });

  const subScenes: Array<{ kind: AbilityMountSceneKind; profile: SubAgentProfile; system: boolean }> = [
    { kind: 'sub-default', profile: defaultProfile, system: true },
    ...profiles
      .filter((p) => p.id !== 'default')
      .map((p) => ({ kind: 'profile' as const, profile: p, system: false })),
  ];
  for (const scene of subScenes) {
    const active = resolveAbilities(config, {
      role: 'sub',
      hasWorkspace: true,
      groupId: MOUNT_GROUP_PLACEHOLDER,
      profile: scene.profile,
    });
    const loaded = active.has(pack.key);
    const filterReason = profileFilterReason(pack, scene.profile);
    rows.push({
      kind: scene.kind,
      id: scene.kind === 'sub-default' ? 'sub-default' : scene.profile.id,
      label: scene.kind === 'sub-default' ? '子会话·默认' : scene.profile.name,
      system: scene.system,
      loaded,
      reason: enabled ? (filterReason ?? sceneReason(pack, scene.kind, hasWorkspace)) : '开关已关，不装载',
      profileDisabled: scene.profile.enabled === false || undefined,
    });
  }

  rows.push({
    kind: 'executor',
    id: 'executor',
    label: '任务执行会话',
    system: true,
    loaded: mainActive.has(pack.key),
    reason: enabled ? sceneReason(pack, 'executor', hasWorkspace) : '开关已关，不装载',
  });

  const customAgentCell = schedulerCustomAgentCell(pack, config);
  rows.push({
    kind: 'scheduler',
    id: 'custom-agent',
    label: '定时自定义任务',
    system: true,
    loaded: customAgentCell.loaded,
    reason: customAgentCell.reason,
  });
  rows.push({
    kind: 'scheduler',
    id: 'state-extract',
    label: '话题状态抽取',
    system: true,
    loaded: false,
    reason: STATE_EXTRACT_REASON,
  });
  rows.push({
    kind: 'scheduler',
    id: 'parse-article',
    label: '文章解析',
    system: true,
    loaded: false,
    reason: PARSE_ARTICLE_REASON,
  });

  return rows;
}

export function buildSystemMountRows(settings: AppSettings, hasWorkspace: boolean): AbilityMountSceneRow[] {
  const profiles = settings.subAgent?.profiles ?? [];
  const baseReason = hasWorkspace ? '常驻基础设施，绑定工作区即注册' : '工作区没绑路径，注册不了';
  return [
    { kind: 'main', id: 'main', label: '主会话', system: true, loaded: hasWorkspace, reason: baseReason },
    {
      kind: 'personal',
      id: 'personal',
      label: '临时会话',
      system: true,
      loaded: true,
      reason: '基础工具恒注册，文件边界只有应用数据目录',
    },
    {
      kind: 'sub-default',
      id: 'sub-default',
      label: '子会话·默认',
      system: true,
      loaded: hasWorkspace,
      reason: hasWorkspace ? '常驻基础设施，不受 Profile 过滤' : baseReason,
    },
    ...profiles
      .filter((p) => p.id !== 'default')
      .map((p) => ({
        kind: 'profile' as const,
        id: p.id,
        label: p.name,
        system: false,
        loaded: hasWorkspace,
        reason: '常驻基础设施，不受 Profile 过滤',
        profileDisabled: p.enabled === false || undefined,
      })),
    {
      kind: 'executor',
      id: 'executor',
      label: '任务执行会话',
      system: true,
      loaded: hasWorkspace,
      reason: '常驻基础设施，执行会话同样注册',
    },
  ];
}

// ---- 场景总览（按场景看包的转置矩阵，两层模型三态格子） ----

export type SceneOverviewId =
  | 'main'
  | 'personal'
  | 'sub'
  | 'executor'
  | 'scheduler-custom'
  | 'scheduler-state'
  | 'scheduler-parse';

export interface SceneSubToggleSkill {
  name: string;
  title?: string;
  enabled: boolean;
}

/** 格子三态：switchable=预设值+开关可改；forced=强制装载无开关；excluded=条件排除灰显（开关无裁决意义） */
export type SceneCellState = 'switchable' | 'forced' | 'excluded';

/** 只有 code-workflow 保留 skill 细则（6 skill 细选），其余包单开关整包装载 */
function hasSubToggles(pack: AbilityPack): boolean {
  return pack.key === 'code-workflow' && pack.type === 'skill-packs';
}

export interface ScenePackSubToggles {
  /** 只有 code-workflow 会有（全应用唯一的 skill 细则） */
  skills: SceneSubToggleSkill[];
}

export interface ScenePackCell {
  key: string;
  label: string;
  category: AbilityCategoryMeta['key'];
  state: SceneCellState;
  /** 该场景真源里的开关现值：工作区走场景三级回退，personal 走自己的 config，定时按 sceneOverrides.scheduler */
  enabled: boolean;
  /** 最终装配结果（resolveAbilities 场景化解析 / 定时按 buildCustomToolSet 语义） */
  loaded: boolean;
  reason: string;

  /** 仅 main/personal 行的展开层（子开关真源仍在工作区/personal 的 enabledSkills/enabledToolPacks） */
  subToggles?: ScenePackSubToggles;
}

/** 行内提示词展示项：summary 行全文经对应 tipc 路由按需拉取；带 content 的直接随行返回（纯内存模板零 IO） */
export interface SceneSummaryPrompt {
  id: string;
  label: string;
  note: string;
  content?: string;
}

export interface SceneOverviewRow {
  id: SceneOverviewId;
  label: string;
  /** matrix=包矩阵行；summary=纯文字+提示词展示行（packs 恒空） */
  kind: 'matrix' | 'summary';
  /** 整页说明 */
  description: string;
  packs: ScenePackCell[];
  /** 行内提示词展示项（summary 行必有；executor 行带执行提示词模板全文） */
  prompts?: SceneSummaryPrompt[];
  /** 仅 executor 行：扩展层按任务类型装配的说明文字 */
  extensionNote?: string;
  /** 分组级说明（category key → 文字）：撤掉包格子的分组在这里给一句指引 */
  groupNotes?: Partial<Record<AbilityCategoryMeta['key'], string>>;
}

export interface SceneOverviewResult {
  rows: SceneOverviewRow[];
  categories: readonly AbilityCategoryMeta[];
}

interface SceneCellCtx {
  config: WorkspaceConfig;
  personalConfig: WorkspaceConfig;
  hasWorkspace: boolean;
  mainActive: Set<string>;
  personalActive: Set<string>;
  subActive: Set<string>;
  executorActive: Set<string>;
  wsSkills: Set<string>;
  personalSkills: Set<string>;
  templateByName: Map<string, SkillTemplateMeta>;
}

function skillToggleList(
  pack: AbilityPack,
  enabledSkills: Set<string>,
  ctx: SceneCellCtx,
): SceneSubToggleSkill[] {
  return (pack.skills ?? []).map((name) => ({
    name,
    title: ctx.templateByName.get(name)?.title,
    enabled: enabledSkills.has(name),
  }));
}

/** personal 场景结构性排除的固定层包（无工作区路径/无组 → 代码条件恒排除），场景行不输出格子（说明并入行 description） */
const PERSONAL_EXCLUDED_KEYS: ReadonlySet<string> = new Set([
  'memory',
  'notes',
  'workspace-git',
  'group-context',
  'agent-collab',
  'shunt',
]);

/** 定时自定义任务行首的合成格子：基础文件+搜索工具不在 13 包体系，用合成 key 表达强制恒装 */
const SCHEDULER_BASE_CELL_KEY = '__scheduler-base__';

function mainCell(pack: AbilityPack, ctx: SceneCellCtx): ScenePackCell {
  const enabled = packEnabledOf(pack, ctx.config);
  return {
    key: pack.key,
    label: pack.label,
    category: pack.category,
    state: 'switchable',
    enabled,
    loaded: ctx.mainActive.has(pack.key),
    reason: enabled ? sceneReason(pack, 'main', ctx.hasWorkspace) : '开关已关，不装载',
    subToggles: hasSubToggles(pack)
      ? { skills: skillToggleList(pack, ctx.wsSkills, ctx) }
      : undefined,
  };
}

function personalCell(pack: AbilityPack, ctx: SceneCellCtx): ScenePackCell | null {
  if (pack.key === 'workspace-rules' || PERSONAL_EXCLUDED_KEYS.has(pack.key)) return null;
  const enabled = packEnabledOf(pack, ctx.personalConfig);
  return {
    key: pack.key,
    label: pack.label,
    category: pack.category,
    state: 'switchable',
    enabled,
    loaded: ctx.personalActive.has(pack.key),
    reason: enabled ? personalSceneReason(pack) : '临时会话默认只开联网搜索',
    subToggles: hasSubToggles(pack)
      ? { skills: skillToggleList(pack, ctx.personalSkills, ctx) }
      : undefined,
  };
}

function subCell(pack: AbilityPack, ctx: SceneCellCtx): ScenePackCell | null {
  if (pack.category === 'extension') return null;
  const enabled = scenePackEnabled(pack, ctx.config, 'sub');
  const reason = sceneReason(pack, 'sub-default', ctx.hasWorkspace);
  const head = { key: pack.key, label: pack.label, category: pack.category, loaded: ctx.subActive.has(pack.key) };
  const conditionExcluded =
    pack.key === 'notes' ||
    pack.key === 'shunt' ||
    (pack.key === 'workspace-git' && !ctx.hasWorkspace);
  if (conditionExcluded) {
    return { ...head, state: 'excluded', enabled: false, reason };
  }
  return {
    ...head,
    state: 'switchable',
    enabled,
    reason: enabled ? reason : '场景覆盖或工作区包开关已关闭',
  };
}

function executorCell(pack: AbilityPack, ctx: SceneCellCtx): ScenePackCell {
  const enabled = scenePackEnabled(pack, ctx.config, 'executor');
  const loaded = ctx.executorActive.has(pack.key);
  const reason = enabled ? sceneReason(pack, 'executor', ctx.hasWorkspace) : '场景覆盖或工作区里这个包是关的';
  const head = { key: pack.key, label: pack.label, category: pack.category, loaded };
  if (pack.key === 'shunt') {
    return {
      ...head,
      state: 'excluded',
      enabled: false,
      loaded: false,
      reason: '无人值守没有分流场景，分流只给主会话',
    };
  }
  const conditionExcluded =
    !ctx.hasWorkspace && (pack.key === 'memory' || pack.key === 'notes' || pack.key === 'workspace-git');
  if (conditionExcluded) {
    return { ...head, state: 'excluded', enabled: false, reason: '没绑定工作区，用不了' };
  }
  return {
    ...head,
    state: 'switchable',
    enabled,
    reason,
  };
}

function schedulerBaseCell(): ScenePackCell {
  return {
    key: SCHEDULER_BASE_CELL_KEY,
    label: '基础工具（文件 + 搜索）',
    category: 'system',
    state: 'forced',
    enabled: true,
    loaded: true,
    reason: '文件与搜索工具恒装，定时任务干活的基础',
  };
}

function schedulerCustomCell(pack: AbilityPack, ctx: SceneCellCtx): ScenePackCell | null {
  if (pack.category === 'extension') return null;
  const cell = schedulerCustomAgentCell(pack, ctx.config);
  const head = { key: pack.key, label: pack.label, category: pack.category, loaded: cell.loaded };
  if (pack.key === 'memory' || pack.key === 'notes') {
    return {
      ...head,
      state: 'switchable',
      enabled: scenePackEnabled(pack, ctx.config, 'scheduler'),
      reason: cell.reason,
    };
  }
  return { ...head, state: 'excluded', enabled: false, reason: cell.reason };
}

function fixedSceneCell(pack: AbilityPack, loaded: boolean, reason: string): ScenePackCell {
  return {
    key: pack.key,
    label: pack.label,
    category: pack.category,
    state: 'excluded',
    enabled: false,
    loaded,
    reason,
  };
}

const EXECUTOR_PROMPTS: SceneSummaryPrompt[] = [
  {
    id: 'executor-template',
    label: '执行提示词模板',
    note: '任务入队时按此模板拼接（标题/ID/计划路径填任务实值）；代码实施任务会多一行 skill 挂载提示',
    content: buildExecutionPrompt(EXECUTION_PROMPT_PREVIEW),
  },
];

/**
 * 场景总览：七个场景行（五矩阵行 + 两 summary 行），两层模型三态格子一次遍历产出。
 * matrix 行的开关写回真源：main=abilityOverrides+子开关字段；personal=personal 配置；
 * sub/executor/scheduler-custom=sceneOverrides 对应键（恢复默认=删整键回跟随工作区）。
 */
export async function buildSceneOverview(
  workspaceId: string,
): Promise<SceneOverviewResult | { error: string }> {
  const workspaces = await getAllWorkspaces();
  const workspace = workspaces.find((w) => w.id === workspaceId);
  if (!workspace) return { error: `工作区不存在: ${workspaceId}` };
  const [config, personalConfig, skillTemplates] = await Promise.all([
    getWorkspaceConfig(workspaceId),
    getWorkspaceConfig(PERSONAL_WORKSPACE_ID),
    listSkillTemplates(),
  ]);
  const hasWorkspace = !!workspace.path;

  const ctx: SceneCellCtx = {
    config,
    personalConfig,
    hasWorkspace,
    mainActive: resolveAbilities(config, { role: 'main', hasWorkspace, groupId: MOUNT_GROUP_PLACEHOLDER }),
    personalActive: resolveAbilities(personalConfig, { role: 'main', hasWorkspace: false, groupId: null }),
    subActive: resolveAbilities(config, {
      role: 'sub',
      hasWorkspace,
      groupId: MOUNT_GROUP_PLACEHOLDER,
      profile: null,
      sceneOverride: 'sub',
    }),
    executorActive: resolveAbilities(config, {
      role: 'main',
      hasWorkspace,
      groupId: MOUNT_GROUP_PLACEHOLDER,
      sceneOverride: 'executor',
    }),
    wsSkills: new Set(config.enabledSkills),
    personalSkills: new Set(personalConfig.enabledSkills),
    templateByName: new Map(skillTemplates.map((s) => [s.name, s])),
  };

  const rows: SceneOverviewRow[] = [
    {
      id: 'main',
      label: '主会话',
      kind: 'matrix',
      description: '控制新开的主会话加载哪些能力。改完对新会话生效，已开的会话不变。',
      packs: [],
    },
    {
      id: 'personal',
      label: '临时会话',
      kind: 'matrix',
      description: '临时会话不带工作区，记忆、笔记、Git、组协作这些能力自动不可用。这里只管全局规则和扩展能力。',
      packs: [],
    },
    {
      id: 'sub',
      label: '子会话',
      kind: 'matrix',
      description: '固定层一般不用动，预设跟工作区走。扩展能力在派遣页按 Profile 勾选。',
      packs: [],
      groupNotes: { extension: '扩展能力（股票/文章/浏览器/联网/代码 skill）在派遣页按 Profile 勾选' },
    },
    {
      id: 'executor',
      label: '任务执行会话',
      kind: 'matrix',
      description: '固定层预设跟工作区走。扩展层 skill 与工作区/场景配置解耦：default 任务按基础版执行（不挂 skill），代码实施任务自动挂分步实施 skill。',
      packs: [],
      prompts: EXECUTOR_PROMPTS,
      extensionNote: 'skill 按任务类型查表：default 基础版零 skill，代码实施自动挂分步实施 skill（staged-execution），与工作区/场景 skill 配置解耦',
    },
    {
      id: 'scheduler-custom',
      label: '定时自定义任务',
      kind: 'matrix',
      description: '记忆和笔记可开关，基础工具恒装。扩展能力在定时任务编辑页按任务配置。',
      packs: [],
      groupNotes: { extension: '扩展工具包与 skill 在定时任务编辑页按任务配置' },
    },
    {
      id: 'scheduler-state',
      label: '话题状态抽取',
      kind: 'summary',
      description: '后台任务：读完话题新增内容，把要点写进话题状态卡。',
      packs: [],
      prompts: [{
        id: 'state-extract',
        label: '状态抽取提示词',
        note: '固定角色语 + 可编辑模板（<configDir>/state-extract-prompt.md）',
      }],
    },
    {
      id: 'scheduler-parse',
      label: '文章解析',
      kind: 'summary',
      description: '后台任务：文章导入失败时用 AI 补写解析产物。',
      packs: [],
      prompts: [{
        id: 'parse-article',
        label: '文章解析 SKILL.md',
        note: 'systemPrompt 与原始全文都来自 article-parser/SKILL.md',
      }],
    },
  ];
  const rowById = new Map(rows.map((r) => [r.id, r]));

  for (const pack of ABILITY_PACKS) {
    rowById.get('main')!.packs.push(mainCell(pack, ctx));
    const personal = personalCell(pack, ctx);
    if (personal) rowById.get('personal')!.packs.push(personal);
    const sub = subCell(pack, ctx);
    if (sub) rowById.get('sub')!.packs.push(sub);
    rowById.get('executor')!.packs.push(executorCell(pack, ctx));
    const scheduler = schedulerCustomCell(pack, ctx);
    if (scheduler) rowById.get('scheduler-custom')!.packs.push(scheduler);
  }
  rowById.get('scheduler-custom')!.packs.unshift(schedulerBaseCell());

  return { rows, categories: ABILITY_CATEGORIES };
}
