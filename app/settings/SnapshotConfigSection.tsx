import { useState, type Dispatch, type SetStateAction } from 'react';
import { Eraser, Loader2, RotateCcw, X } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { showConfirm } from '@/stores/confirm-store';
import { client } from '@/lib/client';
import { formatBytes } from '@/app/data-center/version-backup/backup-meta';
import { cn } from '@/lib/utils';
import {
  SNAPSHOT_SETTING_DEFAULTS,
  type SnapshotRetention,
  type SnapshotSettings,
} from '@/electron/main/services/settings-types';
import type { AppSettings } from '@/types/settings';
import type { Workspace } from '@/types/electron-api';
import type { ShadowSnapshotSummary } from './SnapshotWorkspaceCell';

interface Props {
  local: AppSettings;
  setLocal: Dispatch<SetStateAction<AppSettings>>;
  workspaces: Workspace[];
  summaries: Record<string, ShadowSnapshotSummary>;
  onRefreshSummaries: () => void;
}

const MB = 1024 * 1024;
const inputCls = 'h-9 w-full px-3 text-sm border rounded-md bg-background focus:outline-none focus:ring-1 focus:ring-ring';

function parsePositiveInt(raw: string): number | null {
  const n = Number(raw);
  return Number.isInteger(n) && n >= 1 ? n : null;
}

export function SnapshotConfigSection({ local, setLocal, workspaces, summaries, onRefreshSummaries }: Props) {
  const snapshot = local.snapshot ?? structuredClone(SNAPSHOT_SETTING_DEFAULTS);
  const [slimming, setSlimming] = useState(false);

  const update = (patch: Partial<SnapshotSettings>) => {
    setLocal((prev) => ({
      ...prev,
      snapshot: { ...(prev.snapshot ?? structuredClone(SNAPSHOT_SETTING_DEFAULTS)), ...patch },
    }));
  };

  const updateRetention = (patch: Partial<SnapshotRetention>) => {
    const retention = snapshot.retention;
    const recentDays = patch.recentDays ?? retention.recentDays;
    const totalDays = Math.max(patch.totalDays ?? retention.totalDays, recentDays);
    update({ retention: { recentDays, totalDays } });
  };

  const thresholdMb = Math.round((snapshot.maxFileSizeBytes / MB) * 10) / 10;

  const setThreshold = (raw: string) => {
    const mb = Number(raw);
    if (!Number.isFinite(mb) || mb <= 0) return;
    update({ maxFileSizeBytes: Math.max(1, Math.round(mb * MB)) });
  };

  const removeExcludedPath = async (workspaceId: string, relPath: string) => {
    const res = await client.removeSnapshotExcludedPath({ workspaceId, relPath });
    if ('error' in res) {
      toast.error(res.error);
      return;
    }
    setLocal((prev) => {
      const base = prev.snapshot ?? structuredClone(SNAPSHOT_SETTING_DEFAULTS);
      const excludedPaths = { ...base.excludedPaths };
      if (res.paths.length > 0) {
        excludedPaths[workspaceId] = res.paths;
      } else {
        delete excludedPaths[workspaceId];
      }
      return { ...prev, snapshot: { ...base, excludedPaths } };
    });
  };

  const handleResetDefaults = async () => {
    const ok = await showConfirm(
      '恢复默认快照配置',
      '大小阈值、保留窗口还原为推荐值，所有工作区快照开关重新打开，排除目录按当前磁盘状态重新对照生成。',
    );
    if (!ok) return;
    const res = await client.restoreSnapshotDefaults();
    if ('error' in res) {
      toast.error(res.error);
      return;
    }
    setLocal((prev) => ({ ...prev, snapshot: res.snapshot }));
  };

  const excludedGroups = workspaces
    .map((ws) => ({ workspace: ws, paths: snapshot.excludedPaths[ws.id] ?? [] }))
    .filter((g) => g.paths.length > 0);

  const slimmable = workspaces.filter((w) => (summaries[w.id]?.snapshotCount ?? 0) > 0);
  const totalSnapshots = Object.values(summaries).reduce((sum, s) => sum + s.snapshotCount, 0);
  const totalBytes = Object.values(summaries).reduce((sum, s) => sum + s.sizeBytes, 0);

  const handleSlim = async () => {
    if (slimmable.length === 0) {
      toast.info('没有可瘦身的工作区快照');
      return;
    }
    const ok = await showConfirm(
      '立即瘦身快照库',
      `将按当前规则（单文件阈值、排除目录、保留窗口）重写 ${slimmable.length} 个工作区的快照历史，释放被旧大文件占用的空间。过程约需数分钟，期间这些工作区的新快照会排队等待。当前共 ${totalSnapshots} 条快照，占用 ${formatBytes(totalBytes)}。`,
    );
    if (!ok) return;
    setSlimming(true);
    try {
      const failures: string[] = [];
      let freedBytes = 0;
      for (const w of slimmable) {
        const r = await client.slimShadowRepo({ workspaceId: w.id });
        if ('error' in r) {
          failures.push(`${w.name}：${r.error}`);
          continue;
        }
        freedBytes += Math.max(0, r.sizeBytesBefore - r.sizeBytesAfter);
      }
      if (failures.length > 0) {
        toast.error('部分工作区瘦身失败', { description: failures.join('；') });
      } else if (freedBytes > 0) {
        toast.success(`瘦身完成，释放 ${formatBytes(freedBytes)}`);
      } else {
        toast.success('快照历史已符合当前规则，无需释放空间');
      }
      onRefreshSummaries();
    } catch (err) {
      toast.error('瘦身失败', {
        description: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setSlimming(false);
    }
  };

  return (
    <section className="space-y-3">
      <div className="flex items-start justify-between gap-4">
        <div>
          <label className="text-sm font-medium">自动快照配置</label>
          <p className="text-xs text-muted-foreground mt-0.5">
            影子快照是编辑操作的安全网（文件树右键「历史」可查看与恢复），正式版本历史请用工作区自身的 git 仓库。
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={handleResetDefaults} className="shrink-0">
          <RotateCcw className="w-3.5 h-3.5 mr-1" />
          恢复默认
        </Button>
      </div>

      <div className="rounded-md border p-3 space-y-5">
        <div className="flex items-start gap-3">
          <label className="text-sm w-24 shrink-0 pt-2">单文件阈值</label>
          <div className="w-24 shrink-0">
            <div className="relative">
              <input
                type="number"
                min={1}
                step={1}
                className={cn(inputCls, 'pr-8')}
                value={thresholdMb}
                onChange={(e) => {
                  const raw = e.target.value.trim();
                  if (raw !== '') setThreshold(raw);
                }}
                onBlur={(e) => {
                  const mb = Number(e.target.value.trim());
                  if (!Number.isFinite(mb) || mb <= 0) update({ maxFileSizeBytes: SNAPSHOT_SETTING_DEFAULTS.maxFileSizeBytes });
                }}
              />
              <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground pointer-events-none">
                MB
              </span>
            </div>
          </div>
          <p className="text-xs text-muted-foreground pt-2 min-w-0">
            超过该大小的文件（安装包、字体等）不进入快照
          </p>
        </div>

        <div className="flex items-start gap-3">
          <label className="text-sm w-24 shrink-0 pt-1">排除目录</label>
          <div className="flex-1 min-w-0 space-y-2">
            {excludedGroups.length === 0 ? (
              <p className="text-xs text-muted-foreground">
                暂无排除目录。在文件树中右键目录，可将其整个排除出自动快照。
              </p>
            ) : (
              excludedGroups.map(({ workspace, paths }) => (
                <div key={workspace.id} className="space-y-1">
                  <p className="text-xs text-muted-foreground">{workspace.name}</p>
                  <div className="flex flex-wrap gap-1.5">
                    {paths.map((dir) => (
                      <Badge key={dir} variant="secondary" className="gap-1 font-normal">
                        {dir}
                        <button
                          type="button"
                          onClick={() => removeExcludedPath(workspace.id, dir)}
                          className="hover:text-destructive cursor-pointer"
                          title={`移除 ${dir}`}
                        >
                          <X className="w-3 h-3" />
                        </button>
                      </Badge>
                    ))}
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

        <div className="flex items-start gap-3">
          <label className="text-sm w-24 shrink-0 pt-2">保留窗口</label>
          <div className="flex flex-wrap items-center gap-1.5 text-sm min-w-0">
            <span className="text-muted-foreground">近</span>
            <input
              type="number"
              min={1}
              step={1}
              className="h-8 w-16 px-2 text-sm text-center border rounded-md bg-background focus:outline-none focus:ring-1 focus:ring-ring"
              value={snapshot.retention.recentDays}
              onChange={(e) => {
                const raw = e.target.value.trim();
                if (raw === '') return;
                const days = parsePositiveInt(raw);
                if (days !== null) updateRetention({ recentDays: days });
              }}
              onBlur={(e) => {
                const days = parsePositiveInt(e.target.value.trim());
                if (days === null) updateRetention({ recentDays: SNAPSHOT_SETTING_DEFAULTS.retention.recentDays });
              }}
            />
            <span className="text-muted-foreground">天全留，之后每天只留最新一条，</span>
            <input
              type="number"
              min={1}
              step={1}
              className="h-8 w-16 px-2 text-sm text-center border rounded-md bg-background focus:outline-none focus:ring-1 focus:ring-ring"
              value={snapshot.retention.totalDays}
              onChange={(e) => {
                const raw = e.target.value.trim();
                if (raw === '') return;
                const days = parsePositiveInt(raw);
                if (days !== null) updateRetention({ totalDays: days });
              }}
              onBlur={(e) => {
                const days = parsePositiveInt(e.target.value.trim());
                if (days === null) updateRetention({ totalDays: SNAPSHOT_SETTING_DEFAULTS.retention.totalDays });
              }}
            />
            <span className="text-muted-foreground">天外丢弃</span>
          </div>
        </div>

        <div className="border-t pt-4 flex items-start gap-3">
          <div className="flex-1 min-w-0">
            <label className="text-sm font-medium">存量瘦身</label>
            <p className="text-xs text-muted-foreground mt-0.5">
              历史快照中已存在的大文件不会自动消失，需重写快照历史才能释放空间。
              {totalSnapshots > 0 &&
                `当前 ${slimmable.length} 个工作区共 ${totalSnapshots} 条快照，占用 ${formatBytes(totalBytes)}。`}
            </p>
          </div>
          <Button variant="outline" size="sm" onClick={handleSlim} disabled={slimming} className="shrink-0">
            {slimming ? <Loader2 className="w-3.5 h-3.5 mr-1 animate-spin" /> : <Eraser className="w-3.5 h-3.5 mr-1" />}
            立即瘦身
          </Button>
        </div>
      </div>
    </section>
  );
}
