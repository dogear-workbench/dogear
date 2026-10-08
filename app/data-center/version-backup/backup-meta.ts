import { BACKUP_CATEGORY_DEFAULTS } from '@/electron/main/services/settings-types';
import { client } from '@/lib/client';
import type { BackupCategoryKey, BackupCategorySetting } from '@/types/settings';

export const BACKUP_CATEGORY_ORDER: BackupCategoryKey[] = [
  'notes-groups',
  'memory',
  'tasks',
  'sessions',
  'app-config',
];

export const FREQUENCY_LABELS: Record<BackupCategorySetting['frequency'], string> = {
  daily: '每天',
  weekly: '每周',
  monthly: '每月',
  manual: '手动',
};

export const FREQUENCY_OPTIONS = Object.keys(FREQUENCY_LABELS) as BackupCategorySetting['frequency'][];

interface CategoryMeta {
  name: string;
  scopeSummary: string;
  defaultConfig: BackupCategorySetting;
}

export const CATEGORY_META: Record<BackupCategoryKey, CategoryMeta> = {
  'notes-groups': {
    name: '笔记与工作区',
    scopeSummary: '笔记卡片、话题组与工作区配置，每个工作区一份',
    defaultConfig: BACKUP_CATEGORY_DEFAULTS['notes-groups'],
  },
  memory: {
    name: '记忆',
    scopeSummary: 'Agent 的长期记忆，工作区与全局各一份',
    defaultConfig: BACKUP_CATEGORY_DEFAULTS.memory,
  },
  tasks: {
    name: '任务',
    scopeSummary: '全部工作区的任务数据（存于工作区磁盘），合并为一份',
    defaultConfig: BACKUP_CATEGORY_DEFAULTS.tasks,
  },
  sessions: {
    name: '会话',
    scopeSummary: '各工作区与全局的会话记录，体积大、备份耗时较长',
    defaultConfig: BACKUP_CATEGORY_DEFAULTS.sessions,
  },
  'app-config': {
    name: '应用配置',
    scopeSummary: '应用设置、任务计划、通知记录、工作区注册表等全局文件，仅一份',
    defaultConfig: BACKUP_CATEGORY_DEFAULTS['app-config'],
  },
};

export type BackupScopeStatus = Extract<
  Awaited<ReturnType<typeof client.getBackupStatus>>,
  { status: unknown }
>['status'][number];

export type BackupSchedulerStatus = Extract<
  Awaited<ReturnType<typeof client.getBackupStatus>>,
  { status: unknown }
>['scheduler'];

export type BackupRunItem = Extract<
  Awaited<ReturnType<typeof client.runBackup>>,
  { results: unknown }
>['results'][number];

export type BackupEntry = Extract<
  Awaited<ReturnType<typeof client.listBackups>>,
  { backups: unknown }
>['backups'][number];

export type WorkspaceGitSummary = Extract<
  Awaited<ReturnType<typeof client.getWorkspaceGitSummary>>,
  { userRepo: unknown }
>;

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

export function formatTime(iso: string | null | undefined): string {
  if (!iso) return '从未备份';
  return new Date(iso).toLocaleString([], {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function formatListTime(iso: string): string {
  return new Date(iso).toLocaleString([], {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}
