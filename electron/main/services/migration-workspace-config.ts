import path from 'node:path';
import fs from 'node:fs/promises';
import * as workspaceService from './workspace-json-service.js';
import { getWorkspaceConfig, updateWorkspaceConfig, getDefaultWorkspaceConfig } from './workspace-config-service.js';
import { getConfigDir } from './settings-service.js';
import { mainLogger } from '../agents/logger.js';
import { safeJsonRead, safeJsonWrite } from './safe-json.js';

async function readRawSettings(): Promise<Record<string, any>> {
  const settingsPath = path.join(getConfigDir(), 'settings.json');
  return safeJsonRead<Record<string, any>>(settingsPath, {});
}

async function writeMigrationMarker(): Promise<void> {
  const settingsPath = path.join(getConfigDir(), 'settings.json');
  const raw = await safeJsonRead<Record<string, any>>(settingsPath, {});
  if (!raw.migrated) raw.migrated = {};
  raw.migrated.workspaceConfig = true;
  await safeJsonWrite(settingsPath, raw);
}

async function scanEnabledClaudeSkills(workspacePath: string): Promise<string[]> {
  const skillsDir = path.join(workspacePath, '.claude', 'skills');
  let entries: string[];
  try {
    entries = await fs.readdir(skillsDir);
  } catch {
    return [];
  }

  const enabled: string[] = [];
  for (const name of entries) {
    const dir = path.join(skillsDir, name);
    let stat;
    try {
      stat = await fs.stat(dir);
    } catch {
      continue;
    }
    if (!stat.isDirectory()) continue;

    try {
      await fs.access(path.join(dir, 'SKILL.md'));
      enabled.push(name);
    } catch {
      // SKILL.md 不存在（可能是 SKILL.md.disabled），视为未启用
    }
  }
  return enabled;
}

export async function migrateWorkspaceConfig(): Promise<void> {
  const rawSettings = await readRawSettings();
  if (rawSettings.migrated?.workspaceConfig === true) {
    mainLogger.info('[migration-workspace-config] 已迁移过，跳过');
    return;
  }

  mainLogger.info('[migration-workspace-config] 开始迁移');

  const enabledToolPacks: string[] = Array.isArray(rawSettings.enabledToolPacks)
    ? rawSettings.enabledToolPacks
    : [];

  const workspaces = await workspaceService.getAll();

  for (const ws of workspaces) {
    try {
      const existing = await getWorkspaceConfig(ws.id);
      const enabledSkills = await scanEnabledClaudeSkills(ws.path);

      await updateWorkspaceConfig(ws.id, {
        enabledToolPacks: existing.enabledToolPacks.length > 0
          ? existing.enabledToolPacks
          : enabledToolPacks,
        enabledSkills: existing.enabledSkills.length > 0
          ? existing.enabledSkills
          : enabledSkills,
      });

      mainLogger.info(
        `[migration-workspace-config] ws=${ws.id.slice(0, 8)} ` +
        `toolPacks=${enabledToolPacks.length} skills=${enabledSkills.length}`,
      );
    } catch (err) {
      mainLogger.warn(`[migration-workspace-config] 工作区 ${ws.id} 迁移失败:`, err);
    }
  }

  await writeMigrationMarker();
  mainLogger.info('[migration-workspace-config] 迁移完成');
}
