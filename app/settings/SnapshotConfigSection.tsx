import { useState, type Dispatch, type SetStateAction } from 'react';
import { Eraser, Loader2, RotateCcw } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { showConfirm } from '@/stores/confirm-store';
import { client } from '@/lib/client';
import { formatBytes } from '@/app/data-center/version-backup/backup-meta';
import {
  SNAPSHOT_SETTING_DEFAULTS,
  type SnapshotRetention,
  type SnapshotSettings,
} from '@/electron/main/services/settings-types';
import type { AppSettings } from '@/types/settings';
import type { Workspace } from '@/types/electron-api';
import { SettingRow, SettingsGroup } from './SettingsControls';

export type ShadowSnapshotSummary = Extract<
  Awaited<ReturnType<typeof client.getShadowSnapshotSummary>>,
  { snapshotCount: unknown }
>;

interface Props {
  local: AppSettings;
  setLocal: Dispatch<SetStateAction<AppSettings>>;
  workspaces: Workspace[];
  summaries: Record<string, ShadowSnapshotSummary>;
  onRefreshSummaries: () => void;
}

const MB = 1024 * 1024;
const inputCls = 'h-8 w-14 px-2 text-sm text-center border rounded-md bg-background focus:outline-none focus:ring-1 focus:ring-ring';

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
    <SettingsGroup id="ws-snapshot-global" title="快照全局规则">
      <SettingRow title="单文件阈值" desc="超过该大小的文件（安装包、字体等）不进入快照">
        <div className="relative">
          <input
            type="number"
            min={1}
            step={1}
            className="h-8 w-20 pr-6 pl-2 text-sm border rounded-md bg-background focus:outline-none focus:ring-1 focus:ring-ring"
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
          <span className="absolute right-2 top-1/2 -translate-y-1/2 text-xs text-muted-foreground pointer-events-none">
            MB
          </span>
        </div>
      </SettingRow>

      <SettingRow
        title="保留窗口"
        desc={`近 ${snapshot.retention.recentDays} 天全保留，之后每天只留最新一条，${snapshot.retention.totalDays} 天外丢弃`}
      >
        <div className="flex items-center gap-1.5 text-sm">
          <input
            type="number"
            min={1}
            step={1}
            className={inputCls}
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
          <span className="text-muted-foreground">天全留</span>
          <input
            type="number"
            min={1}
            step={1}
            className={inputCls}
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
      </SettingRow>

      <SettingRow
        title="存量瘦身"
        desc={
          totalSnapshots > 0
            ? `历史快照里已存在的大文件不会自动消失。当前 ${slimmable.length} 个工作区共 ${totalSnapshots} 条快照，占用 ${formatBytes(totalBytes)}`
            : '历史快照里已存在的大文件不会自动消失，需重写快照历史释放空间'
        }
      >
        <Button variant="outline" size="sm" onClick={() => void handleSlim()} disabled={slimming}>
          {slimming ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Eraser className="w-3.5 h-3.5" />}
          立即瘦身
        </Button>
      </SettingRow>

      <SettingRow title="恢复默认" desc="所有规则还原为推荐值，并重新打开所有工作区的快照开关">
        <Button variant="outline" size="sm" onClick={() => void handleResetDefaults()}>
          <RotateCcw className="w-3.5 h-3.5" />
          恢复默认
        </Button>
      </SettingRow>
    </SettingsGroup>
  );
}
