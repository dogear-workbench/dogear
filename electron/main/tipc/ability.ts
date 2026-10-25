// electron/main/tipc/ability.ts
import { tipc } from '@egoist/tipc/main';
import {
  ABILITY_PACKS,
  SKILL_PACK_MAP,
  type AbilityPack,
  type AbilityPackType,
} from '../agents/ability-registry.js';
import {
  getSystemPromptSegments,
  type SystemPromptSegmentKey,
} from '../agents/session-append-templates.js';
import { getAllToolGroups, type ToolGroupInfo, type ToolInfo } from '../agents/tools/tool-registry.js';
import { loadSettings, getConfigDir } from '../services/settings-service.js';
import { getArticleParserSkillsDir } from '../services/article-parser-skills-service.js';
import { loadArticleParseSkill, readArticleParseSkillMd } from '../agents/tasks/parse-article-task.js';
import type { AppSettings } from '../services/settings-types.js';
import { OPTIONAL_TOOL_PACKS } from '../services/tool-packs.js';
import { listSkillTemplates } from '../services/skill-template-service.js';
import { getWorkspaceConfig, type WorkspaceConfig } from '../services/workspace-config-service.js';
import { getAll as getAllWorkspaces } from '../services/workspace-json-service.js';
import {
  SYSTEM_MOUNTS_PACK_KEY,
  buildMountRows,
  buildSceneOverview,
  buildSystemMountRows,
  detectUserGitRepo,
  packEnabledOf,
  type AbilityMountSceneKind,
  type AbilityMountSceneRow,
} from './ability-scene.js';

const t = tipc.create();

export type { AbilityPackType };
export { SYSTEM_MOUNTS_PACK_KEY };
export type { AbilityMountSceneKind, AbilityMountSceneRow };

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
  /** 该组按需挂载（registry deferredToolGroups 声明） */
  deferred: boolean;
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
  () => import('../agents/tools/skill-tools.js'),
  () => import('../agents/tools/scheduler-tools.js'),
  () => import('../agents/tools/git-tools.js'),
  () => import('../agents/tools/stock-tools.js'),
  () => import('../agents/tools/stock-analysis-tools.js'),
  () => import('../agents/tools/stock-announcement-tools.js'),
  () => import('../agents/tools/stock-picking-tools.js'),
  () => import('../agents/tools/article-tools.js'),
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
  deferredGroups: ReadonlySet<string>,
): AbilityToolGroupMeta {
  const deferred = deferredGroups.has(id);
  const optionalPack = packByName.get(id);
  if (optionalPack) {
    return {
      id,
      label: optionalPack.label,
      tools: groupByServer.get(optionalPack.mcpServerName)?.tools ?? [],
      deferred,
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
    deferred,
  };
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

      const packs: AbilityPackView[] = ABILITY_PACKS.map((pack) => {
        const deferredGroups = new Set(pack.deferredToolGroups ?? []);
        return {
          ...pack,
          segments: (pack.segmentKeys ?? []).map((key) => segmentMetaOf(segmentMap, key)),
          toolGroupMetas: (pack.toolGroups ?? []).map((id) =>
            buildToolGroupMeta(id, groupByServer, packByName, deferredGroups),
          ),
          skillMetas: (pack.skills ?? []).map((name) => ({
            name,
            title: templateByName.get(name)?.title,
            description: templateByName.get(name)?.description,
            toolPacks: SKILL_PACK_MAP[name] ?? [],
          })),
        };
      });

      // 固定注入的提示词段归系统行为展示（不可关闭、不归能力包管）；段数据从 segmentMap 取单一来源
      const appDataSegment = segmentMetaOf(segmentMap, 'app-data-guidance');
      const systemBehaviors: AbilitySystemBehaviorView[] = [
        {
          key: 'app-data-guidance',
          label: appDataSegment.label,
          triggerDescription: appDataSegment.triggerDescription,
          segmentKey: 'app-data-guidance',
          readonly: true as const,
          segment: appDataSegment,
        },
      ];

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
          rows = buildMountRows(found, config, settings, hasWorkspace, detectUserGitRepo(workspace.path));
        }

        return { pack: packSummary, rows };
      } catch (error) {
        console.error('[ability] getAbilityMounts 失败:', error);
        return { error: String(error) };
      }
    }),

  /** 场景总览（读时快照不订阅）：行 = 会话场景，packs = 该场景的包矩阵，场景页唯一数据源 */
  getSceneOverview: t.procedure
    .input<{ workspaceId: string }>()
    .action(async ({ input }) => {
      try {
        return await buildSceneOverview(input.workspaceId);
      } catch (error) {
        console.error('[ability] getSceneOverview 失败:', error);
        return { error: String(error) };
      }
    }),

  /** 文章解析场景提示词（只读）：与解析任务同源同 fallback（loadArticleParseSkill），skillMd 为含 frontmatter 的原始全文 */
  getParseArticlePrompt: t.procedure.action(async () => {
    try {
      const skillsDir = getArticleParserSkillsDir();
      const [systemPrompt, skillMd] = await Promise.all([
        loadArticleParseSkill(skillsDir),
        readArticleParseSkillMd(skillsDir),
      ]);
      return { systemPrompt, skillMd: skillMd ?? '' };
    } catch (error) {
      console.error('[ability] getParseArticlePrompt 失败:', error);
      return { error: String(error) };
    }
  }),
};
