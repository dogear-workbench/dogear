import { useState, type Dispatch, type SetStateAction } from 'react';
import { Plus, RotateCcw, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { showConfirm } from '@/stores/confirm-store';
import { cn } from '@/lib/utils';
import {
  SNAPSHOT_SETTING_DEFAULTS,
  type SnapshotRetention,
  type SnapshotSettings,
} from '@/electron/main/services/settings-types';
import type { AppSettings } from '@/types/settings';

interface Props {
  local: AppSettings;
  setLocal: Dispatch<SetStateAction<AppSettings>>;
}

const MB = 1024 * 1024;
const inputCls = 'h-9 w-full px-3 text-sm border rounded-md bg-background focus:outline-none focus:ring-1 focus:ring-ring';

function parsePositiveInt(raw: string): number | null {
  const n = Number(raw);
  return Number.isInteger(n) && n >= 1 ? n : null;
}

export function SnapshotConfigSection({ local, setLocal }: Props) {
  const snapshot = local.snapshot ?? structuredClone(SNAPSHOT_SETTING_DEFAULTS);
  const [dirDraft, setDirDraft] = useState('');

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

  const addDir = () => {
    const name = dirDraft.trim().replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
    setDirDraft('');
    if (!name || snapshot.excludeDirs.includes(name)) return;
    update({ excludeDirs: [...snapshot.excludeDirs, name] });
  };

  const removeDir = (dir: string) => {
    update({ excludeDirs: snapshot.excludeDirs.filter((d) => d !== dir) });
  };

  const handleResetDefaults = async () => {
    const ok = await showConfirm(
      '恢复默认快照配置',
      '大小阈值、排除目录、保留窗口将还原为推荐值，所有工作区的快照开关也会重新打开。',
    );
    if (!ok) return;
    setLocal((prev) => ({ ...prev, snapshot: structuredClone(SNAPSHOT_SETTING_DEFAULTS) }));
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
            <div className="flex flex-wrap gap-1.5">
              {snapshot.excludeDirs.map((dir) => (
                <Badge key={dir} variant="secondary" className="gap-1 font-normal">
                  {dir}
                  <button
                    type="button"
                    onClick={() => removeDir(dir)}
                    className="hover:text-destructive cursor-pointer"
                    title={`移除 ${dir}`}
                  >
                    <X className="w-3 h-3" />
                  </button>
                </Badge>
              ))}
            </div>
            <div className="flex gap-2">
              <input
                type="text"
                className={inputCls}
                value={dirDraft}
                placeholder="目录名，如 build；匹配任意层级"
                onChange={(e) => setDirDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') addDir();
                }}
              />
              <Button variant="outline" size="sm" onClick={addDir} disabled={!dirDraft.trim()} className="shrink-0">
                <Plus className="w-3.5 h-3.5 mr-1" />
                添加
              </Button>
            </div>
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
      </div>
    </section>
  );
}
