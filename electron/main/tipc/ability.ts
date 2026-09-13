// electron/main/tipc/ability.ts
import { tipc } from '@egoist/tipc/main';
import {
  ABILITY_PACKS,
  SKILL_PACK_MAP,
  resolveAbilities,
  type AbilityPack,
  type AbilityPackType,
} from '../agents/ability-registry.js';
import {
  getSystemPromptSegments,
  type SystemPromptSegmentKey,
} from '../agents/session-append-templates.js';
import { getAllToolGroups, type ToolGroupInfo, type ToolInfo } from '../agents/tools/tool-registry.js';
import { loadSettings } from '../services/settings-service.js';
import {
  createDefaultSubAgentProfile,
  type AppSettings,
  type SubAgentProfile,
} from '../services/settings-types.js';
import { OPTIONAL_TOOL_PACKS } from '../services/tool-packs.js';
import { listSkillTemplates } from '../services/skill-template-service.js';
import { getWorkspaceConfig, type WorkspaceConfig } from '../services/workspace-config-service.js';
import { getAll as getAllWorkspaces } from '../services/workspace-json-service.js';

const t = tipc.create();

export type { AbilityPackType };

/** 段模板展示元数据（段全文只读，跟随代码版本） */
export interface AbilitySegmentMeta {
  key: SystemPromptSegmentKey;
  label: string;
  template: string;
  triggerDescription: string;
}

/**
 * 工具组展示元数据。id 沿用注册表 toolGroups 的混合语义：
 * 常驻组 = MCP server 名（dogear-memory 等，label 来自 tool-registry）；
 * 可选包 = 工具包 name（stock-quote 等，label 来自 OPTIONAL_TOOL_PACKS，pack 字段非空）。
 */
export interface AbilityToolGroupMeta {
  id: string;
  label: string;
  tools: ToolInfo[];
  pack?: {
    mcpServer: string;
    toolCount: number;
    requiresWorkspace: boolean;
    requirements?: string;
  };
}

export interface AbilitySkillMeta {
  name: string;
  /** SKILL.md 首行标题；模板缺失为 undefined（前端 chip 回退显示 key） */
  title?: string;
  /** skill 模板 description；模板缺失为 undefined（前端可标注文件缺失） */
  description?: string;
  /** skill 关联的可选工具包 name（SKILL_PACK_MAP） */
  toolPacks: string[];
}

export type AbilityPackView = AbilityPack & {
  segments: AbilitySegmentMeta[];
  toolGroupMetas: AbilityToolGroupMeta[];
  skillMetas: AbilitySkillMeta[];
};

export interface AbilitySystemBehaviorView {
  key: string;
  label: string;
  triggerDescription: string;
  segmentKey: SystemPromptSegmentKey;
  readonly: true;
  segment: AbilitySegmentMeta;
}

/** 常驻工具组展示元数据（不在能力包体系的固定基础设施：跨会话检索） */
export interface ResidentToolGroupMeta {
  id: string;
  label: string;
  tools: ToolInfo[];
}

/** 常驻工具组：绑定工作区即注册，不可关，前端标注触发条件（任务系统已归笔记包，不再常驻） */
const RESIDENT_GROUP_IDS = ['dogear-history'] as const;

export type AbilityMountSceneKind = 'main' | 'sub-default' | 'profile' | 'executor' | 'scheduler';

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

/**
 * 工具组工具明细依赖各工具模块在 tool-registry 完成注册；
 * import 覆盖能力包与常驻工具区需要展示的模块。
 */
const PACK_TOOL_MODULE_IMPORTS = [
  () => import('../agents/tools/memory-tools.js'),
  () => import('../agents/tools/notes-tools.js'),
  () => import('../agents/tools/delegation-tools.js'),
  () => import('../agents/tools/group-tools.js'),
  () => import('../agents/tools/reference-tools.js'),
  () => import('../agents/tools/task-tools.js'),
  () => import('../agents/tools/stock-tools.js'),
  () => import('../agents/tools/stock-analysis-tools.js'),
  () => import('../agents/tools/stock-announcement-tools.js'),
  () => import('../agents/tools/stock-picking-tools.js'),
  () => import('../agents/tools/article-tools.js'),
  () => import('../agents/tools/browser-tools.js'),
  () => import('../agents/tools/extension-tools.js'),
  () => import('../agents/tools/web-mcp-tools.js'),
] as const;

async function loadPackToolGroups(): Promise<ToolGroupInfo[]> {
  await Promise.all(PACK_TOOL_MODULE_IMPORTS.map((load) => load()));
  return getAllToolGroups();
}

function buildSegmentMetaMap(): Map<SystemPromptSegmentKey, AbilitySegmentMeta> {
  return new Map(
    getSystemPromptSegments().map((seg) => [
      seg.key,
      {
        key: seg.key,
        label: seg.label,
        template: seg.template,
        triggerDescription: seg.triggerDescription,
      },
    ]),
  );
}

function segmentMetaOf(
  map: Map<SystemPromptSegmentKey, AbilitySegmentMeta>,
  key: SystemPromptSegmentKey,
): AbilitySegmentMeta {
  return map.get(key) ?? { key, label: key, template: '', triggerDescription: '' };
}

function buildToolGroupMeta(
  id: string,
  groupByServer: Map<string, { label: string; tools: ToolInfo[] }>,
  packByName: Map<string, (typeof OPTIONAL_TOOL_PACKS)[number]>,
): AbilityToolGroupMeta {
  const optionalPack = packByName.get(id);
  if (optionalPack) {
    return {
      id,
      label: optionalPack.label,
      tools: groupByServer.get(optionalPack.mcpServerName)?.tools ?? [],
      pack: {
        mcpServer: optionalPack.mcpServerName,
        toolCount: optionalPack.toolCount,
        requiresWorkspace: optionalPack.requiresWorkspace,
        requirements: optionalPack.requirements,
      },
    };
  }
  return {
    id,
    label: groupByServer.get(id)?.label ?? id,
    tools: groupByServer.get(id)?.tools ?? [],
  };
}

function packEnabledOf(pack: AbilityPack, config: WorkspaceConfig): boolean {
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
    switch (pack.key) {
      case 'workspace-rules':
      case 'global-rules':
        return '注入每个主会话';
      case 'core-profile':
        return '注入每个主会话（内容在数据中心维护）';
      case 'group-context':
        return '会话属于组时注入组上下文';
      case 'agent-collab':
        return '会话属于组时注册协作工具并注入协作规范';
      case 'web-mcp':
        return '包开启即挂载联网搜索工具（需在设置页配置 GLM API Key，未配置时调用返回提示）';
      default:
        return '包开启；包内 Skill 与工具包受工作区子开关控制';
    }
  }
  switch (pack.key) {
    case 'core-profile':
      return '仅主会话注入，子会话不加载核心画像';
    case 'workspace-rules':
    case 'global-rules':
      return '随包开关注入子会话';
    case 'notes':
      return '仅主会话加载，子会话不注入';
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
      return { loaded: true, reason: '定时任务固定装载记忆工具（autonomous 契约），不受包开关约束' };
    case 'workspace-rules':
    case 'global-rules':
    case 'core-profile':
      return { loaded: false, reason: '后台任务不注入规则与画像段' };
    case 'notes':
      return { loaded: false, reason: '笔记与任务工具为主会话专属' };
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

function buildMountRows(
  pack: AbilityPack,
  config: WorkspaceConfig,
  settings: AppSettings,
  hasWorkspace: boolean,
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
    // core-profile 的子会话排除在拼装侧（pi-session 段注入条件），包级解析不含此规则，矩阵在此对齐
    const loaded = pack.key === 'core-profile' ? false : active.has(pack.key);
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
    reason: '固定提示词 + emit_state_increment 单工具，不挂载能力包',
  });
  rows.push({
    kind: 'scheduler',
    id: 'parse-article',
    label: '文章解析',
    system: true,
    loaded: false,
    reason: 'Claude Agent SDK 独立装配（SKILL.md 提示词），不经过能力包体系',
  });

  return rows;
}

function buildSystemMountRows(settings: AppSettings, hasWorkspace: boolean): AbilityMountSceneRow[] {
  const profiles = settings.subAgent?.profiles ?? [];
  const baseReason = hasWorkspace ? '常驻基础设施，绑定工作区即注册，不可关闭' : '当前工作区无路径，跨会话检索组不注册';
  return [
    { kind: 'main', id: 'main', label: '主会话', system: true, loaded: hasWorkspace, reason: baseReason },
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

export const abilityRouter = {
  /** 能力包元数据 + 系统行为段（聚合注册表 / 段模板 / 工具注册中心 / skill 模板），能力页唯一数据源 */
  getAbilityPacks: t.procedure.action(async () => {
    try {
      const [toolGroups, skillTemplates] = await Promise.all([
        loadPackToolGroups(),
        listSkillTemplates(),
      ]);
      const segmentMap = buildSegmentMetaMap();
      const groupByServer = new Map(toolGroups.map((g) => [g.server, g]));
      const packByName = new Map(OPTIONAL_TOOL_PACKS.map((p) => [p.name, p]));
      const templateByName = new Map(skillTemplates.map((s) => [s.name, s]));

      const packs: AbilityPackView[] = ABILITY_PACKS.map((pack) => ({
        ...pack,
        segments: (pack.segmentKeys ?? []).map((key) => segmentMetaOf(segmentMap, key)),
        toolGroupMetas: (pack.toolGroups ?? []).map((id) =>
          buildToolGroupMeta(id, groupByServer, packByName),
        ),
        skillMetas: (pack.skills ?? []).map((name) => ({
          name,
          title: templateByName.get(name)?.title,
          description: templateByName.get(name)?.description,
          toolPacks: SKILL_PACK_MAP[name] ?? [],
        })),
      }));

      // SYSTEM_BEHAVIORS 已退役：会话组上下文归会话组包、契约段归协作包展示；系统行为卡数据改为纯常驻（基础工具 + residentToolGroups）
      const systemBehaviors: AbilitySystemBehaviorView[] = [];

      const residentToolGroups: ResidentToolGroupMeta[] = RESIDENT_GROUP_IDS.map((id) => {
        const group = groupByServer.get(id);
        return { id, label: group?.label ?? id, tools: group?.tools ?? [] };
      });

      return { packs, systemBehaviors, residentToolGroups };
    } catch (error) {
      console.error('[ability] getAbilityPacks 失败:', error);
      return { error: String(error) };
    }
  }),

  /** 加载情况场景矩阵（读时快照不订阅）：行 = 会话场景，每格 = 该包在该场景是否加载 + 一句话原因 */
  getAbilityMounts: t.procedure
    .input<{ key: string; workspaceId: string }>()
    .action(async ({ input }) => {
      try {
        const [workspaces, settings] = await Promise.all([getAllWorkspaces(), loadSettings()]);
        const workspace = workspaces.find((w) => w.id === input.workspaceId);
        if (!workspace) {
          return { error: `工作区不存在: ${input.workspaceId}` };
        }
        const config = await getWorkspaceConfig(input.workspaceId);
        const hasWorkspace = !!workspace.path;

        let packSummary: { key: string; label: string; type: AbilityPackType } | null = null;
        let rows: AbilityMountSceneRow[];
        if (input.key === SYSTEM_MOUNTS_PACK_KEY) {
          rows = buildSystemMountRows(settings, hasWorkspace);
        } else {
          const found = ABILITY_PACKS.find((p) => p.key === input.key);
          if (!found) {
            return { error: `未知能力包: ${input.key}` };
          }
          packSummary = { key: found.key, label: found.label, type: found.type };
          rows = buildMountRows(found, config, settings, hasWorkspace);
        }

        return { pack: packSummary, rows };
      } catch (error) {
        console.error('[ability] getAbilityMounts 失败:', error);
        return { error: String(error) };
      }
    }),
};
