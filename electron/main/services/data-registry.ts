import path from 'node:path';
import { safeJsonRead } from './safe-json.js';
import { getConfigDir } from './settings-service.js';
import {
  BACKUP_CATEGORY_SCOPES,
  DATA_ITEMS,
  EXTERNAL_ANCHOR_PREFIX,
  WSID_TOKEN,
  type BackupCategoryKey,
  type DataItem,
} from './data-items.js';

/** 字典与纯派生的单一来源在 data-items.ts（无 node 依赖，settings-types/渲染层同构引用），此处 re-export 保既有导入点 */
export {
  BACKUP_CATEGORY_KEYS,
  BACKUP_CATEGORY_SCOPES,
  DATA_ITEMS,
  EXTERNAL_ANCHOR_PREFIX,
  registrySyncItems,
  sensitiveRelPaths,
  syncStatusOf,
  type BackupCategoryKey,
  type DataItem,
  type MergePolicy,
  type SyncStatus,
} from './data-items.js';

export const GLOBAL_SCOPE = 'global';

/** 'global' 或 workspaceId */
export type BackupScope = string;

const SCOPE_SEGMENT_RE = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

/** scope 必须是 'global' 或合法目录名单段（防路径穿越），与 backup-service 原校验同规则 */
export function assertRegistryScope(scope: BackupScope): void {
  if (scope === GLOBAL_SCOPE) return;
  if (!SCOPE_SEGMENT_RE.test(scope)) {
    throw new Error(`非法备份 scope: ${scope}`);
  }
}

export interface RegisteredWorkspace {
  id: string;
  path: string;
}

/** workspaces.json 注册工作区（id + 磁盘绝对路径）；configDir 缺省取应用配置目录（sync manifest 测试注入临时目录） */
export async function readRegisteredWorkspaces(configDir?: string): Promise<RegisteredWorkspace[]> {
  const file = await safeJsonRead<{ version?: number; workspaces?: Array<{ id?: unknown; path?: unknown }> } | null>(
    path.join(configDir ?? getConfigDir(), 'workspaces', 'workspaces.json'),
    null,
  );
  if (!file || !Array.isArray(file.workspaces)) return [];
  const seen = new Set<string>();
  const out: RegisteredWorkspace[] = [];
  for (const ws of file.workspaces) {
    if (!ws || typeof ws.id !== 'string' || ws.id === '' || typeof ws.path !== 'string' || ws.path === '') continue;
    if (seen.has(ws.id)) continue;
    seen.add(ws.id);
    out.push({ id: ws.id, path: ws.path });
  }
  return out;
}

/**
 * 分类×scope 的备份源绝对路径列表（不存在的路径由打包/恢复侧跳过；不适用的组合抛错）。
 * 全局条目默认只进 global scope；分类没有 global 去处时全局条目才并入每个 workspace zip。
 */
export async function backupSourcesFor(category: BackupCategoryKey, scope: BackupScope): Promise<string[]> {
  const scopes = BACKUP_CATEGORY_SCOPES[category];
  if (!scopes) throw new Error(`未知备份分类: ${category}`);
  assertRegistryScope(scope);
  const scopeType: 'workspace' | 'global' = scope === GLOBAL_SCOPE ? 'global' : 'workspace';
  if (!scopes.includes(scopeType)) {
    throw new Error(`备份分类 ${category} 不支持 ${scopeType} scope`);
  }
  const configDir = getConfigDir();
  const allItems: readonly DataItem[] = DATA_ITEMS;
  const items = allItems.filter((item) => item.backupCategory === category);
  const out: string[] = [];
  for (const item of items) {
    for (const rel of item.paths) {
      if (rel.includes(WSID_TOKEN)) {
        if (scopeType === 'workspace') out.push(path.join(configDir, rel.split(WSID_TOKEN).join(scope)));
        continue;
      }
      if (scopeType === 'global' || !scopes.includes('global')) out.push(path.join(configDir, rel));
    }
  }
  return out;
}

/** 注册工作区快照：wsid → 工作区磁盘绝对路径（多条虚拟路径反解时避免重复读注册表） */
export async function externalWorkspaceIndex(configDir: string): Promise<Map<string, string>> {
  return new Map((await readRegisteredWorkspaces(configDir)).map((w) => [w.id, w.path]));
}

/**
 * 同步虚拟路径反解：`__ws-external__/{wsid}/rest` → 注册工作区真实绝对路径。
 * 段安全校验（空段/./..//反斜杠拒绝）+ resolve 后必须仍在工作区根下（防穿越）。
 * wsid 未注册（对端清单含本端没有的工作区）→ null，调用方 skipped + 警告。
 */
export async function resolveExternalRelPath(
  configDir: string,
  relPath: string,
  index?: ReadonlyMap<string, string>,
): Promise<string | null> {
  const segs = relPath.split('/');
  if (segs[0] !== EXTERNAL_ANCHOR_PREFIX || segs.length < 3) return null;
  if (segs.some((s) => s === '' || s === '.' || s === '..' || s.includes('\\'))) return null;
  const wsPath = (index ?? (await externalWorkspaceIndex(configDir))).get(segs[1]);
  if (!wsPath) return null;
  const base = path.resolve(wsPath);
  const abs = path.resolve(base, ...segs.slice(2));
  return abs.startsWith(base + path.sep) ? abs : null;
}

/** 备份源绝对路径 → zip 内条目路径（相对 configDir，posix 分隔符） */
export function toArchiveRelPath(sourceAbsPath: string): string {
  return path.relative(getConfigDir(), sourceAbsPath).split(path.sep).join('/');
}

/**
 * zip 内条目路径 → 真实绝对路径。zip 条目是不可信输入：含空段/./.. 段或反斜杠一律拒绝。
 * 外部锚点条目按 workspaces.json 反解 workspace.path，工作区已注销/注册表不可读时返回 null（调用方跳过并警告）。
 */
export async function resolveArchiveRelPath(archiveRelPath: string): Promise<string | null> {
  const segs = archiveRelPath.split('/');
  if (segs.some((s) => s === '' || s === '.' || s === '..' || s.includes('\\'))) return null;
  if (segs[0] !== EXTERNAL_ANCHOR_PREFIX) return path.join(getConfigDir(), archiveRelPath);
  const wsid = segs[1];
  const rest = segs.slice(2);
  if (!wsid || rest.length === 0) return null;
  const registered = await readRegisteredWorkspaces();
  const ws = registered.find((w) => w.id === wsid);
  if (!ws) return null;
  return path.join(ws.path, ...rest);
}
