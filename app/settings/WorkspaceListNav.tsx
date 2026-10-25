import { Plus, Search } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import type { Workspace } from '@/types/electron-api';

interface Props {
  workspaces: Workspace[];
  loading: boolean;
  currentWorkspaceId: string | null;
  disabledWorkspaceIds: string[];
  selectedId: string | null;
  orphanMode: boolean;
  onSelectWorkspace: (id: string) => void;
  onSelectOrphans: () => void;
  onAddWorkspace: () => void;
  adding: boolean;
}

export function WorkspaceListNav({
  workspaces,
  loading,
  currentWorkspaceId,
  disabledWorkspaceIds,
  selectedId,
  orphanMode,
  onSelectWorkspace,
  onSelectOrphans,
  onAddWorkspace,
  adding,
}: Props) {
  return (
    <nav aria-label="工作区列表" className="w-[220px] shrink-0 border-r border-border/40">
      <div className="py-3 pr-3 flex flex-col gap-0.5">
        {workspaces.length === 0 && !loading && (
          <p className="px-3 py-2 text-sm text-muted-foreground">暂无工作区</p>
        )}
        {workspaces.map((ws) => {
          const selected = !orphanMode && ws.id === selectedId;
          const snapshotOn = !disabledWorkspaceIds.includes(ws.id);
          return (
            <button
              key={ws.id}
              type="button"
              className={cn(
                'flex items-center gap-2 text-left text-sm px-3 py-1.5 rounded-md transition-colors',
                selected
                  ? 'bg-primary/10 text-foreground font-medium'
                  : 'text-muted-foreground hover:text-foreground hover:bg-muted/50',
              )}
              onClick={() => onSelectWorkspace(ws.id)}
            >
              <span
                aria-hidden
                className={cn(
                  'w-[7px] h-[7px] rounded-full shrink-0',
                  snapshotOn ? 'bg-emerald-500' : 'bg-muted-foreground/40',
                )}
              />
              <span className="truncate">{ws.name}</span>
              {currentWorkspaceId === ws.id && (
                <span className="text-[10px] leading-none bg-emerald-500/10 text-emerald-600 px-1.5 py-1 rounded shrink-0">
                  当前
                </span>
              )}
              {ws.isDefault && (
                <span className="text-[10px] leading-none bg-primary/10 text-primary px-1.5 py-1 rounded shrink-0">
                  默认
                </span>
              )}
              {!snapshotOn && (
                <span className="text-[10px] leading-none bg-muted text-muted-foreground px-1.5 py-1 rounded shrink-0">
                  快照关
                </span>
              )}
            </button>
          );
        })}
        <div className="border-t border-border/40 mt-2 pt-2 flex flex-col gap-0.5">
          <button
            type="button"
            className={cn(
              'flex items-center gap-2 text-left text-sm px-3 py-1.5 rounded-md transition-colors',
              orphanMode
                ? 'bg-primary/10 text-foreground font-medium'
                : 'text-muted-foreground hover:text-foreground hover:bg-muted/50',
            )}
            onClick={onSelectOrphans}
          >
            <Search className="w-3.5 h-3.5 shrink-0" />
            丢失的会话
          </button>
          <Button
            variant="outline"
            size="sm"
            className="mt-1 justify-start"
            onClick={onAddWorkspace}
            disabled={adding}
          >
            <Plus className="w-4 h-4 mr-1" />
            添加工作区
          </Button>
        </div>
      </div>
    </nav>
  );
}
