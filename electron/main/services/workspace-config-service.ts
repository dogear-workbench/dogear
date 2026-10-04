import path from 'path';
import { app } from 'electron';
import { safeJsonRead, safeJsonWrite } from './safe-json.js';
import { PERSONAL_WORKSPACE_ID } from '../types.js';
import type { SceneOverrideKey } from '../agents/ability-registry.js';

export interface WorkspaceConfig {
  enabledToolPacks: string[];
  enabledSkills: string[];
  /** 只存显式拨过的能力包开关，缺省走注册表 defaultEnabled；残留下线 key 静默忽略 */
  abilityOverrides?: Record<string, boolean>;
  /** 场景固定层覆盖（缺失键=跟随工作区总闸），场景包开关三级回退的第一级；残留下线 key 消费侧忽略 */
  sceneOverrides?: { sub?: Record<string, boolean>; executor?: Record<string, boolean>; scheduler?: Record<string, boolean> };
}

function normalizeBooleanMap(value: unknown): Record<string, boolean> {
  if (!value || typeof value !== 'object') return {};
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).filter(
      (entry): entry is [string, boolean] => typeof entry[1] === 'boolean',
    ),
  );
}

function normalizeSceneOverrides(value: unknown): WorkspaceConfig['sceneOverrides'] {
  if (!value || typeof value !== 'object') return undefined;
  const result: NonNullable<WorkspaceConfig['sceneOverrides']> = {};
  for (const [scene, packs] of Object.entries(value as Record<string, unknown>)) {
    const filtered = normalizeBooleanMap(packs);
    if (Object.keys(filtered).length > 0) result[scene as SceneOverrideKey] = filtered;
  }
  return Object.keys(result).length > 0 ? result : undefined;
}

function getConfigDir(): string {
  if (process.env.DOGEAR_CONFIG_DIR) return process.env.DOGEAR_CONFIG_DIR;
  if (app?.isPackaged) return path.join(app.getPath('userData'), '.dogear');
  return path.join(process.cwd(), '.dogear');
}

function getWorkspaceConfigPath(workspaceId: string): string {
  return path.join(getConfigDir(), 'workspaces', workspaceId, 'config.json');
}

export function getDefaultWorkspaceConfig(): WorkspaceConfig {
  return { enabledToolPacks: [], enabledSkills: [] };
}

/**
 * personal 临时会话的最小能力包默认集：显式关掉全部项目上下文/协作类包，只保留联网搜索。
 * 经 stored.abilityOverrides 可逐包覆盖（数据驱动，resolveAbilities 无需感知 personal）。
 */
const PERSONAL_DEFAULT_CONFIG: WorkspaceConfig = {
  enabledToolPacks: ['web-mcp'],
  enabledSkills: [],
  abilityOverrides: {
    'workspace-rules': false,
    'global-rules': false,
    'memory': false,
    'notes': false,
    'group-context': false,
    'agent-collab': false,
    'stock': false,
    'article': false,
    'browser': false,
    'browser-extension': false,
    'browser-methodology': false,
    'web-mcp': true,
    'code-workflow': false,
  },
};

/** 拆包迁移：browser 开启的开关层把扩展/方法论两包补齐为开启（缺键才写，显式 false 不覆盖），内存态生效，UI 下次写回自然落盘 */
function migrateBrowserPackSplit(overrides: Record<string, boolean> | undefined): Record<string, boolean> | undefined {
  if (!overrides || overrides.browser !== true) return overrides;
  if ('browser-extension' in overrides && 'browser-methodology' in overrides) return overrides;
  return {
    ...overrides,
    'browser-extension': overrides['browser-extension'] ?? true,
    'browser-methodology': overrides['browser-methodology'] ?? true,
  };
}

function migrateWorkspaceConfig(stored: WorkspaceConfig): WorkspaceConfig {
  const abilityOverrides = migrateBrowserPackSplit(stored.abilityOverrides);
  const scene = stored.sceneOverrides;
  const sceneOverrides = scene
    ? {
        sub: migrateBrowserPackSplit(scene.sub),
        executor: migrateBrowserPackSplit(scene.executor),
        scheduler: migrateBrowserPackSplit(scene.scheduler),
      }
    : undefined;
  if (abilityOverrides === stored.abilityOverrides && sceneOverrides === stored.sceneOverrides) return stored;
  return { ...stored, abilityOverrides, sceneOverrides };
}

export async function getWorkspaceConfig(workspaceId: string): Promise<WorkspaceConfig> {
  const filePath = getWorkspaceConfigPath(workspaceId);
  const raw = await safeJsonRead<WorkspaceConfig>(filePath, getDefaultWorkspaceConfig());
  const stored = migrateWorkspaceConfig(raw);
  const sceneOverrides = normalizeSceneOverrides(stored.sceneOverrides);
  if (workspaceId !== PERSONAL_WORKSPACE_ID) {
    return sceneOverrides ? { ...stored, sceneOverrides } : stored;
  }
  return {
    enabledToolPacks: stored.enabledToolPacks.length > 0 ? stored.enabledToolPacks : PERSONAL_DEFAULT_CONFIG.enabledToolPacks,
    enabledSkills: stored.enabledSkills,
    abilityOverrides: { ...PERSONAL_DEFAULT_CONFIG.abilityOverrides, ...stored.abilityOverrides },
    sceneOverrides,
  };
}

export async function updateWorkspaceConfig(
  workspaceId: string,
  partial: Partial<WorkspaceConfig>,
): Promise<WorkspaceConfig> {
  const current = await getWorkspaceConfig(workspaceId);
  const merged: WorkspaceConfig = {
    enabledToolPacks: partial.enabledToolPacks ?? current.enabledToolPacks,
    enabledSkills: partial.enabledSkills ?? current.enabledSkills,
    abilityOverrides: partial.abilityOverrides ?? current.abilityOverrides,
    sceneOverrides: normalizeSceneOverrides(partial.sceneOverrides ?? current.sceneOverrides),
  };
  await safeJsonWrite(getWorkspaceConfigPath(workspaceId), merged);
  return merged;
}
