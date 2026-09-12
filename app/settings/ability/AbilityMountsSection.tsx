import { useCallback, useEffect, useState } from 'react';
import { cn } from '@/lib/utils';
import { client } from '@/lib/client';
import type { AbilityMountSceneRow } from '../../../electron/main/tipc/ability';

interface AbilityMountsSectionProps {
  packKey: string;
  workspaceId: string | null;
  refreshKey: number;
}

function SceneRow({ row }: { row: AbilityMountSceneRow }) {
  return (
    <div className="flex items-start gap-2 rounded-md border bg-background px-2 py-1.5">
      <span
        className={cn(
          'mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded text-xs leading-none font-semibold',
          row.loaded
            ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/50 dark:text-emerald-300'
            : 'bg-muted text-muted-foreground',
        )}
        aria-label={row.loaded ? '已加载' : '未加载'}
      >
        {row.loaded ? '✓' : '✗'}
      </span>
      <div className="min-w-0 flex-1 space-y-0.5">
        <div className="flex items-center gap-1.5 flex-wrap">
          <span className="text-xs font-medium text-foreground/90">{row.label}</span>
          {row.system && (
            <span className="text-xs px-1 py-0.5 rounded bg-muted text-muted-foreground">系统预设</span>
          )}
          {row.profileDisabled && (
            <span className="text-xs px-1 py-0.5 rounded bg-muted text-muted-foreground">已停用</span>
          )}
        </div>
        <p className="text-xs text-muted-foreground leading-relaxed">{row.reason}</p>
      </div>
    </div>
  );
}

export function AbilityMountsSection({ packKey, workspaceId, refreshKey }: AbilityMountsSectionProps) {
  const [rows, setRows] = useState<AbilityMountSceneRow[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!workspaceId) {
      setRows(null);
      setFailed(false);
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const res = await client.getAbilityMounts({ key: packKey, workspaceId });
      if ('error' in res || !res.rows) {
        setRows(null);
        setFailed(true);
      } else {
        setRows(res.rows);
        setFailed(false);
      }
    } finally {
      setLoading(false);
    }
  }, [packKey, workspaceId]);

  useEffect(() => {
    void load();
  }, [load, refreshKey]);

  if (!workspaceId) {
    return <p className="text-xs text-muted-foreground">未选择工作区，无法读取加载情况。</p>;
  }
  if (loading && !rows) {
    return <p className="text-xs text-muted-foreground">加载情况读取中…</p>;
  }
  if (!rows || failed) {
    return <p className="text-xs text-muted-foreground">加载情况读取失败</p>;
  }

  return (
    <div className="space-y-1.5">
      {rows.map((row) => (
        <SceneRow key={row.id} row={row} />
      ))}
    </div>
  );
}
