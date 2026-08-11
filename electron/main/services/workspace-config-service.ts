import path from 'path';
import { app } from 'electron';
import { safeJsonRead, safeJsonWrite } from './safe-json.js';

export interface WorkspaceConfig {
  enabledToolPacks: string[];
  enabledSkills: string[];
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
  };
  await safeJsonWrite(getWorkspaceConfigPath(workspaceId), merged);
  return merged;
}
