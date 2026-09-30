// 场景维度能力数据：挂载矩阵（按包看场景）与场景总览（按场景看包）的共同底座
import {
  ABILITY_CATEGORIES,
  ABILITY_PACKS,
  resolveAbilities,
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
      return '交付契约段恒注入；协作工具随包开关且属组时注册（子会话强制生效）';
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

/** 定时自定义任务行的 loaded/reason 以 buildCustomToolSet 实际装载为准（不查包总开关，只查 enabledToolPacks） */
function schedulerCustomAgentCell(
  pack: AbilityPack,
  enabledPacks: Set<string>,
): { loaded: boolean; reason: string } {
  switch (pack.key) {
    case 'memory':
      return { loaded: true, reason: '定时任务固定装载记忆工具，不受包开关约束' };
    case 'notes':
      return { loaded: true, reason: '定时任务固定装载笔记工具组（任务产物落卡）；任务系统工具为主会话专属' };
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
  const customAgentCell = schedulerCustomAgentCell(pack, enabledPacks);
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

// ---- 场景总览（按场景看包的转置矩阵） ----

export type SceneOverviewId =
  | 'main'
  | 'personal'
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

export interface ScenePackSubToggles {
  /** 仅 skill-packs 包存在（总分两级开关：prompt-only / segment-tools 无展开层）；定时任务场景 skills 恒空数组 */
  skills: SceneSubToggleSkill[];
  toolPacks: SceneSubToggleToolPack[];
}

export interface ScenePackCell {
  key: string;
  label: string;
  category: AbilityCategoryMeta['key'];
  /** 该场景真源里的开关现值：工作区/personal 走 overrides ?? default，定时 = enabledToolPacks 命中任一工具组 */
  enabled: boolean;
  /** 最终装配结果（resolveAbilities / 定时按 buildCustomToolSet 语义） */
  loaded: boolean;
  /** 该格是否有裁决权（灰显 = false：只读场景或代码定死的格子） */
  editable: boolean;
  reason: string;
  /** 仅可编辑场景的展开层 */
  subToggles?: ScenePackSubToggles;
}

export interface SceneOverviewRow {
  id: SceneOverviewId;
  label: string;
  /** false = 整页只读场景 */
  editable: boolean;
  /** 整页说明（只读场景的固定装配描述） */
  description: string;
  packs: ScenePackCell[];
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

function mainCell(pack: AbilityPack, ctx: SceneCellCtx): ScenePackCell {
  const enabled = packEnabledOf(pack, ctx.config);
  return {
    key: pack.key,
    label: pack.label,
    category: pack.category,
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
  return {
    key: pack.key,
    label: pack.label,
    category: pack.category,
    enabled,
    loaded: ctx.personalActive.has(pack.key),
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

function executorCell(pack: AbilityPack, ctx: SceneCellCtx): ScenePackCell {
  const enabled = packEnabledOf(pack, ctx.config);
  return {
    key: pack.key,
    label: pack.label,
    category: pack.category,
    enabled,
    loaded: ctx.mainActive.has(pack.key),
    editable: false,
    reason: enabled ? sceneReason(pack, 'executor', ctx.hasWorkspace) : '包开关已关闭',
  };
}

function schedulerCustomCell(pack: AbilityPack, ctx: SceneCellCtx): ScenePackCell {
  const cell = schedulerCustomAgentCell(pack, ctx.wsToolPacks);
  const toggleable = pack.type === 'skill-packs' && (pack.toolGroups?.length ?? 0) > 0;
  return {
    key: pack.key,
    label: pack.label,
    category: pack.category,
    enabled: toggleable ? (pack.toolGroups ?? []).some((g) => ctx.wsToolPacks.has(g)) : false,
    loaded: cell.loaded,
    editable: toggleable,
    reason: cell.reason,
    subToggles: toggleable
      ? { skills: [], toolPacks: toolPackToggleList(pack, ctx.wsToolPacks, ctx) }
      : undefined,
  };
}

function fixedSceneCell(pack: AbilityPack, loaded: boolean, reason: string): ScenePackCell {
  return {
    key: pack.key,
    label: pack.label,
    category: pack.category,
    enabled: false,
    loaded,
    editable: false,
    reason,
  };
}

/**
 * 场景总览：六场景 × 13 包矩阵，一次遍历产出。
 * 只读场景（executor/state/parse）整页 editable: false，packs 仍给 loaded/reason；
 * 可编辑场景的格内开关写回真源见 design：主会话/personal 走 abilityOverrides + 子开关字段，定时只走 enabledToolPacks。
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

  const ctx: SceneCellCtx = {
    config,
    personalConfig,
    hasWorkspace: !!workspace.path,
    mainActive: resolveAbilities(config, { role: 'main', hasWorkspace: !!workspace.path, groupId: MOUNT_GROUP_PLACEHOLDER }),
    personalActive: resolveAbilities(personalConfig, { role: 'main', hasWorkspace: false, groupId: null }),
    wsToolPacks: new Set(config.enabledToolPacks),
    wsSkills: new Set(config.enabledSkills),
    personalToolPacks: new Set(personalConfig.enabledToolPacks),
    personalSkills: new Set(personalConfig.enabledSkills),
    templateByName: new Map(skillTemplates.map((s) => [s.name, s])),
    optionalPackByName: new Map(OPTIONAL_TOOL_PACKS.map((p) => [p.name, p])),
  };

  const rows: SceneOverviewRow[] = [
    { id: 'main', label: '主会话', editable: true, description: '包开关与子开关在此裁决，写回该工作区 abilityOverrides / enabledSkills / enabledToolPacks', packs: [] },
    { id: 'personal', label: '临时会话', editable: true, description: '独立真源为 personal 工作区配置，字段同构，恢复默认回落最小能力集', packs: [] },
    { id: 'executor', label: '任务执行会话', editable: false, description: '随主会话开关装配，仅段级裁剪差异（无分流段、无存卡纪律段），无独立开关', packs: [] },
    { id: 'scheduler-custom', label: '定时自定义任务', editable: true, description: '仅工具包层可调（写回工作区 enabledToolPacks）；记忆与笔记工具组固定装载', packs: [] },
    { id: 'scheduler-state', label: '话题状态抽取', editable: false, description: '固定提示词 + 单工具装配，不经能力包体系，整页只读', packs: [] },
    { id: 'scheduler-parse', label: '文章解析', editable: false, description: 'Claude Agent SDK 独立装配，不经能力包体系，整页只读', packs: [] },
  ];
  const rowById = new Map(rows.map((r) => [r.id, r]));

  for (const pack of ABILITY_PACKS) {
    rowById.get('main')!.packs.push(mainCell(pack, ctx));
    rowById.get('personal')!.packs.push(personalCell(pack, ctx));
    rowById.get('executor')!.packs.push(executorCell(pack, ctx));
    rowById.get('scheduler-custom')!.packs.push(schedulerCustomCell(pack, ctx));
    rowById.get('scheduler-state')!.packs.push(fixedSceneCell(pack, false, STATE_EXTRACT_REASON));
    rowById.get('scheduler-parse')!.packs.push(fixedSceneCell(pack, false, PARSE_ARTICLE_REASON));
  }

  return { rows, categories: ABILITY_CATEGORIES };
}
