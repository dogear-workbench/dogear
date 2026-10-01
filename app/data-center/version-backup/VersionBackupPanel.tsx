import { useCallback, useEffect, useMemo, useState } from 'react';
import { CircleAlert, FolderOpen, HardDriveDownload, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { client } from '@/lib/client';
import { useSettingsStore } from '@/stores/settings-store';
import { useVisiblePolling } from '@/hooks/use-visible-polling';
import type { Workspace } from '@/types/electron-api';
import type { BackupCategoryKey, BackupCategorySetting } from '@/types/settings';
import {
  BACKUP_CATEGORY_ORDER,
  CATEGORY_META,
  formatBytes,
  type BackupRunItem,
  type BackupSchedulerStatus,
  type BackupScopeStatus,
} from './backup-meta';
import { CategoryCard } from './CategoryCard';
import { GitSummarySection } from './GitSummarySection';

const STATUS_POLL_MS = 30_000;

interface Props {
  workspaces: Workspace[];
}

export function VersionBackupPanel({ workspaces }: Props) {
  const settings = useSettingsStore((s) => s.settings);
  const saveSettings = useSettingsStore((s) => s.saveSettings);
  const [status, setStatus] = useState<BackupScopeStatus[]>([]);
  const [scheduler, setScheduler] = useState<BackupSchedulerStatus | null>(null);
  const [runningKeys, setRunningKeys] = useState<Set<string>>(new Set());
  const [runningAll, setRunningAll] = useState(false);
  const [openingDir, setOpeningDir] = useState(false);

  const loadStatus = useCallback(async () => {
    try {
      const r = await client.getBackupStatus();
      setStatus(r.status);
      setScheduler(r.scheduler);
    } catch {
      // 轮询场景静默失败避免 toast 刷屏；失败时保持上次状态
    }
  }, []);

  useEffect(() => {
    loadStatus();
  }, [loadStatus]);
  useVisiblePolling(loadStatus, STATUS_POLL_MS);

  const nameById = useMemo(() => new Map(workspaces.map((w) => [w.id, w.name])), [workspaces]);

  const byCategory = useMemo(() => {
    const m = new Map<BackupCategoryKey, BackupScopeStatus[]>();
    for (const row of status) {
      const arr = m.get(row.key);
      if (arr) arr.push(row);
      else m.set(row.key, [row]);
    }
    return m;
  }, [status]);

  const updateCategoryConfig = useCallback(
    async (key: BackupCategoryKey, patch: Partial<BackupCategorySetting>) => {
      const latest = useSettingsStore.getState().settings;
      const base = latest.backup?.categories;
      const current = base?.[key] ?? CATEGORY_META[key].defaultConfig;
      const categories = Object.fromEntries(
        BACKUP_CATEGORY_ORDER.map((k) => [k, base?.[k] ?? CATEGORY_META[k].defaultConfig]),
      ) as Record<BackupCategoryKey, BackupCategorySetting>;
      categories[key] = { ...current, ...patch };
      try {
        await saveSettings({ ...latest, backup: { categories } });
      } catch (e) {
        toast.error('保存备份配置失败', { description: String(e) });
        return;
      }
      loadStatus();
    },
    [saveSettings, loadStatus],
  );

  const runOne = useCallback(
    async (key: BackupCategoryKey, scope: string) => {
      const runKey = `${scope}:${key}`;
      setRunningKeys((prev) => new Set(prev).add(runKey));
      try {
        const r = await client.runBackup({ category: key, scope });
        if ('error' in r) {
          toast.error('备份失败', { description: r.error });
          return;
        }
        reportRunResults(key, r.results);
      } catch (e) {
        toast.error('备份失败', { description: String(e) });
      } finally {
        setRunningKeys((prev) => {
          const next = new Set(prev);
          next.delete(runKey);
          return next;
        });
        loadStatus();
      }
    },
    [loadStatus],
  );

  const runAll = useCallback(async () => {
    setRunningAll(true);
    try {
      const r = await client.runBackup({});
      if ('error' in r) {
        toast.error('全部备份失败', { description: r.error });
        return;
      }
      const results = r.results ?? [];
      const failed = results.filter((i) => i.error);
      const empty = results.filter((i) => !i.error && i.fileName == null);
      const okCount = results.length - failed.length - empty.length;
      if (failed.length > 0) {
        toast.error(`全部备份：${failed.length} 项失败`, {
          description: failed.map((f) => `${CATEGORY_META[f.key].name}（${f.scope}）：${f.error}`).join('\n'),
        });
      } else {
        toast.success(`全部备份完成：成功 ${okCount} 项${empty.length > 0 ? `，${empty.length} 项无内容` : ''}`);
      }
    } catch (e) {
      toast.error('全部备份失败', { description: String(e) });
    } finally {
      setRunningAll(false);
      loadStatus();
    }
  }, [loadStatus]);

  const openDir = useCallback(async () => {
    setOpeningDir(true);
    try {
      const r = await client.openBackupDir({});
      if ('error' in r && r.error) toast.error('打开备份目录失败', { description: r.error });
    } catch (e) {
      toast.error('打开备份目录失败', { description: String(e) });
    } finally {
      setOpeningDir(false);
    }
  }, []);

  return (
    <div className="mx-auto max-w-4xl px-6 py-6 space-y-6">
      <GitSummarySection workspaces={workspaces} />

      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-medium text-muted-foreground">应用数据备份</h2>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={() => openDir()} disabled={openingDir}>
              <FolderOpen className="w-3.5 h-3.5 mr-1" />
              打开备份目录
            </Button>
            <Button variant="outline" size="sm" onClick={() => runAll()} disabled={runningAll}>
              {runningAll ? (
                <Loader2 className="w-3.5 h-3.5 mr-1 animate-spin" />
              ) : (
                <HardDriveDownload className="w-3.5 h-3.5 mr-1" />
              )}
              {runningAll ? '备份中…' : '全部备份'}
            </Button>
          </div>
        </div>
        <div className="space-y-4">
          {scheduler && !scheduler.ok && scheduler.error && (
            <div className="flex items-center gap-1.5 text-xs text-red-600">
              <CircleAlert className="w-3.5 h-3.5 shrink-0" />
              <span className="truncate" title={scheduler.error}>
                最近自动备份失败：{scheduler.error}
              </span>
            </div>
          )}
          {BACKUP_CATEGORY_ORDER.map((key) => (
            <CategoryCard
              key={key}
              category={key}
              rows={byCategory.get(key) ?? []}
              nameById={nameById}
              config={settings.backup?.categories?.[key] ?? CATEGORY_META[key].defaultConfig}
              runningKeys={runningKeys}
              onConfigChange={updateCategoryConfig}
              onRun={runOne}
              onChanged={() => loadStatus()}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

function reportRunResults(key: BackupCategoryKey, results: BackupRunItem[]) {
  const item = results.find((i) => i.key === key);
  if (!item) return;
  if (item.error) {
    toast.error('备份失败', { description: item.error });
    return;
  }
  if (item.fileName == null) {
    toast.info('没有可备份的内容');
    return;
  }
  toast.success(`${CATEGORY_META[key].name} 备份完成`, { description: `${item.fileName} · ${formatBytes(item.size)}` });
}
