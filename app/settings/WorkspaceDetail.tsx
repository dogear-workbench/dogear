import { Trash2, X } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { formatBytes } from '@/app/data-center/version-backup/backup-meta';
import { SettingRow, SettingsGroup } from './SettingsControls';
import type { Workspace } from '@/types/electron-api';
import type { ShadowSnapshotSummary } from './SnapshotConfigSection';

interface Props {
  workspace: Workspace;
  isActive: boolean;
  summary: ShadowSnapshotSummary | null;
  gitAvailable: boolean | null;
  snapshotEnabled: boolean;
  onToggleSnapshot: (enabled: boolean) => void;
  excludedPaths: string[];
  onRemoveExcludedPath: (relPath: string) => void;
  onDelete: () => void;
}

export function WorkspaceDetail({
  workspace,
  isActive,
  summary,
  gitAvailable,
  snapshotEnabled,
  onToggleSnapshot,
  excludedPaths,
  onRemoveExcludedPath,
  onDelete,
}: Props) {
  const summaryText =
    summary && summary.snapshotCount > 0
      ? `当前 ${summary.snapshotCount} 条快照，占 ${formatBytes(summary.sizeBytes)}`
      : null;
  const switchDesc = gitAvailable === false
    ? '本机未安装 git，快照不可用'
    : summaryText
      ? `编辑后的文件自动存入快照库，文件树右键「历史」可恢复 · ${summaryText}`
      : '编辑后的文件自动存入快照库，文件树右键「历史」可恢复';

  return (
    <div>
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-2 min-w-0">
          <h2 className="text-lg font-semibold truncate">{workspace.name}</h2>
          {isActive && (
            <span className="text-[10px] leading-none bg-emerald-500/10 text-emerald-600 px-1.5 py-1 rounded shrink-0">
              当前
            </span>
          )}
          {workspace.isDefault && (
            <span className="text-[10px] leading-none bg-primary/10 text-primary px-1.5 py-1 rounded shrink-0">
              默认
            </span>
          )}
        </div>
        <Button
          variant="ghost"
          size="sm"
          className="text-destructive hover:text-destructive shrink-0"
          onClick={onDelete}
        >
          <Trash2 className="w-3.5 h-3.5" />
          删除工作区
        </Button>
      </div>
      <p className="text-xs text-muted-foreground mt-0.5 truncate" title={workspace.path}>
        {workspace.path}
      </p>

      <div className="mt-6">
        <SettingsGroup id="ws-snapshot-self" title="自动快照 · 此工作区">
          <SettingRow title="快照开关" desc={switchDesc}>
            <Switch
              checked={snapshotEnabled}
              disabled={gitAvailable === false}
              onCheckedChange={onToggleSnapshot}
              aria-label="自动快照开关"
            />
          </SettingRow>
          <SettingRow title="排除目录" desc="这些目录不进快照，在文件树中右键目录可添加">
            {excludedPaths.length === 0 ? (
              <span className="text-xs text-muted-foreground">暂无</span>
            ) : (
              <div className="flex flex-wrap gap-1.5 justify-end max-w-[420px]">
                {excludedPaths.map((dir) => (
                  <Badge key={dir} variant="secondary" className="gap-1 font-normal">
                    {dir}
                    <button
                      type="button"
                      onClick={() => onRemoveExcludedPath(dir)}
                      className="hover:text-destructive cursor-pointer"
                      title={`移除 ${dir}`}
                    >
                      <X className="w-3 h-3" />
                    </button>
                  </Badge>
                ))}
              </div>
            )}
          </SettingRow>
        </SettingsGroup>
      </div>
    </div>
  );
}
