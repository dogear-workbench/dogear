/**
 * 数据字典单一来源（DATA_ITEMS）：id / 路径模式 / 名称 / 说明 / 同步状态 / 敏感标记全部挂条目上，
 * 展示层（SYNC_ITEM_IDS / GROUP_LABELS / 同步页数据明细区）只派生不自持。
 * 本文件无 node / electron 依赖，主进程、Worker 线程、渲染层均可安全导入。
 */

export type MergePolicy = 'file' | 'records' | 'settings-fields';

export const BACKUP_CATEGORY_KEYS = ['notes-groups', 'memory', 'tasks', 'sessions', 'app-config'] as const;
export type BackupCategoryKey = (typeof BACKUP_CATEGORY_KEYS)[number];

/** 备份分类适用的 scope 类型（backup-service 分类定义从这里消费，不得另写一份） */
export const BACKUP_CATEGORY_SCOPES: Record<BackupCategoryKey, ReadonlyArray<'workspace' | 'global'>> = {
  'notes-groups': ['workspace'],
  memory: ['workspace', 'global'],
  tasks: ['workspace'],
  sessions: ['workspace'],
  'app-config': ['global'],
};

export interface DataItem {
  id: string;
  /** 展示名（同步范围开关 / 数据说明区共用） */
  name: string;
  /** 展示说明文案 */
  description: string;
  /**
   * 相对 configDir 的 posix 路径；per-workspace 条目用 {wsid} 占位；
   * configDir 外文件（userSyncPaths 勾选子树）用 __ws-external__/{wsid}/ 虚拟前缀，仅同步引擎使用
   */
  paths: readonly string[];
  /** 含凭据/密钥，同步范围与导出场景须排除或特殊处理 */
  sensitive?: boolean;
  mergePolicy: MergePolicy;
  backupCategory?: BackupCategoryKey;
  /** 同步范围项 id（= 顶层 relPath），settings-types SYNC_ITEM_IDS 由此派生 */
  syncItemId?: string;
  /** 同步范围开关的组级展示名：多个条目共享 syncItemId 时由组代表条目（字典首个）覆盖，缺省用 name */
  syncName?: string;
  /** 同步范围开关的组级说明文案，缺省用 description */
  syncDescription?: string;
  /** 同步必选项（如 settings.json）：UI 置灰不可关闭 */
  syncRequired?: true;
  /** 「不同步」只读清单不展示（已有专项开关的条目） */
  localListHidden?: true;
}

export const WSID_TOKEN = '{wsid}';

export const EXTERNAL_ANCHOR_PREFIX = '__ws-external__';

/** 同步状态：required=必选不可关；optional=挂同步范围开关；never=不跨设备；always=恒同步无开关（当前无条目） */
export type SyncStatus = 'always' | 'optional' | 'required' | 'never';

export function syncStatusOf(item: DataItem): SyncStatus {
  if (!item.syncItemId) return 'never';
  if (item.syncRequired === true) return 'required';
  return 'optional';
}

export const DATA_ITEMS = [
  { id: 'ws-notes', name: '笔记库', description: '工作区的笔记与文档内容', syncName: '工作区数据', syncDescription: '工作区笔记、文档、会话与规则文件（工作区 agent.md）', paths: ['workspaces/{wsid}/notes'], mergePolicy: 'file', backupCategory: 'notes-groups', syncItemId: 'workspaces' },
  { id: 'ws-groups', name: '话题', description: '工作区话题组数据', paths: ['workspaces/{wsid}/groups'], mergePolicy: 'file', backupCategory: 'notes-groups', syncItemId: 'workspaces' },
  { id: 'ws-groups-index', name: '话题索引', description: '话题组结构与顺序索引（groups.json）', paths: ['workspaces/{wsid}/groups.json'], mergePolicy: 'records', backupCategory: 'notes-groups', syncItemId: 'workspaces' },
  { id: 'ws-conversations-index', name: '会话索引', description: '会话列表索引（标题、时间等元信息）', paths: ['workspaces/{wsid}/conversations.json'], mergePolicy: 'records', backupCategory: 'notes-groups', syncItemId: 'workspaces' },
  { id: 'ws-config', name: '工作区配置', description: '工作区级设置与偏好（config.json）', paths: ['workspaces/{wsid}/config.json'], mergePolicy: 'file', backupCategory: 'notes-groups', syncItemId: 'workspaces' },
  { id: 'ws-agent-md', name: '工作区规则', description: '工作区规则文件（agent.md），注入该工作区的会话', paths: ['workspaces/{wsid}/agent.md'], mergePolicy: 'file', backupCategory: 'notes-groups', syncItemId: 'workspaces' },
  { id: 'ws-memory', name: '工作区记忆', description: '工作区级跨会话记忆', syncName: '记忆库', syncDescription: '跨会话记忆数据（全局 + 各工作区两级）', paths: ['workspaces/{wsid}/memory'], mergePolicy: 'file', backupCategory: 'memory', syncItemId: 'workspaces' },
  { id: 'ws-sessions', name: '会话记录', description: '会话正文记录（sessions/ 下 jsonl）', paths: ['workspaces/{wsid}/sessions'], mergePolicy: 'file', backupCategory: 'sessions', syncItemId: 'workspaces' },
  { id: 'ws-tasks', name: '任务', description: '工作区任务数据（tasks.json）', paths: ['workspaces/{wsid}/tasks.json'], mergePolicy: 'file', backupCategory: 'tasks', syncItemId: 'tasks' },
  { id: 'memory', name: '记忆库', description: '跨会话记忆数据；含跨工作区共享的全局记忆（scope=global），与各工作区记忆两级并存', paths: ['memory'], mergePolicy: 'file', backupCategory: 'memory', syncItemId: 'memory' },
  { id: 'custom', name: '自定义资源', description: '自定义技能、提示词模板与扩展脚本副本', paths: ['custom'], mergePolicy: 'file', syncItemId: 'custom' },
  { id: 'workspaces-registry', name: '工作区注册表', description: '工作区列表与磁盘路径映射（workspaces.json）', paths: ['workspaces/workspaces.json'], mergePolicy: 'records', backupCategory: 'app-config', syncItemId: 'workspaces' },
  { id: 'agent-md', name: '规则文件', description: '用户级全局规则（agent.md），注入每个会话', paths: ['agent.md'], mergePolicy: 'file', backupCategory: 'app-config', syncItemId: 'agent.md' },
  { id: 'preferences', name: '用户偏好', description: '用户偏好（preferences.md），沉淀稳定工作方式偏好，注入每个会话', paths: ['preferences.md'], mergePolicy: 'file', backupCategory: 'app-config', syncItemId: 'preferences.md' },
  { id: 'settings', name: '应用设置', description: '全局设置（含同步配置本身，必选）', paths: ['settings.json'], mergePolicy: 'settings-fields', backupCategory: 'app-config', syncItemId: 'settings.json', syncRequired: true },
  { id: 'plans', name: '定时任务', description: '定时任务定义（plans.json）', paths: ['plans.json'], mergePolicy: 'records', backupCategory: 'app-config', syncItemId: 'plans.json' },
  { id: 'notifications', name: '通知记录', description: '通知历史', paths: ['notifications.json'], mergePolicy: 'records', backupCategory: 'app-config', syncItemId: 'notifications.json' },
  { id: 'usage', name: '使用统计', description: '模型用量与使用统计', paths: ['usage'], mergePolicy: 'file', syncItemId: 'usage' },
  { id: 'article-parser', name: '文章解析', description: '文章解析规则、平台脚本与解析历史', paths: ['article-parser'], mergePolicy: 'file', backupCategory: 'app-config', syncItemId: 'article-parser' },
  { id: 'site-knowledge', name: '站点经验', description: 'agent 浏览器操作沉淀的站点经验数据', paths: ['site-knowledge'], mergePolicy: 'file', backupCategory: 'app-config', syncItemId: 'site-knowledge' },
  { id: 'run-history', name: '执行历史', description: '定时任务执行记录数据', paths: ['run-history'], mergePolicy: 'file', syncItemId: 'run-history' },
  { id: 'stocks', name: '行情数据', description: '行情缓存较大且可重新拉取；自选股配置始终同步', paths: ['stocks'], mergePolicy: 'file', syncItemId: 'stocks' },
  { id: 'feishu', name: '飞书数据', description: '飞书相关缓存数据', paths: ['feishu'], mergePolicy: 'file', syncItemId: 'feishu' },
  { id: 'sync-state', name: '同步状态', description: '设备配对与同步基线，仅存本机', paths: ['sync-state.json'], sensitive: true, mergePolicy: 'file' },
  { id: 'window-state', name: '窗口状态', description: '窗口位置与大小记忆，仅存本机', paths: ['window-state.json'], mergePolicy: 'file' },
  { id: 'backups', name: '版本备份', description: '本机版本备份产物', paths: ['backups'], mergePolicy: 'file' },
  { id: 'logs', name: '运行日志', description: '应用运行日志', paths: ['logs'], mergePolicy: 'file' },
  { id: 'ws-shadow-git', name: '影子快照', description: '工作区文件历史的本机 git 安全网仓库', localListHidden: true, paths: ['workspaces/{wsid}/shadow-git'], mergePolicy: 'file' },
] as const satisfies readonly DataItem[];

export type DataItemId = (typeof DATA_ITEMS)[number]['id'];

/** 同步范围条目（每项 syncItemId 即同步项 id），settings-types / sync manifest 由此派生 */
export function registrySyncItems(): readonly DataItem[] {
  const items: readonly DataItem[] = DATA_ITEMS;
  return items.filter((item) => item.syncItemId !== undefined);
}

export function sensitiveRelPaths(): string[] {
  const items: readonly DataItem[] = DATA_ITEMS;
  return items.filter((item) => item.sensitive === true).flatMap((item) => [...item.paths]);
}

export interface SyncItemMetaLike {
  id: string;
  name: string;
  description: string;
  required?: boolean;
}

/** 同步范围项元数据派生（settings-types SYNC_ITEM_IDS 的数据源）：按字典顺序去重取首个 */
export function syncItemMetas(): SyncItemMetaLike[] {
  const out: SyncItemMetaLike[] = [];
  const seen = new Set<string>();
  const items: readonly DataItem[] = DATA_ITEMS;
  for (const item of items) {
    if (!item.syncItemId || seen.has(item.syncItemId)) continue;
    seen.add(item.syncItemId);
    out.push({
      id: item.syncItemId,
      name: item.syncName ?? item.name,
      description: item.syncDescription ?? item.description,
      ...(item.syncRequired === true ? { required: true as const } : {}),
    });
  }
  return out;
}


