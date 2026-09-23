import { client } from '@/lib/client';
import type { BackupCategoryKey, BackupCategorySetting } from '@/types/settings';

export const BACKUP_CATEGORY_ORDER: BackupCategoryKey[] = ['notes-groups', 'memory', 'tasks', 'sessions'];

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
    name: '笔记与话题组',
    scopeSummary: '笔记卡片、话题组与仪表盘数据，每个工作区一份',
    defaultConfig: { enabled: true, frequency: 'daily', keep: 10 },
  },
  memory: {
    name: '记忆',
    scopeSummary: 'Agent 的长期记忆，工作区与全局各一份',
    defaultConfig: { enabled: true, frequency: 'daily', keep: 10 },
  },
  tasks: {
    name: '任务',
    scopeSummary: '全部工作区的计划任务列表，合并为一份',
    defaultConfig: { enabled: true, frequency: 'daily', keep: 10 },
  },
  sessions: {
    name: '会话',
    scopeSummary: '每个工作区的会话记录，体积大、备份耗时较长',
    defaultConfig: { enabled: true, frequency: 'monthly', keep: 10 },
  },
};

export type BackupScopeStatus = Extract<
  Awaited<ReturnType<typeof client.getBackupStatus>>,
  { status: unknown }
>['status'][number];

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
