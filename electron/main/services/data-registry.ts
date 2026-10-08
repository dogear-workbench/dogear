import path from 'node:path';
import { safeJsonRead } from './safe-json.js';
import { getConfigDir } from './settings-service.js';

export const GLOBAL_SCOPE = 'global';

/** 'global' 或 workspaceId */
export type BackupScope = string;

export const BACKUP_CATEGORY_KEYS = ['notes-groups', 'memory', 'tasks', 'sessions', 'app-config'] as const;
export type BackupCategoryKey = (typeof BACKUP_CATEGORY_KEYS)[number];

export type MergePolicy = 'file' | 'records' | 'settings-fields';

/** 备份分类适用的 scope 类型（backup-service 分类定义从这里消费，不得另写一份） */
export const BACKUP_CATEGORY_SCOPES: Record<BackupCategoryKey, ReadonlyArray<'workspace' | 'global'>> = {
  'notes-groups': ['workspace'],
  memory: ['workspace', 'global'],
  tasks: ['global'],
  sessions: ['workspace', 'global'],
  'app-config': ['global'],
};

export interface DataItem {
  id: string;
  /**
   * 相对 configDir 的 posix 路径；per-workspace 条目用 {wsid} 占位；
   * configDir 外文件用 __ws-external__/{wsid}/ 虚拟前缀（真实位置经 workspaces.json 反解）
   */
  paths: string[];
  /** 声明 configDir 外文件，派生时按 workspaces.json 动态展开 */
  external?: 'workspace-tasks' | 'workspace-articles';
  /** 含凭据/密钥，同步范围与导出场景须排除或特殊处理 */
  sensitive?: boolean;
  mergePolicy: MergePolicy;
  backupCategory?: BackupCategoryKey;
  /** 同步范围项 id（= 顶层 relPath），settings-types SYNC_ITEM_IDS 由此派生 */
  syncItemId?: string;
}

const WSID_TOKEN = '{wsid}';

export const EXTERNAL_ANCHOR_PREFIX = '__ws-external__';

export const EXTERNAL_TASKS_REL = '.dogear/tasks.json';
export const EXTERNAL_ARTICLES_REL = '.dogear/articles';

export const DATA_ITEMS: readonly DataItem[] = [
  { id: 'ws-notes', paths: ['workspaces/{wsid}/notes'], mergePolicy: 'file', backupCategory: 'notes-groups', syncItemId: 'workspaces' },
  { id: 'ws-groups', paths: ['workspaces/{wsid}/groups'], mergePolicy: 'file', backupCategory: 'notes-groups', syncItemId: 'workspaces' },
  { id: 'ws-groups-index', paths: ['workspaces/{wsid}/groups.json'], mergePolicy: 'records', backupCategory: 'notes-groups', syncItemId: 'workspaces' },
  { id: 'ws-conversations-index', paths: ['workspaces/{wsid}/conversations.json'], mergePolicy: 'records', backupCategory: 'notes-groups', syncItemId: 'workspaces' },
  { id: 'ws-config', paths: ['workspaces/{wsid}/config.json'], mergePolicy: 'file', backupCategory: 'notes-groups', syncItemId: 'workspaces' },
  { id: 'ws-agent-md', paths: ['workspaces/{wsid}/agent.md'], mergePolicy: 'file', backupCategory: 'notes-groups', syncItemId: 'workspaces' },
  { id: 'ws-memory', paths: ['workspaces/{wsid}/memory'], mergePolicy: 'file', backupCategory: 'memory', syncItemId: 'workspaces' },
  { id: 'ws-sessions', paths: ['workspaces/{wsid}/sessions'], mergePolicy: 'file', backupCategory: 'sessions', syncItemId: 'workspaces' },
  { id: 'ws-tasks', paths: [`${EXTERNAL_ANCHOR_PREFIX}/{wsid}/${EXTERNAL_TASKS_REL}`], external: 'workspace-tasks', mergePolicy: 'file', backupCategory: 'tasks', syncItemId: 'tasks' },
  { id: 'ws-articles', paths: [`${EXTERNAL_ANCHOR_PREFIX}/{wsid}/${EXTERNAL_ARTICLES_REL}`], external: 'workspace-articles', mergePolicy: 'file', syncItemId: 'articles' },
  { id: 'memory', paths: ['memory'], mergePolicy: 'file', backupCategory: 'memory', syncItemId: 'memory' },
  { id: 'conversations', paths: ['conversations'], mergePolicy: 'file', backupCategory: 'sessions', syncItemId: 'conversations' },
  { id: 'workspaces-registry', paths: ['workspaces/workspaces.json'], mergePolicy: 'records', backupCategory: 'app-config', syncItemId: 'workspaces' },
  { id: 'agent-md', paths: ['agent.md'], mergePolicy: 'file', backupCategory: 'app-config', syncItemId: 'agent.md' },
  { id: 'settings', paths: ['settings.json'], mergePolicy: 'settings-fields', backupCategory: 'app-config', syncItemId: 'settings.json' },
  { id: 'plans', paths: ['plans.json'], mergePolicy: 'records', backupCategory: 'app-config', syncItemId: 'plans.json' },
  { id: 'notifications', paths: ['notifications.json'], mergePolicy: 'records', backupCategory: 'app-config', syncItemId: 'notifications.json' },
  { id: 'login-accounts', paths: ['login-accounts.json'], sensitive: true, mergePolicy: 'file', backupCategory: 'app-config' },
  { id: 'usage', paths: ['usage'], mergePolicy: 'file', syncItemId: 'usage' },
  { id: 'article-parser', paths: ['article-parser'], mergePolicy: 'file', syncItemId: 'article-parser' },
  { id: 'site-knowledge', paths: ['site-knowledge'], mergePolicy: 'file', syncItemId: 'site-knowledge' },
  { id: 'run-history', paths: ['run-history'], mergePolicy: 'file', syncItemId: 'run-history' },
  { id: 'stocks', paths: ['stocks'], mergePolicy: 'file', syncItemId: 'stocks' },
  { id: 'feishu', paths: ['feishu'], mergePolicy: 'file', syncItemId: 'feishu' },
];

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
  const items = DATA_ITEMS.filter((item) => item.backupCategory === category);
  const out: string[] = [];
  for (const item of items) {
    if (item.external === 'workspace-tasks') {
      if (scopeType === 'global') {
        const registered = await readRegisteredWorkspaces();
        for (const ws of registered) {
          out.push(path.join(configDir, EXTERNAL_ANCHOR_PREFIX, ws.id, EXTERNAL_TASKS_REL));
        }
      }
      continue;
    }
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

/** 同步范围条目（每项 syncItemId 即同步项 id），settings-types / sync manifest 由此派生 */
export function registrySyncItems(): readonly DataItem[] {
  return DATA_ITEMS.filter((item) => item.syncItemId !== undefined);
}

export function sensitiveRelPaths(): string[] {
  return DATA_ITEMS.filter((item) => item.sensitive === true).flatMap((item) => item.paths);
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
