// electron/main/tipc/ability.ts
import { tipc } from '@egoist/tipc/main';
import {
  ABILITY_PACKS,
  SKILL_PACK_MAP,
  SYSTEM_BEHAVIORS,
  TOOL_PACK_TO_ABILITY,
  buildProfileAbilityMount,
  type AbilityPack,
  type AbilityPackType,
  type ProfileAbilityMount,
  type SystemBehavior,
} from '../agents/ability-registry.js';
import {
  getSystemPromptSegments,
  type SystemPromptSegmentKey,
} from '../agents/session-append-templates.js';
import { getAllToolGroups, type ToolGroupInfo, type ToolInfo } from '../agents/tools/tool-registry.js';
import { loadSettings } from '../services/settings-service.js';
import { OPTIONAL_TOOL_PACKS } from '../services/tool-packs.js';
import { listSkillTemplates } from '../services/skill-template-service.js';
import { getWorkspaceConfig } from '../services/workspace-config-service.js';
import { getAll as getAllWorkspaces } from '../services/workspace-json-service.js';
import { isRetiredBuiltinTask, loadTasks } from '../services/scheduler/plan-store.js';

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

export interface AbilitySystemBehaviorView extends SystemBehavior {
  segment: AbilitySegmentMeta;
}

export interface WorkspaceMount {
  workspaceId: string;
  workspaceName: string;
  /** 工作区包开关：abilityOverrides[key] ?? defaultEnabled（不含触发条件，触发条件是运行时的） */
  enabled: boolean;
  /** 仅 skill 型包非空：包内已开细闸的 skill（enabledSkills ∩ pack.skills） */
  enabledSkills: string[];
  /** 仅 skill 型包非空：包内已开的工具包 name（enabledToolPacks ∩ pack.toolGroups） */
  enabledToolPacks: string[];
}

export type ProfileMount = ProfileAbilityMount;

export interface TaskMount {
  taskId: string;
  taskName: string;
  taskEnabled: boolean;
  /** toolPacksOverride 中属于本包的工具包 name（经 TOOL_PACK_TO_ABILITY 反查） */
  matchedToolPacks: string[];
}

/**
 * 工具组工具明细依赖各工具模块在 tool-registry 完成注册；
 * 只 import 包体系引用的模块（task 等不在包体系）。
 */
const PACK_TOOL_MODULE_IMPORTS = [
  () => import('../agents/tools/memory-tools.js'),
  () => import('../agents/tools/notes-tools.js'),
  () => import('../agents/tools/delegation-tools.js'),
  () => import('../agents/tools/group-tools.js'),
  () => import('../agents/tools/reference-tools.js'),
  () => import('../agents/tools/stock-tools.js'),
  () => import('../agents/tools/stock-analysis-tools.js'),
  () => import('../agents/tools/stock-announcement-tools.js'),
  () => import('../agents/tools/stock-picking-tools.js'),
  () => import('../agents/tools/article-tools.js'),
  () => import('../agents/tools/browser-tools.js'),
  () => import('../agents/tools/extension-tools.js'),
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
          description: templateByName.get(name)?.description,
          toolPacks: SKILL_PACK_MAP[name] ?? [],
        })),
      }));

      const systemBehaviors: AbilitySystemBehaviorView[] = SYSTEM_BEHAVIORS.map((b) => ({
        ...b,
        segment: segmentMetaOf(segmentMap, b.segmentKey),
      }));

      return { packs, systemBehaviors };
    } catch (error) {
      console.error('[ability] getAbilityPacks 失败:', error);
      return { error: String(error) };
    }
  }),

  /** 挂载情况反向索引（读时快照不订阅）：工作区包开关 ∩ Profile 细闸 ∩ 任务工具包覆盖 */
  getAbilityMounts: t.procedure
    .input<{ key: string }>()
    .action(async ({ input }) => {
      try {
        const pack = ABILITY_PACKS.find((p) => p.key === input.key);
        if (!pack) {
          return { error: `未知能力包: ${input.key}` };
        }

        const [workspaces, settings, tasks] = await Promise.all([
          getAllWorkspaces(),
          loadSettings(),
          loadTasks(),
        ]);

        const workspaceMounts: WorkspaceMount[] = [];
        for (const ws of workspaces) {
          const config = await getWorkspaceConfig(ws.id);
          workspaceMounts.push({
            workspaceId: ws.id,
            workspaceName: ws.name,
            enabled: config.abilityOverrides?.[pack.key] ?? pack.defaultEnabled,
            enabledSkills:
              pack.type === 'skill-packs'
                ? config.enabledSkills.filter((s) => pack.skills?.includes(s))
                : [],
            enabledToolPacks:
              pack.type === 'skill-packs'
                ? config.enabledToolPacks.filter((n) => pack.toolGroups?.includes(n))
                : [],
          });
        }

        const profileMounts = (settings.subAgent?.profiles ?? []).flatMap((profile) => {
          const mount = buildProfileAbilityMount(pack, profile);
          return mount ? [mount] : [];
        });

        const taskMounts: TaskMount[] = [];
        for (const task of tasks) {
          if (isRetiredBuiltinTask(task)) continue;
          const override = task.toolPacksOverride;
          // undefined = 跟随工作区配置，挂载情况已由 workspaces 组体现，不重复列
          if (!override) continue;
          const matched = override.filter((n) => TOOL_PACK_TO_ABILITY.get(n) === pack.key);
          if (matched.length === 0) continue;
          taskMounts.push({
            taskId: task.id,
            taskName: task.name,
            taskEnabled: task.enabled,
            matchedToolPacks: matched,
          });
        }

        const packSummary: { key: string; label: string; type: AbilityPackType } = {
          key: pack.key,
          label: pack.label,
          type: pack.type,
        };
        return {
          pack: packSummary,
          workspaces: workspaceMounts,
          profiles: profileMounts,
          tasks: taskMounts,
        };
      } catch (error) {
        console.error('[ability] getAbilityMounts 失败:', error);
        return { error: String(error) };
      }
    }),
};
