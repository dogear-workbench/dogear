import { Switch } from '@/components/ui/switch';
import { client } from '@/lib/client';
import { formatBytes } from '@/app/data-center/version-backup/backup-meta';

export type ShadowSnapshotSummary = Extract<
  Awaited<ReturnType<typeof client.getShadowSnapshotSummary>>,
  { snapshotCount: unknown }
>;

interface Props {
  summary: ShadowSnapshotSummary | null;
  gitAvailable: boolean | null;
  enabled: boolean;
  onToggle: (enabled: boolean) => void;
}

function formatRelative(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return '刚刚';
  if (minutes < 60) return `${minutes} 分钟前`;
  const hours = Math.floor(diff / 3600000);
  if (hours < 24) return `${hours} 小时前`;
  const days = Math.floor(diff / 86400000);
  if (days < 30) return `${days} 天前`;
  return new Date(iso).toLocaleDateString('zh-CN');
}

export function SnapshotWorkspaceCell({ summary, gitAvailable, enabled, onToggle }: Props) {
  const statusText = !enabled
    ? '快照已关闭'
    : gitAvailable === false
      ? '未安装 git'
      : !summary
        ? null
        : summary.snapshotCount > 0 && summary.lastTime
          ? `${summary.snapshotCount} 个快照 · ${formatBytes(summary.sizeBytes)} · ${formatRelative(summary.lastTime)}`
          : '暂无快照';

  return (
    <div className="flex items-center gap-2 shrink-0">
      {statusText && (
        <span className="text-xs text-muted-foreground whitespace-nowrap" title="自动快照状态">
          {statusText}
        </span>
      )}
      <Switch
        checked={enabled}
        disabled={gitAvailable === false}
        onCheckedChange={onToggle}
        aria-label={`自动快照${enabled ? '已开启' : '已关闭'}`}
      />
    </div>
  );
}
