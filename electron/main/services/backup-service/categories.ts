import fs from 'fs/promises';
import path from 'path';
import { getConfigDir } from '../settings-service.js';
import {
  assertRegistryScope,
  BACKUP_CATEGORY_KEYS,
  BACKUP_CATEGORY_SCOPES,
  GLOBAL_SCOPE,
  type BackupCategoryKey,
  type BackupScope,
} from '../data-registry.js';
import { BACKUP_CATEGORY_DEFAULTS, type BackupCategorySetting } from '../settings-types.js';

export { BACKUP_CATEGORY_KEYS, GLOBAL_SCOPE };
export type { BackupCategoryKey, BackupScope };

export const BACKUP_FREQUENCIES = ['daily', 'weekly', 'monthly', 'manual'] as const;
export type BackupFrequency = (typeof BACKUP_FREQUENCIES)[number];

export type BackupCategoryConfig = BackupCategorySetting;

export type BackupConfig = Partial<Record<BackupCategoryKey, BackupCategoryConfig>>;

export interface CategoryDef {
  key: BackupCategoryKey;
  name: string;
  /** 该分类适用的 scope 类型：workspace 遍历所有工作区，global 单份 */
  scopes: Array<'workspace' | 'global'>;
  defaultConfig: BackupCategoryConfig;
}

const CATEGORY_NAMES: Record<BackupCategoryKey, string> = {
  'notes-groups': '笔记与工作区',
  memory: '记忆',
  tasks: '任务',
  sessions: '会话',
  'app-config': '应用配置',
};

export const BACKUP_CATEGORIES: CategoryDef[] = BACKUP_CATEGORY_KEYS.map((key) => ({
  key,
  name: CATEGORY_NAMES[key],
  scopes: [...BACKUP_CATEGORY_SCOPES[key]],
  defaultConfig: BACKUP_CATEGORY_DEFAULTS[key],
}));

export function getCategoryDef(key: BackupCategoryKey): CategoryDef {
  const def = BACKUP_CATEGORIES.find((c) => c.key === key);
  if (!def) throw new Error(`未知备份分类: ${key}`);
  return def;
}

export function resolveCategoryConfig(def: CategoryDef, config?: BackupConfig): BackupCategoryConfig {
  return { ...def.defaultConfig, ...config?.[def.key] };
}

export function assertScope(scope: BackupScope): void {
  assertRegistryScope(scope);
}

export function isWorkspaceScope(scope: BackupScope): boolean {
  return scope !== GLOBAL_SCOPE;
}

export async function listWorkspaceIds(): Promise<string[]> {
  const dir = path.join(getConfigDir(), 'workspaces');
  try {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    return entries.filter((e) => e.isDirectory()).map((e) => e.name);
  } catch {
    return [];
  }
}
