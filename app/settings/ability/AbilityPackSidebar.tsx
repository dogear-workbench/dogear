import { useState } from 'react';
import { ChevronDown, Eye } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Switch } from '@/components/ui/switch';
import type { AbilityPackView, AbilityToolGroupMeta } from '../../../electron/main/tipc/ability';
import { AbilityMountsSection } from './AbilityMountsSection';

interface AbilityPackSidebarProps {
  pack: AbilityPackView;
  workspaceId: string | null;
  packEnabled: boolean;
  disabled?: boolean;
  packBusy: boolean;
  onTogglePack: (enable: boolean) => void;
  onToolDetail: (tool: { name: string; description: string }) => void;
  configVersion: number;
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
              <Eye className="w-3 h-3 text-muted-foreground shrink-0" />
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
  packEnabled,
  disabled,
  packBusy,
  onTogglePack,
  onToolDetail,
  configVersion,
}: AbilityPackSidebarProps) {
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>({});

  return (
    <div className="w-72 shrink-0 space-y-5 overflow-y-auto border-l p-4">
      <section className="space-y-2">
        <div className="flex items-center justify-between">
          <span className="text-xs text-muted-foreground">能力开关</span>
          <Switch
            checked={packEnabled}
            disabled={disabled || packBusy}
            onCheckedChange={onTogglePack}
            aria-label={`${packEnabled ? '关闭' : '开启'} ${pack.label}`}
          />
        </div>
        <p className="text-xs text-muted-foreground">
          {pack.defaultEnabled ? '默认开启，关闭后本工作区停用该包。' : '默认关闭，开启后本工作区启用该包。'}
        </p>
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
        <AbilityMountsSection packKey={pack.key} workspaceId={workspaceId} refreshKey={configVersion} />
      </section>

      <p className="text-xs text-muted-foreground/70 leading-relaxed border-t pt-3">
        开关即时保存到当前工作区配置；修改后需重启会话生效。
      </p>
    </div>
  );
}
