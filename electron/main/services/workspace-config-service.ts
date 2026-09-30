import path from 'path';
import { app } from 'electron';
import { safeJsonRead, safeJsonWrite } from './safe-json.js';
import { PERSONAL_WORKSPACE_ID } from '../types.js';

export interface WorkspaceConfig {
  enabledToolPacks: string[];
  enabledSkills: string[];
  /** 只存显式拨过的能力包开关，缺省走注册表 defaultEnabled；残留下线 key 静默忽略 */
  abilityOverrides?: Record<string, boolean>;
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
    'web-mcp': true,
    'code-workflow': false,
  },
};

export async function getWorkspaceConfig(workspaceId: string): Promise<WorkspaceConfig> {
  const filePath = getWorkspaceConfigPath(workspaceId);
  const stored = await safeJsonRead<WorkspaceConfig>(filePath, getDefaultWorkspaceConfig());
  if (workspaceId !== PERSONAL_WORKSPACE_ID) return stored;
  return {
    enabledToolPacks: stored.enabledToolPacks.length > 0 ? stored.enabledToolPacks : PERSONAL_DEFAULT_CONFIG.enabledToolPacks,
    enabledSkills: stored.enabledSkills,
    abilityOverrides: { ...PERSONAL_DEFAULT_CONFIG.abilityOverrides, ...stored.abilityOverrides },
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
  };
  await safeJsonWrite(getWorkspaceConfigPath(workspaceId), merged);
  return merged;
}
