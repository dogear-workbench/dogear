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
import { OPTIONAL_TOOL_PACKS, type ToolPackMeta } from '../services/tool-packs.js';
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
  memory: '记忆',
  stock: '股票分析',
  article: '文章',
  browser: '浏览器',
  'code-workflow': '代码工作流 Skill',
};

const STATE_EXTRACT_REASON = '固定提示词 + emit_state_increment 单工具，不挂载能力包';
const PARSE_ARTICLE_REASON = 'Claude Agent SDK 独立装配（SKILL.md 提示词），不经过能力包体系';

export function packEnabledOf(pack: AbilityPack, config: WorkspaceConfig): boolean {
  return config.abilityOverrides?.[pack.key] ?? pack.defaultEnabled;
}

/** 包开关开启时该格的场景说明；触发条件文字化，是否满足由 resolveAbilities 判定 */
function sceneReason(pack: AbilityPack, kind: AbilityMountSceneKind, hasWorkspace: boolean): string {
  if (kind === 'main' || kind === 'executor') {
    if (kind === 'executor' && pack.key === 'notes') {
      return '工具组随包开关注册（任务申报组派单保底），存卡纪律段不注入';
    }
    if (kind === 'executor' && pack.key === 'group-context') {
      return '会话属于组时只注入组头，无人值守不注入话题状态';
    }
    if (pack.key === 'memory' || pack.key === 'notes') {
      return hasWorkspace
        ? `主会话绑定工作区即加载${pack.key === 'notes' ? '（含任务申报工具）' : ''}`
        : '需绑定工作区路径后加载';
    }
    if (pack.key === 'workspace-git') {
      return hasWorkspace
        ? '绑定工作区即注册 git 工具组并注入 git 历史意识段（主/子会话同条件）'
        : '需绑定工作区路径后加载';
    }
    switch (pack.key) {
      case 'workspace-rules':
      case 'global-rules':
        return '注入每个主会话';
      case 'group-context':
        return '会话属于组时注入组上下文';
      case 'agent-collab':
        return '会话属于组时注册协作工具并注入协作规范';
      case 'shunt':
        return '主会话绑定工作区且属于组时注入分流段并注册 ForkSession 工具（执行会话不注入不注册）';
      case 'web-mcp':
        return '包开启即挂载联网搜索工具（需在设置页配置 GLM API Key，未配置时调用返回提示）';
      default:
        return '包开启；包内 Skill 与工具包受工作区子开关控制';
    }
  }
  switch (pack.key) {
    case 'workspace-rules':
    case 'global-rules':
      return '随包开关注入子会话';
    case 'notes':
      return '仅主会话加载，子会话不注入';
    case 'workspace-git':
      return '绑定工作区即生效（主/子会话同条件），无 Profile 过滤维度';
    case 'shunt':
      return '仅主会话生效，子会话不加载';
    case 'group-context':
      return '会话属于组时生效，无 Profile 过滤维度';
    case 'agent-collab':
      return '交付契约段恒注入（强制）；协作/派遣工具属组恒注册（强制）；包开关仅裁决 sibling 工具组，关闭效果非对称';
    case 'web-mcp':
      return '仅主会话挂载联网搜索工具；子会话本期不挂载';
    default:
      return '包开启；包内 Skill 与工具包受工作区子开关控制';
  }
}

/** personal 场景固定行的加载说明：loaded 由 personal 自己的 config 解析（无工作区路径、无组），如实反映临时会话装配 */
function personalSceneReason(pack: AbilityPack): string {
  switch (pack.key) {
    case 'workspace-rules':
      return '机制生效：读 workspaces/personal/agent.md（大概率空，无注入内容）';
    case 'global-rules':
      return '包开即注入临时会话';
    case 'memory':
      return '包级不生效（无工作区路径被排除）；记忆工具兜底注册可用，纪律段不注入';
    case 'notes':
      return '需绑定工作区路径，临时会话不加载';
    case 'workspace-git':
      return '需绑定工作区路径，临时会话不加载';
    case 'group-context':
    case 'agent-collab':
    case 'shunt':
      return '临时会话无工作区路径且无组，不加载';
    default:
      return '包开即生效；包内 Skill 与工具包受 personal 工作区子开关控制';
  }
}

/** 有 Profile 过滤维度的包：按该 Profile 勾选状态生成原因；无过滤维度返回 null */
function profileFilterReason(pack: AbilityPack, profile: SubAgentProfile): string | null {
  const label = PROFILE_FILTER_LABELS[pack.key];
  if (!label) return null;
  const ab = profile.enabledAbilities;
  if (pack.key === 'code-workflow') {
    const matched = (pack.skills ?? []).filter((s) => ab.skills?.includes(s));
    return matched.length > 0 ? `Profile 白名单命中 ${matched.length} 个 Skill` : 'Profile 未勾选包内 Skill';
  }
  const on = ab[pack.key as 'memory' | 'stock' | 'article' | 'browser'] === true;
  if (pack.key === 'memory') {
    return on ? `Profile 已勾选${label}能力（还需工作区记忆包开启才装载）` : `Profile 未勾选${label}能力`;
  }
  return on ? `Profile 已勾选${label}能力` : `Profile 未勾选${label}能力`;
}

/** 定时自定义任务装载的 skill-packs 包按 toolGroups ∩ enabledToolPacks 计算，对齐 buildCustomToolSet（残留旧 key 静默忽略） */
function schedulerPackHitCell(
  pack: AbilityPack,
  enabledPacks: Set<string>,
): { loaded: boolean; reason: string } {
  if (pack.key === 'browser') {
    return enabledPacks.has('browser')
      ? { loaded: true, reason: '已启用工具包：browser；扩展通道不随定时任务装载，skill 方法论文本不注入' }
      : { loaded: false, reason: '工作区未启用该域任何工具包（扩展通道不随定时任务装载）' };
  }
  const hit = (pack.toolGroups ?? []).filter((g) => enabledPacks.has(g));
  if (hit.length === 0) return { loaded: false, reason: '工作区未启用该域任何工具包' };
  const skillNote = pack.skills?.length ? '；skill 方法论文本不注入' : '';
  return { loaded: true, reason: `已启用工具包：${hit.join('、')}${skillNote}` };
}

/** 定时自定义任务行的 loaded/reason 以 buildCustomToolSet 实际装载为准：memory/notes 按 sceneOverrides.scheduler 三级回退（无键=装载），可选包按工作区工具包命中 */
function schedulerCustomAgentCell(
  pack: AbilityPack,
  enabledPacks: Set<string>,
  config: WorkspaceConfig,
): { loaded: boolean; reason: string } {
  switch (pack.key) {
    case 'memory': {
      const on = scenePackEnabled(pack, config, 'scheduler');
      return on
        ? { loaded: true, reason: '定时任务按场景覆盖三级回退装载记忆工具（无覆盖=默认装载）' }
        : { loaded: false, reason: '场景覆盖已关闭：定时任务不装载记忆工具' };
    }
    case 'notes': {
      const on = scenePackEnabled(pack, config, 'scheduler');
      return on
        ? { loaded: true, reason: '定时任务按场景覆盖装载笔记工具组（任务产物落卡）；任务系统工具为主会话专属' }
        : { loaded: false, reason: '场景覆盖已关闭：定时任务不装载笔记工具组' };
    }
    case 'workspace-rules':
    case 'global-rules':
      return { loaded: false, reason: '后台任务不注入规则段' };
    case 'group-context':
      return { loaded: false, reason: '后台任务无会话组上下文' };
    case 'agent-collab':
      return { loaded: false, reason: '后台任务无派遣与交付通道' };
    case 'code-workflow':
      return { loaded: false, reason: '定时任务无 skill 挂载机制' };
    default:
      return pack.type === 'skill-packs'
        ? schedulerPackHitCell(pack, enabledPacks)
        : { loaded: false, reason: '后台任务不加载该能力包' };
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
    reason: enabled ? sceneReason(pack, 'main', hasWorkspace) : '包开关已关闭',
  });

  const personalActive = resolveAbilities(personalConfig, { role: 'main', hasWorkspace: false, groupId: null });
  const personalEnabled = packEnabledOf(pack, personalConfig);
  rows.push({
    kind: 'personal',
    id: 'personal',
    label: '临时会话',
    system: true,
    loaded: personalActive.has(pack.key),
    reason: personalEnabled ? personalSceneReason(pack) : 'personal 默认关闭（最小能力集）',
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
      reason: enabled ? (filterReason ?? sceneReason(pack, scene.kind, hasWorkspace)) : '包开关已关闭',
      profileDisabled: scene.profile.enabled === false || undefined,
    });
  }

  rows.push({
    kind: 'executor',
    id: 'executor',
    label: '任务执行会话',
    system: true,
    loaded: mainActive.has(pack.key),
    reason: enabled ? sceneReason(pack, 'executor', hasWorkspace) : '包开关已关闭',
  });

  const enabledPacks = new Set(config.enabledToolPacks);
  const customAgentCell = schedulerCustomAgentCell(pack, enabledPacks, config);
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
  const baseReason = hasWorkspace ? '常驻基础设施，绑定工作区即注册，不可关闭' : '当前工作区无路径，跨会话检索组不注册';
  return [
    { kind: 'main', id: 'main', label: '主会话', system: true, loaded: hasWorkspace, reason: baseReason },
    {
      kind: 'personal',
      id: 'personal',
      label: '临时会话',
      system: true,
      loaded: true,
      reason: '基础工具注册（文件边界仅应用数据目录挂载）；dogear-history 只读话题工具放行，辅助归置建议',
    },
    {
      kind: 'sub-default',
      id: 'sub-default',
      label: '子会话·默认',
      system: true,
      loaded: hasWorkspace,
      reason: hasWorkspace ? '常驻基础设施不受 Profile 过滤，默认 Profile 子会话同样注册' : baseReason,
    },
    ...profiles
      .filter((p) => p.id !== 'default')
      .map((p) => ({
        kind: 'profile' as const,
        id: p.id,
        label: p.name,
        system: false,
        loaded: hasWorkspace,
        reason: '常驻基础设施不受 Profile 子开关约束',
        profileDisabled: p.enabled === false || undefined,
      })),
    {
      kind: 'executor',
      id: 'executor',
      label: '任务执行会话',
      system: true,
      loaded: hasWorkspace,
      reason: '常驻基础设施，任务执行会话同样注册',
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

export interface SceneSubToggleToolPack {
  id: string;
  label: string;
  enabled: boolean;
}

/** 格子三态：switchable=预设值+开关可改；forced=强制装载无开关；excluded=条件排除灰显（开关无裁决意义） */
export type SceneCellState = 'switchable' | 'forced' | 'excluded';

export interface ScenePackSubToggles {
  /** 仅 skill-packs 包存在（总分两级开关：prompt-only / segment-tools 无展开层）；定时任务场景 skills 恒空数组 */
  skills: SceneSubToggleSkill[];
  toolPacks: SceneSubToggleToolPack[];
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
  /** 兼容字段：旧前端仅认 main/personal/scheduler-custom 三行的开关；新前端请按 state 渲染（Step 4 后删除） */
  editable: boolean;
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
  /** 兼容字段：summary 行恒 false。新前端请按 kind 渲染（Step 4 后删除） */
  editable: boolean;
  /** 整页说明 */
  description: string;
  packs: ScenePackCell[];
  /** 行内提示词展示项（summary 行必有；executor 行带执行提示词模板全文） */
  prompts?: SceneSummaryPrompt[];
  /** 仅 executor 行：扩展层按任务类型装配的说明文字（execProfile 分支见后续任务类型改造） */
  extensionNote?: string;
}

export interface SceneOverviewResult {
  rows: SceneOverviewRow[];
  categories: readonly AbilityCategoryMeta[];
}

/** 并入包内的 server 名（非 OPTIONAL_TOOL_PACKS 成员，无独立开关）的展示名 */
const BUNDLED_GROUP_LABELS: Record<string, string> = { 'dogear-extension': '浏览器扩展' };

interface SceneCellCtx {
  config: WorkspaceConfig;
  personalConfig: WorkspaceConfig;
  hasWorkspace: boolean;
  mainActive: Set<string>;
  personalActive: Set<string>;
  subActive: Set<string>;
  executorActive: Set<string>;
  wsToolPacks: Set<string>;
  wsSkills: Set<string>;
  personalToolPacks: Set<string>;
  personalSkills: Set<string>;
  templateByName: Map<string, SkillTemplateMeta>;
  optionalPackByName: Map<string, ToolPackMeta>;
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

function toolPackToggleList(pack: AbilityPack, enabledPacks: Set<string>, ctx: SceneCellCtx): SceneSubToggleToolPack[] {
  return (pack.toolGroups ?? []).map((id) => ({
    id,
    label: ctx.optionalPackByName.get(id)?.label ?? BUNDLED_GROUP_LABELS[id] ?? id,
    enabled: enabledPacks.has(id),
  }));
}

/** personal 场景结构性排除的固定层包（无工作区路径/无组 → 代码条件恒排除），灰显展示 */
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
    editable: true,
    reason: enabled ? sceneReason(pack, 'main', ctx.hasWorkspace) : '包开关已关闭',
    subToggles: pack.type === 'skill-packs'
      ? {
          skills: skillToggleList(pack, ctx.wsSkills, ctx),
          toolPacks: toolPackToggleList(pack, ctx.wsToolPacks, ctx),
        }
      : undefined,
  };
}

function personalCell(pack: AbilityPack, ctx: SceneCellCtx): ScenePackCell {
  const enabled = packEnabledOf(pack, ctx.personalConfig);
  const loaded = ctx.personalActive.has(pack.key);
  const head = { key: pack.key, label: pack.label, category: pack.category, loaded };
  if (pack.key === 'workspace-rules') {
    return {
      ...head,
      state: 'forced',
      enabled,
      editable: false,
      reason: '机制级只读：读 workspaces/personal/agent.md（大概率空，无注入内容），场景页不做开关',
    };
  }
  if (PERSONAL_EXCLUDED_KEYS.has(pack.key)) {
    return {
      ...head,
      state: 'excluded',
      enabled: false,
      editable: false,
      reason: personalSceneReason(pack),
    };
  }
  return {
    ...head,
    state: 'switchable',
    enabled,
    editable: true,
    reason: enabled ? personalSceneReason(pack) : 'personal 默认关闭（最小能力集）',
    subToggles: pack.type === 'skill-packs'
      ? {
          skills: skillToggleList(pack, ctx.personalSkills, ctx),
          toolPacks: toolPackToggleList(pack, ctx.personalToolPacks, ctx),
        }
      : undefined,
  };
}

function subCell(pack: AbilityPack, ctx: SceneCellCtx): ScenePackCell {
  const enabled = scenePackEnabled(pack, ctx.config, 'sub');
  const loaded = ctx.subActive.has(pack.key);
  const reason = pack.key === 'agent-collab'
    ? '交付契约段恒注入（强制）；协作/派遣工具属组恒注册（强制）；包开关仅裁决 sibling 工具组，关闭效果非对称'
    : sceneReason(pack, 'sub-default', ctx.hasWorkspace);
  const head = { key: pack.key, label: pack.label, category: pack.category, loaded };
  if (pack.subAutonomous) {
    return {
      ...head,
      state: 'excluded',
      enabled: false,
      loaded: false,
      editable: false,
      reason: '由 Profile 裁决（子会话派遣页配置扩展授权），场景层不做开关',
    };
  }
  const conditionExcluded =
    pack.key === 'notes' ||
    pack.key === 'shunt' ||
    (pack.key === 'workspace-git' && !ctx.hasWorkspace);
  if (conditionExcluded) {
    return { ...head, state: 'excluded', enabled: false, editable: false, reason };
  }
  return {
    ...head,
    state: 'switchable',
    enabled,
    // 兼容字段：旧前端会给 switchable 格子接 abilityOverrides 写回，sub 行真源是 sceneOverrides.sub，兼容期禁用防误写（Step 4 前端按 state 渲染后恢复派生）
    editable: false,
    reason: enabled ? reason : '场景覆盖或工作区包开关已关闭',
  };
}

function executorCell(pack: AbilityPack, ctx: SceneCellCtx): ScenePackCell {
  const enabled = scenePackEnabled(pack, ctx.config, 'executor');
  const loaded = ctx.executorActive.has(pack.key);
  const reason = enabled ? sceneReason(pack, 'executor', ctx.hasWorkspace) : '场景覆盖或工作区包开关已关闭';
  const head = { key: pack.key, label: pack.label, category: pack.category, loaded };
  if (pack.key === 'shunt') {
    return {
      ...head,
      state: 'excluded',
      enabled: false,
      loaded: false,
      editable: false,
      reason: '仅主会话生效：执行会话不注入分流段不注册 ForkSession（无人值守无分流场景）',
    };
  }
  const conditionExcluded =
    !ctx.hasWorkspace && (pack.key === 'memory' || pack.key === 'notes' || pack.key === 'workspace-git');
  if (conditionExcluded) {
    return { ...head, state: 'excluded', enabled: false, editable: false, reason: '需绑定工作区路径后加载' };
  }
  return {
    ...head,
    state: 'switchable',
    enabled,
    // 兼容字段：同 subCell，executor 真源是 sceneOverrides.executor，兼容期禁用旧前端的 abilityOverrides 写回
    editable: false,
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
    editable: false,
    reason: '定时任务运行时恒装基础文件与搜索工具，不可关闭（常驻基础设施）',
  };
}

function schedulerCustomCell(pack: AbilityPack, ctx: SceneCellCtx): ScenePackCell {
  const cell = schedulerCustomAgentCell(pack, ctx.wsToolPacks, ctx.config);
  const head = { key: pack.key, label: pack.label, category: pack.category, loaded: cell.loaded };
  if (pack.key === 'memory' || pack.key === 'notes') {
    return {
      ...head,
      state: 'switchable',
      enabled: scenePackEnabled(pack, ctx.config, 'scheduler'),
      editable: true,
      reason: cell.reason,
    };
  }
  return {
    ...head,
    state: 'excluded',
    enabled: false,
    editable: false,
    reason: pack.type === 'skill-packs'
      ? '由定时任务编辑页按任务配置工具包（toolPacksOverride ?? 工作区工具包），场景页不做开关'
      : cell.reason,
  };
}

function fixedSceneCell(pack: AbilityPack, loaded: boolean, reason: string): ScenePackCell {
  return {
    key: pack.key,
    label: pack.label,
    category: pack.category,
    state: 'excluded',
    enabled: false,
    loaded,
    editable: false,
    reason,
  };
}

const EXECUTOR_PROMPT_META: SceneSummaryPrompt = {
  id: 'executor',
  label: '执行提示词模板',
  note: '任务入队时按此模板拼接执行提示词（标题/ID/计划路径填任务实值）',
  content: buildExecutionPrompt(EXECUTION_PROMPT_PREVIEW),
};

/**
 * 场景总览：七个场景行（六矩阵行 + 两 summary 行），两层模型三态格子一次遍历产出。
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
    wsToolPacks: new Set(config.enabledToolPacks),
    wsSkills: new Set(config.enabledSkills),
    personalToolPacks: new Set(personalConfig.enabledToolPacks),
    personalSkills: new Set(personalConfig.enabledSkills),
    templateByName: new Map(skillTemplates.map((s) => [s.name, s])),
    optionalPackByName: new Map(OPTIONAL_TOOL_PACKS.map((p) => [p.name, p])),
  };

  const rows: SceneOverviewRow[] = [
    {
      id: 'main',
      label: '主会话',
      kind: 'matrix',
      editable: true,
      description: '两层模型的上层裁决页：包开关写回该工作区 abilityOverrides，Skill/工具包子开关写回 enabledSkills / enabledToolPacks',
      packs: [],
    },
    {
      id: 'personal',
      label: '临时会话',
      kind: 'matrix',
      editable: true,
      description: '独立真源为 personal 工作区配置：固定层按临时会话天然裁剪只读展示，global-rules 与扩展包开关写回 personal 配置',
      packs: [],
    },
    {
      id: 'sub',
      label: '子会话',
      kind: 'matrix',
      editable: true,
      description: '固定层开关写回该工作区 sceneOverrides.sub，恢复默认=删除该键回跟随工作区；扩展能力由派遣页 Profile 裁决',
      packs: [],
    },
    {
      id: 'executor',
      label: '任务执行会话',
      kind: 'matrix',
      editable: true,
      description: '固定层开关写回该工作区 sceneOverrides.executor，恢复默认=删除该键回跟随工作区；shunt 对无人值守执行会话排除',
      packs: [],
      prompts: [EXECUTOR_PROMPT_META],
      extensionNote: '扩展能力按任务类型装配（execProfile，由派单 agent 在 CreateTask 时标注）：代码实施任务挂载 staged-execution skill，其余按默认；页面不做扩展层控件',
    },
    {
      id: 'scheduler-custom',
      label: '定时自定义任务',
      kind: 'matrix',
      editable: true,
      description: '记忆/笔记开关写回该工作区 sceneOverrides.scheduler（预设开=现状），恢复默认=删除该键；基础工具恒装标强制；扩展工具包在任务编辑页按任务配置（toolPacksOverride）',
      packs: [],
    },
    {
      id: 'scheduler-state',
      label: '话题状态抽取',
      kind: 'summary',
      editable: false,
      description: '后台一次性任务：读完会话组新增逐字稿后调用 emit_state_increment 单工具输出结构化增量到话题状态卡，不经能力包体系',
      packs: [],
      prompts: [{
        id: 'state-extract',
        label: '状态抽取提示词',
        note: 'systemPrompt=运行时固定角色语；template=<configDir>/state-extract-prompt.md（缺失自动播种默认值）',
      }],
    },
    {
      id: 'scheduler-parse',
      label: '文章解析',
      kind: 'summary',
      editable: false,
      description: 'pi runOnce 独立装配（SKILL.md 提示词 + SaveParsedArticle / UpdatePlatformScript 专用工具），不经能力包体系；属导入管线的 AI 兑底写侧，与会话读侧的文章能力包分工不同',
      packs: [],
      prompts: [{
        id: 'parse-article',
        label: '文章解析 SKILL.md',
        note: 'systemPrompt=SKILL.md 剥 frontmatter 正文；skillMd=原始全文（<configDir>/article-parser/SKILL.md）',
      }],
    },
  ];
  const rowById = new Map(rows.map((r) => [r.id, r]));

  for (const pack of ABILITY_PACKS) {
    rowById.get('main')!.packs.push(mainCell(pack, ctx));
    rowById.get('personal')!.packs.push(personalCell(pack, ctx));
    rowById.get('sub')!.packs.push(subCell(pack, ctx));
    rowById.get('executor')!.packs.push(executorCell(pack, ctx));
    rowById.get('scheduler-custom')!.packs.push(schedulerCustomCell(pack, ctx));
  }
  rowById.get('scheduler-custom')!.packs.unshift(schedulerBaseCell());

  return { rows, categories: ABILITY_CATEGORIES };
}
