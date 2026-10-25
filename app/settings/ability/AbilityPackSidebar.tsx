import { useState } from 'react';
import { ChevronDown } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { AbilityPackView, AbilityToolGroupMeta } from '../../../electron/main/tipc/ability';
import { AbilityMountsSection } from './AbilityMountsSection';
import { PACK_TYPE_LABELS } from './pack-meta';

interface AbilityPackSidebarProps {
  pack: AbilityPackView;
  workspaceId: string | null;
  onToolDetail: (tool: { name: string; description: string }) => void;
  refreshKey: number;
}

function ToolGroupPanel({
  group,
  open,
  onToggleOpen,
  onToolDetail,
}: {
  group: AbilityToolGroupMeta;
  open: boolean;
  onToggleOpen: () => void;
  onToolDetail: (tool: { name: string; description: string }) => void;
}) {
  return (
    <div className="rounded-md border bg-background overflow-hidden">
      <button
        type="button"
        className="w-full flex items-center gap-2 px-2.5 py-1.5 text-left hover:bg-muted/40 transition-colors"
        onClick={onToggleOpen}
        aria-expanded={open}
      >
        <ChevronDown
          className={cn('w-3.5 h-3.5 shrink-0 text-muted-foreground transition-transform', !open && '-rotate-90')}
        />
        <span className="text-xs font-medium truncate">{group.label}</span>
        {group.deferred && (
          <span className="text-xs px-1 py-0.5 rounded bg-muted text-muted-foreground shrink-0">按需</span>
        )}
        <span className="text-xs text-muted-foreground ml-auto shrink-0">{group.tools.length} 工具</span>
      </button>
      {open && (
        <div className="border-t border-border/40 divide-y divide-border/60">
          {group.tools.map((tool) => (
            <button
              key={tool.name}
              type="button"
              className="w-full flex items-center gap-1.5 px-2.5 py-1.5 text-left hover:bg-muted/30 transition-colors"
              onClick={() => onToolDetail(tool)}
            >
              <span className="text-xs font-mono text-foreground/90 truncate">{tool.name}</span>
              <span className="text-xs text-muted-foreground truncate flex-1">{tool.shortDescription}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export function AbilityPackSidebar({
  pack,
  workspaceId,
  onToolDetail,
  refreshKey,
}: AbilityPackSidebarProps) {
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>({});

  return (
    <div className="flex-[4] min-w-0 space-y-5 overflow-y-auto border-l p-4">
      <section className="space-y-2">
        <div className="flex items-center gap-1.5 flex-wrap">
          <span className="inline-block text-xs px-1.5 py-0.5 rounded bg-muted text-muted-foreground">
            {PACK_TYPE_LABELS[pack.type]}
          </span>
          {(pack.deferredToolGroups?.length ?? 0) > 0 && (
            <span className="inline-block text-xs px-1.5 py-0.5 rounded bg-muted text-muted-foreground">按需</span>
          )}
        </div>
        <p className="text-xs text-muted-foreground leading-relaxed">{pack.description}</p>
      </section>

      {pack.toolGroupMetas.length > 0 && (
        <section className="space-y-2">
          <span className="text-xs text-muted-foreground">配套工具组</span>
          <div className="space-y-1.5">
            {pack.toolGroupMetas.map((group) => (
              <ToolGroupPanel
                key={group.id}
                group={group}
                open={openGroups[group.id] ?? false}
                onToggleOpen={() => setOpenGroups((prev) => ({ ...prev, [group.id]: !prev[group.id] }))}
                onToolDetail={onToolDetail}
              />
            ))}
          </div>
        </section>
      )}

      <section className="space-y-2">
        <span className="text-xs text-muted-foreground">加载情况</span>
        <AbilityMountsSection packKey={pack.key} workspaceId={workspaceId} refreshKey={refreshKey} />
      </section>
    </div>
  );
}
