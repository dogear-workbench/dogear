import path from 'path';
import { app } from 'electron';
import { safeJsonRead, safeJsonWrite } from './safe-json.js';
import { ABILITY_PACKS } from '../agents/ability-registry.js';
import { OPTIONAL_TOOL_PACKS } from './tool-packs.js';
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

/** 拆包迁移：存量 browser 开启的开关层把扩展包补齐为开启（缺键才写，显式 false 不覆盖）；browser/methodology 键已下线由注册表静默忽略 */
function migrateBrowserPackSplit(overrides: Record<string, boolean> | undefined): Record<string, boolean> | undefined {
  if (!overrides || overrides.browser !== true) return overrides;
  if ('browser-extension' in overrides) return overrides;
  return {
    ...overrides,
    'browser-extension': true,
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

/**
 * skill 型包默认开启时的子开关视图回填：子开关列表（enabledToolPacks/enabledSkills）只在用户显式拨动时写入，
 * 包默认值翻转后未拨过的工作区列表里没有成员会挡住挂载；无显式 override 时按注册表默认补齐视图（不落盘），
 * 用户显式拨过（有 override）则列表即真值。只补可选工具包 name，常驻 server 名不入此列表。
 */
function withDefaultOnPackSubSwitches(config: WorkspaceConfig): WorkspaceConfig {
  let toolPacks = config.enabledToolPacks;
  let skills = config.enabledSkills;
  for (const pack of ABILITY_PACKS) {
    if (pack.type !== 'skill-packs' || !pack.defaultEnabled) continue;
    if (config.abilityOverrides?.[pack.key] !== undefined) continue;
    const optionalPackNames = (pack.toolGroups ?? []).filter((id) =>
      OPTIONAL_TOOL_PACKS.some((p) => p.name === id)
    );
    const missingPacks = optionalPackNames.filter((n) => !toolPacks.includes(n));
    if (missingPacks.length > 0) toolPacks = [...toolPacks, ...missingPacks];
    const missingSkills = (pack.skills ?? []).filter((s) => !skills.includes(s));
    if (missingSkills.length > 0) skills = [...skills, ...missingSkills];
  }
  return toolPacks === config.enabledToolPacks && skills === config.enabledSkills
    ? config
    : { ...config, enabledToolPacks: toolPacks, enabledSkills: skills };
}

export async function getWorkspaceConfig(workspaceId: string): Promise<WorkspaceConfig> {
  const filePath = getWorkspaceConfigPath(workspaceId);
  const raw = await safeJsonRead<WorkspaceConfig>(filePath, getDefaultWorkspaceConfig());
  const stored = migrateWorkspaceConfig(raw);
  const sceneOverrides = normalizeSceneOverrides(stored.sceneOverrides);
  const effective = sceneOverrides ? { ...stored, sceneOverrides } : stored;
  return withDefaultOnPackSubSwitches(effective);
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
