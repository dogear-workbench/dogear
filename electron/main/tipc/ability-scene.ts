// 场景维度能力数据：挂载矩阵（按包看场景）与场景总览（按场景看包）的共同底座
import { existsSync } from 'fs';
import path from 'path';
import {
  ABILITY_CATEGORIES,
  ABILITY_PACKS,
  resolveAbilities,
  scenePackEnabled,
  type AbilityCategoryMeta,
  type AbilityPack,
} from '../agents/ability-registry.js';
import { listSkillTemplates, type SkillTemplateMeta } from '../services/skill-template-service.js';
import { listSkills, type SkillEntry } from '../services/skill-service.js';
import {
  createDefaultSubAgentProfile,
  type AppSettings,
  type SubAgentProfile,
} from '../services/settings-types.js';
import { getWorkspaceConfig, type WorkspaceConfig } from '../services/workspace-config-service.js';
import { getAll as getAllWorkspaces } from '../services/workspace-json-service.js';
import { buildExecutionPrompt, EXECUTION_PROMPT_PREVIEW } from '../services/task-execution-prompt.js';

export type AbilityMountSceneKind = 'main' | 'sub-default' | 'profile' | 'executor' | 'scheduler';

export interface AbilityMountSceneRow {
  kind: AbilityMountSceneKind;
  /** 场景稳定标识：main / sub-default / executor / custom-agent / parse-article / Profile id */
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
  'browser-extension': '浏览器扩展',
  'code-workflow': '代码工作流 Skill',
};

/** Profile 布尔字段过滤的包 key → enabledAbilities 字段名（browser-extension 沿用 extension 字段） */
const PROFILE_FILTER_FIELDS: Record<string, 'stock' | 'article' | 'extension'> = {
  stock: 'stock',
  article: 'article',
  'browser-extension': 'extension',
};

/** skill 细选维度的包：main 行细则展开层出子开关；custom skill 不在此列，走 custom-skill:{name} 动态行（用户可增删不写死） */
const SKILL_FILTER_PACK_KEYS: ReadonlySet<string> = new Set(['code-workflow']);

const PARSE_ARTICLE_REASON = '后台任务不走能力包，提示词单独写死';

export function packEnabledOf(pack: AbilityPack, config: WorkspaceConfig): boolean {
  return config.abilityOverrides?.[pack.key] ?? pack.defaultEnabled;
}

/** .git 目录或文件（worktree/submodule）均算；场景页构建时探测一次，与装配侧（pi-session）同判 */
export function detectUserGitRepo(workspacePath: string | null | undefined): boolean {
  return !!workspacePath && existsSync(path.join(workspacePath, '.git'));
}

/** 包开关开启时该格的场景说明；触发条件文字化，是否满足由 resolveAbilities 判定 */
function sceneReason(pack: AbilityPack, kind: AbilityMountSceneKind, hasWorkspace: boolean): string {
  if (kind === 'main' || kind === 'executor') {
    if (kind === 'executor' && pack.key === 'notes') {
      return '笔记工具组随包注册（申报任务结果要用），存卡纪律段不注入';
    }
    if (pack.key === 'memory' || pack.key === 'notes' || pack.key === 'workspace-snapshot') {
      return hasWorkspace
        ? `绑定工作区后生效${pack.key === 'notes' ? '（含任务申报工具）' : ''}`
        : '没绑定工作区，用不了';
    }
    if (pack.key === 'workspace-git') {
      return hasWorkspace ? '工作区有 git 仓库时生效' : '没绑定工作区，用不了';
    }
    switch (pack.key) {
      case 'workspace-rules':
      case 'global-rules':
        return '包开着就注入';
      case 'agent-collab':
        return '会话属于组时注册协作工具、注入协作规范';
      case 'shunt':
        return '会话属于组时注入分流段（出建议卡，执行由前端代码直连）';
      case 'web-mcp':
        return '包开着就挂载联网搜索工具，GLM API Key 在设置页配置';
      case 'skill-admin':
        return '挂载 skill 管理四工具；custom skill 注入按能力页勾选，与此开关无关';
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
      return '工作区有 git 仓库时生效';
    case 'workspace-snapshot':
      return '绑定工作区后生效';
    case 'shunt':
      return '分流只对主会话的回复有意义';
    case 'agent-collab':
      return '交付契约段恒注入；协作工具属组时注册，开关只管 sibling 工具组';
    case 'web-mcp':
      return '子会话不挂载联网搜索工具';
    case 'skill-admin':
      return '仅主会话';
    default:
      return '包开着就装载，包内 skill 与工具包受子开关控制';
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

/** 定时自定义任务行的 loaded/reason：loaded 按 schedulerActive（resolveAbilities sceneOverride:'scheduler'），reason 与场景页 schedulerCell 口径对齐 */
function schedulerCustomAgentCell(
  pack: AbilityPack,
  config: WorkspaceConfig,
  schedulerActive: Set<string>,
  hasWorkspace: boolean,
  hasUserGitRepo: boolean,
): { loaded: boolean; reason: string } {
  if (pack.key === 'shunt') return { loaded: false, reason: '无人值守没有分流场景，分流只给主会话' };
  if (pack.key === 'scheduler') return { loaded: false, reason: '无人值守没有管理场景，定时任务的管理在任务面板' };
  if (pack.category === 'extension') return { loaded: false, reason: '扩展工具包与 skill 在定时任务编辑页按任务配置' };
  if (!scenePackEnabled(pack, config, 'scheduler')) return { loaded: false, reason: '开关已关，不装载' };
  if (pack.key === 'workspace-git' && !hasUserGitRepo) {
    return { loaded: false, reason: hasWorkspace ? '工作区没有 git 仓库，不装载' : '没绑定工作区，用不了' };
  }
  if (!hasWorkspace && (pack.key === 'memory' || pack.key === 'notes' || pack.key === 'workspace-snapshot')) {
    return { loaded: false, reason: '没绑定工作区，用不了' };
  }
  return { loaded: schedulerActive.has(pack.key), reason: sceneReason(pack, 'main', hasWorkspace) };
}

export function buildMountRows(
  pack: AbilityPack,
  config: WorkspaceConfig,
  settings: AppSettings,
  hasWorkspace: boolean,
  hasUserGitRepo: boolean,
): AbilityMountSceneRow[] {
  const enabled = packEnabledOf(pack, config);
  const profiles = settings.subAgent?.profiles ?? [];
  const defaultProfile = profiles.find((p) => p.id === 'default') ?? createDefaultSubAgentProfile();
  const rows: AbilityMountSceneRow[] = [];

  const mainActive = resolveAbilities(config, {
    role: 'main',
    hasWorkspace,
    hasUserGitRepo,
    groupId: MOUNT_GROUP_PLACEHOLDER,
  });
  const schedulerActive = resolveAbilities(config, {
    role: 'main',
    hasWorkspace,
    hasUserGitRepo,
    groupId: MOUNT_GROUP_PLACEHOLDER,
    sceneOverride: 'scheduler',
  });
  rows.push({
    kind: 'main',
    id: 'main',
    label: '主会话',
    system: true,
    loaded: mainActive.has(pack.key),
    reason: enabled ? sceneReason(pack, 'main', hasWorkspace) : '开关已关，不装载',
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
      hasUserGitRepo: true,
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

  const customAgentCell = schedulerCustomAgentCell(pack, config, schedulerActive, hasWorkspace, hasUserGitRepo);
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
  | 'sub'
  | 'executor'
  | 'scheduler-custom'
  | 'scheduler-parse';

export interface SceneSubToggleSkill {
  name: string;
  title?: string;
  enabled: boolean;
}

/** 格子三态：switchable=预设值+开关可改；forced=强制装载无开关；excluded=条件排除灰显（开关无裁决意义） */
export type SceneCellState = 'switchable' | 'forced' | 'excluded';

/** SKILL_FILTER_PACK_KEYS 内的包出 skill 细则展开层：code-workflow 静态细选；custom skill 走独立动态行（custom-skill:{name}），其余包单开关整包装载 */
function hasSubToggles(pack: AbilityPack): boolean {
  return SKILL_FILTER_PACK_KEYS.has(pack.key);
}

export interface ScenePackSubToggles {
  /** SKILL_FILTER_PACK_KEYS 内的包会有 */
  skills: SceneSubToggleSkill[];
}

export interface ScenePackCell {
  key: string;
  label: string;
  category: AbilityCategoryMeta['key'];
  state: SceneCellState;
  /** 该场景真源里的开关现值：工作区走场景三级回退，定时按 sceneOverrides.scheduler */
  enabled: boolean;
  /** 最终装配结果（resolveAbilities 场景化解析 / 定时按 sceneOverrides.scheduler 三级回退语义） */
  loaded: boolean;
  /** 状态原因：仅 excluded/forced 输出（switchable 正常态不输出，名称自表达） */
  reason?: string;
  /** 按需挂载的工具组（registry deferredToolGroups 透传，行出「按需」徽章） */
  deferredToolGroups?: string[];
  /** 仅 custom skill 动态行（key 为 custom-skill:{name}）：有值时行开关写 enabledSkills 而非包开关 */
  skillName?: string;

  /** 仅 main 行的展开层（子开关真源在工作区的 enabledSkills/enabledToolPacks） */
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
  hasWorkspace: boolean;
  hasUserGitRepo: boolean;
  mainActive: Set<string>;
  subActive: Set<string>;
  executorActive: Set<string>;
  schedulerActive: Set<string>;
  wsSkills: Set<string>;
  templateByName: Map<string, SkillTemplateMeta>;
  /** custom 源动态条目（custom/skills 目录实时扫描，用户可增删）；custom-skill:{name} 动态行消费 */
  customSkills: SkillEntry[];
}

function skillToggleList(pack: AbilityPack, enabledSkills: Set<string>, ctx: SceneCellCtx): SceneSubToggleSkill[] {
  return (pack.skills ?? []).map((name) => ({
    name,
    title: ctx.templateByName.get(name)?.title,
    enabled: enabledSkills.has(name),
  }));
}

function mainCell(pack: AbilityPack, ctx: SceneCellCtx): ScenePackCell {
  return {
    key: pack.key,
    label: pack.label,
    category: pack.category,
    state: 'switchable',
    enabled: packEnabledOf(pack, ctx.config),
    loaded: ctx.mainActive.has(pack.key),
    deferredToolGroups: pack.deferredToolGroups,
    subToggles: hasSubToggles(pack)
      ? { skills: skillToggleList(pack, ctx.wsSkills, ctx) }
      : undefined,
  };
}

function subCell(pack: AbilityPack, ctx: SceneCellCtx): ScenePackCell | null {
  if (pack.category === 'extension') return null;
  const enabled = scenePackEnabled(pack, ctx.config, 'sub');
  const head = { key: pack.key, label: pack.label, category: pack.category, loaded: ctx.subActive.has(pack.key), deferredToolGroups: pack.deferredToolGroups };
  const conditionExcluded =
    pack.key === 'notes' ||
    pack.key === 'shunt' ||
    pack.key === 'skill-admin' ||
    (pack.key === 'workspace-snapshot' && !ctx.hasWorkspace) ||
    (pack.key === 'workspace-git' && (!ctx.hasWorkspace || !ctx.hasUserGitRepo));
  if (conditionExcluded) {
    return { ...head, state: 'excluded', enabled: false, reason: sceneReason(pack, 'sub-default', ctx.hasWorkspace) };
  }
  return {
    ...head,
    state: 'switchable',
    enabled,
  };
}

function executorCell(pack: AbilityPack, ctx: SceneCellCtx): ScenePackCell {
  const head = { key: pack.key, label: pack.label, category: pack.category, loaded: ctx.executorActive.has(pack.key), deferredToolGroups: pack.deferredToolGroups };
  if (pack.key === 'shunt') {
    return {
      ...head,
      state: 'excluded',
      enabled: false,
      loaded: false,
      reason: '无人值守没有分流场景，分流只给主会话',
    };
  }
  if (pack.key === 'workspace-git' && (!ctx.hasWorkspace || !ctx.hasUserGitRepo)) {
    return {
      ...head,
      state: 'excluded',
      enabled: false,
      reason: ctx.hasWorkspace ? '工作区没有 git 仓库，不装载' : '没绑定工作区，用不了',
    };
  }
  if (!ctx.hasWorkspace && (pack.key === 'memory' || pack.key === 'notes' || pack.key === 'workspace-snapshot')) {
    return { ...head, state: 'excluded', enabled: false, reason: '没绑定工作区，用不了' };
  }
  return {
    ...head,
    state: 'switchable',
    enabled: scenePackEnabled(pack, ctx.config, 'executor'),
  };
}

/** 定时自定义任务行首的合成格子：文件+搜索等基础工具不在 13 包体系，用合成 key 表达强制恒装 */
const SCHEDULER_BASE_CELL_KEY = '__scheduler-base__';

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

function schedulerCell(pack: AbilityPack, ctx: SceneCellCtx): ScenePackCell | null {
  if (pack.category === 'extension') return null;
  const head = { key: pack.key, label: pack.label, category: pack.category, loaded: ctx.schedulerActive.has(pack.key), deferredToolGroups: pack.deferredToolGroups };
  if (pack.key === 'shunt' || pack.key === 'scheduler') {
    return {
      ...head,
      state: 'excluded',
      enabled: false,
      loaded: false,
      reason: pack.key === 'shunt' ? '无人值守没有分流场景，分流只给主会话' : '无人值守没有管理场景，定时任务的管理在任务面板',
    };
  }
  if (pack.key === 'workspace-git' && (!ctx.hasWorkspace || !ctx.hasUserGitRepo)) {
    return {
      ...head,
      state: 'excluded',
      enabled: false,
      reason: ctx.hasWorkspace ? '工作区没有 git 仓库，不装载' : '没绑定工作区，用不了',
    };
  }
  if (!ctx.hasWorkspace && (pack.key === 'memory' || pack.key === 'notes' || pack.key === 'workspace-snapshot')) {
    return { ...head, state: 'excluded', enabled: false, reason: '没绑定工作区，用不了' };
  }
  return {
    ...head,
    state: 'switchable',
    enabled: scenePackEnabled(pack, ctx.config, 'scheduler'),
  };
}

/** custom skill 动态格子：开关语义 = enabledSkills 勾选（无包映射，纯增删无联动），仅 main 行输出 */
function customSkillCell(name: string, enabled: boolean): ScenePackCell {
  return {
    key: `custom-skill:${name}`,
    label: name,
    category: 'custom-skills',
    state: 'switchable',
    enabled,
    loaded: enabled,
    skillName: name,
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
 * 场景总览：五个场景行（四矩阵行 + 一 summary 行），两层模型三态格子一次遍历产出。
 * matrix 行的开关写回真源：main=abilityOverrides+子开关字段；sub/executor/scheduler-custom=sceneOverrides 对应键（恢复默认=删整键回跟随工作区）。
 */
export async function buildSceneOverview(
  workspaceId: string,
): Promise<SceneOverviewResult | { error: string }> {
  const workspaces = await getAllWorkspaces();
  const workspace = workspaces.find((w) => w.id === workspaceId);
  if (!workspace) return { error: `工作区不存在: ${workspaceId}` };
  const [config, skillTemplates, allSkills] = await Promise.all([
    getWorkspaceConfig(workspaceId),
    listSkillTemplates(),
    listSkills(null),
  ]);
  const hasWorkspace = !!workspace.path;
  const hasUserGitRepo = detectUserGitRepo(workspace.path);

  const ctx: SceneCellCtx = {
    config,
    hasWorkspace,
    hasUserGitRepo,
    mainActive: resolveAbilities(config, {
      role: 'main',
      hasWorkspace,
      hasUserGitRepo,
      groupId: MOUNT_GROUP_PLACEHOLDER,
    }),
    subActive: resolveAbilities(config, {
      role: 'sub',
      hasWorkspace,
      hasUserGitRepo,
      groupId: MOUNT_GROUP_PLACEHOLDER,
      profile: null,
      sceneOverride: 'sub',
    }),
    executorActive: resolveAbilities(config, {
      role: 'main',
      hasWorkspace,
      hasUserGitRepo,
      groupId: MOUNT_GROUP_PLACEHOLDER,
      sceneOverride: 'executor',
    }),
    schedulerActive: resolveAbilities(config, {
      role: 'main',
      hasWorkspace,
      hasUserGitRepo,
      groupId: MOUNT_GROUP_PLACEHOLDER,
      sceneOverride: 'scheduler',
    }),
    wsSkills: new Set(config.enabledSkills),
    templateByName: new Map(skillTemplates.map((s) => [s.name, s])),
    customSkills: allSkills.filter((s) => s.source === 'custom'),
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
      description: '协作任务的执行会话加载哪些能力。固定层预设跟工作区走。扩展层 skill 与工作区/场景配置解耦：default 任务按基础版执行（不挂 skill），代码实施任务自动挂分步实施 skill。',
      packs: [],
      prompts: EXECUTOR_PROMPTS,
      extensionNote: 'skill 按任务类型查表：default 基础版零 skill，代码实施自动挂分步实施 skill（staged-execution），与工作区/场景 skill 配置解耦',
    },
    {
      id: 'scheduler-custom',
      label: '定时自定义任务',
      kind: 'matrix',
      description: '定时任务运行会话加载哪些基础能力，对所有定时任务统一生效。扩展工具包与 skill 在任务编辑页按任务配置。',
      packs: [],
      groupNotes: { extension: '扩展工具包与 skill 在定时任务编辑页按任务配置' },
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
    const sub = subCell(pack, ctx);
    if (sub) rowById.get('sub')!.packs.push(sub);
    rowById.get('executor')!.packs.push(executorCell(pack, ctx));
    const scheduler = schedulerCell(pack, ctx);
    if (scheduler) rowById.get('scheduler-custom')!.packs.push(scheduler);
  }
  for (const skill of ctx.customSkills) {
    rowById.get('main')!.packs.push(customSkillCell(skill.name, ctx.wsSkills.has(skill.name)));
  }
  rowById.get('scheduler-custom')!.packs.unshift(schedulerBaseCell());

  return { rows, categories: ABILITY_CATEGORIES };
}
