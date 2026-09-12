import path from 'path';
import { app } from 'electron';
import { safeJsonRead, safeJsonWrite } from './safe-json.js';

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

export async function getWorkspaceConfig(workspaceId: string): Promise<WorkspaceConfig> {
  const filePath = getWorkspaceConfigPath(workspaceId);
  return safeJsonRead<WorkspaceConfig>(filePath, getDefaultWorkspaceConfig());
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
