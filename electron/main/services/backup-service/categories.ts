import fs from 'fs/promises';
import path from 'path';
import { getConfigDir } from '../settings-service.js';

export const GLOBAL_SCOPE = 'global';

/** 'global' 或 workspaceId */
export type BackupScope = string;

export const BACKUP_CATEGORY_KEYS = ['notes-groups', 'memory', 'tasks', 'sessions'] as const;
export type BackupCategoryKey = (typeof BACKUP_CATEGORY_KEYS)[number];

export const BACKUP_FREQUENCIES = ['daily', 'weekly', 'monthly', 'manual'] as const;
export type BackupFrequency = (typeof BACKUP_FREQUENCIES)[number];

export interface BackupCategoryConfig {
  enabled: boolean;
  frequency: BackupFrequency;
  keep: number;
}

export type BackupConfig = Partial<Record<BackupCategoryKey, BackupCategoryConfig>>;

export interface CategoryDef {
  key: BackupCategoryKey;
  name: string;
  /** 该分类适用的 scope 类型：workspace 遍历所有工作区，global 单份 */
  scopes: Array<'workspace' | 'global'>;
  defaultConfig: BackupCategoryConfig;
}

export const BACKUP_CATEGORIES: CategoryDef[] = [
  { key: 'notes-groups', name: '笔记与话题组', scopes: ['workspace'], defaultConfig: { enabled: true, frequency: 'daily', keep: 10 } },
  { key: 'memory', name: '记忆', scopes: ['workspace', 'global'], defaultConfig: { enabled: true, frequency: 'daily', keep: 10 } },
  // tasks.json 实际是每工作区一份（<workspace>/.dogear/tasks.json），归 global scope 一份 zip 全装
  { key: 'tasks', name: '任务', scopes: ['global'], defaultConfig: { enabled: true, frequency: 'daily', keep: 10 } },
  { key: 'sessions', name: '会话', scopes: ['workspace'], defaultConfig: { enabled: true, frequency: 'monthly', keep: 10 } },
];

export function getCategoryDef(key: BackupCategoryKey): CategoryDef {
  const def = BACKUP_CATEGORIES.find((c) => c.key === key);
  if (!def) throw new Error(`未知备份分类: ${key}`);
  return def;
}

export function resolveCategoryConfig(def: CategoryDef, config?: BackupConfig): BackupCategoryConfig {
  return { ...def.defaultConfig, ...config?.[def.key] };
}

/** scope 必须是 'global' 或合法目录名单段（防路径穿越） */
export function assertScope(scope: BackupScope): void {
  if (scope === GLOBAL_SCOPE) return;
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(scope)) {
    throw new Error(`非法备份 scope: ${scope}`);
  }
}

export function isWorkspaceScope(scope: BackupScope): boolean {
  return scope !== GLOBAL_SCOPE;
}

export function workspaceRoot(scope: BackupScope): string {
  assertScope(scope);
  return path.join(getConfigDir(), 'workspaces', scope);
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

/**
 * 分类×scope 的源绝对路径列表（zip 内路径 = 相对 configDir 的相对路径）
 * 不适用的分类×scope 组合抛错；返回的路径可能不存在，由打包/恢复侧跳过
 */
export async function resolveSources(category: BackupCategoryKey, scope: BackupScope): Promise<string[]> {
  const def = getCategoryDef(category);
  const scopeType: 'workspace' | 'global' = isWorkspaceScope(scope) ? 'workspace' : 'global';
  if (!def.scopes.includes(scopeType)) {
    throw new Error(`分类 ${category} 不支持 ${scopeType} scope`);
  }
  switch (category) {
    case 'notes-groups': {
      const root = workspaceRoot(scope);
      return [path.join(root, 'notes'), path.join(root, 'groups'), path.join(root, 'dashboard.md')];
    }
    case 'memory': {
      return isWorkspaceScope(scope)
        ? [path.join(workspaceRoot(scope), 'memory')]
        : [path.join(getConfigDir(), 'memory')];
    }
    case 'tasks': {
      const ids = await listWorkspaceIds();
      return ids.map((id) => path.join(getConfigDir(), 'workspaces', id, '.dogear', 'tasks.json'));
    }
    case 'sessions': {
      return [path.join(workspaceRoot(scope), 'sessions')];
    }
  }
}
