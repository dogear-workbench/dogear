import { useEffect, useState } from 'react';
import { ChevronDown } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Switch } from '@/components/ui/switch';
import type { ToolGroup, ToolInfo, ToolPack } from './ability-types';
import { RESIDENT_GROUPS } from './ability-types';

interface GroupCardProps {
  server: string;
  label: string;
  note: string;
  tools?: ToolInfo[];
  fallbackCount?: number;
  resident?: boolean;
  highlighted: boolean;
  expanded: boolean;
  onToggleExpand: () => void;
  onToolClick: (tool: { name: string; description: string }) => void;
  toggle?: {
    checked: boolean;
    busy: boolean;
    onChange: (value: boolean) => void;
  };
}

function GroupCard({
  server,
  label,
  note,
  tools,
  fallbackCount,
  resident = false,
  highlighted,
  expanded,
  onToggleExpand,
  onToolClick,
  toggle,
}: GroupCardProps) {
  const count = tools?.length ?? fallbackCount;
  return (
    <div
      data-server={server}
      className={cn(
        'rounded-md border bg-background overflow-hidden transition-shadow',
        highlighted && 'ring-2 ring-primary',
      )}
    >
      <div className="flex items-center gap-2 px-3 py-1.5 bg-muted/30">
        <button
          type="button"
          className="flex items-center gap-2 flex-1 min-w-0 text-left"
          onClick={onToggleExpand}
          aria-expanded={expanded}
        >
          <ChevronDown
            className={cn(
              'w-3.5 h-3.5 shrink-0 text-muted-foreground transition-transform',
              !expanded && '-rotate-90',
            )}
          />
          <span className="text-xs font-semibold truncate">{label}</span>
          <span className="text-[10px] text-muted-foreground font-mono shrink-0">
            {server}
          </span>
          {count !== undefined && (
            <span className="text-[10px] text-muted-foreground shrink-0">
              {count} 个
            </span>
          )}
        </button>
        {toggle ? (
          <Switch
            checked={toggle.checked}
            disabled={toggle.busy}
            onCheckedChange={toggle.onChange}
            aria-label={`${toggle.checked ? '取消挂载' : '挂载'}工具包 ${label}`}
          />
        ) : (
          resident && (
            <span className="text-[10px] px-1 py-0.5 rounded shrink-0 bg-emerald-50 dark:bg-emerald-950 text-emerald-700 dark:text-emerald-400">
              常驻
            </span>
          )
        )}
      </div>
      <p className="px-3 py-1.5 text-xs text-muted-foreground/80 leading-relaxed bg-muted/30 border-t border-border/40">
        {note}
      </p>
      {expanded &&
        (tools && tools.length > 0 ? (
          <div className="divide-y">
            {tools.map((t) => (
              <button
                key={`${server}::${t.name}`}
                type="button"
                className="w-full flex items-start gap-2 px-3 py-1.5 text-left hover:bg-muted/30 transition-colors"
                onClick={() => onToolClick(t)}
              >
                <span className="text-xs font-mono text-foreground shrink-0">
                  {t.name}
                </span>
                <span className="text-xs text-muted-foreground leading-relaxed">
                  {t.shortDescription}
                </span>
              </button>
            ))}
          </div>
        ) : (
          <p className="px-3 py-2 text-xs text-muted-foreground">
            会话启动后才会注册具体工具，此处暂无明细。
          </p>
        ))}
    </div>
  );
}

interface AbilityToolGroupViewProps {
  groupByServer: Record<string, ToolGroup>;
  packs: ToolPack[];
  workspaceId: string | null;
  highlightServer: string | null;
  busyPack: string | null;
  onToolClick: (tool: { name: string; description: string }) => void;
  onTogglePack: (name: string, enabled: boolean) => void;
  onHighlightEnd: () => void;
}

export function AbilityToolGroupView({
  groupByServer,
  packs,
  workspaceId,
  highlightServer,
  busyPack,
  onToolClick,
  onTogglePack,
  onHighlightEnd,
}: AbilityToolGroupViewProps) {
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  useEffect(() => {
    if (!highlightServer) return;
    const raf = requestAnimationFrame(() => {
      document
        .querySelector(`[data-server="${highlightServer}"]`)
        ?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    });
    const timer = setTimeout(onHighlightEnd, 2000);
    return () => {
      cancelAnimationFrame(raf);
      clearTimeout(timer);
    };
  }, [highlightServer, onHighlightEnd]);

  const toggleExpand = (key: string) =>
    setExpanded((prev) => ({ ...prev, [key]: !prev[key] }));

  return (
    <div className="space-y-6">
      <section className="space-y-1.5">
        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
          常驻 · 全局
        </p>
        <p className="text-xs text-muted-foreground/80">
          跟随会话上下文自动注册，无需配置。
        </p>
        <div className="space-y-2">
          {RESIDENT_GROUPS.map((g) => (
            <GroupCard
              key={g.server}
              server={g.server}
              label={g.label}
              note={g.injectNote}
              tools={groupByServer[g.server]?.tools}
              resident
              highlighted={highlightServer === g.server}
              expanded={!!expanded[g.server]}
              onToggleExpand={() => toggleExpand(g.server)}
              onToolClick={onToolClick}
            />
          ))}
        </div>
      </section>

      <section className="space-y-1.5">
        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
          可选 · 按工作区挂载
        </p>
        {workspaceId === null ? (
          <p className="text-xs text-muted-foreground">请先在工作区管理创建工作区。</p>
        ) : (
          <div className="space-y-2">
            {packs.map((p) => (
              <GroupCard
                key={p.name}
                server={p.mcpServer}
                label={p.label}
                note={p.requirements ? `${p.description}（${p.requirements}）` : p.description}
                tools={groupByServer[p.mcpServer]?.tools}
                fallbackCount={p.toolCount}
                highlighted={highlightServer === p.mcpServer}
                expanded={!!expanded[p.mcpServer]}
                onToggleExpand={() => toggleExpand(p.mcpServer)}
                onToolClick={onToolClick}
                toggle={{
                  checked: p.enabled,
                  busy: busyPack === p.name,
                  onChange: (v) => onTogglePack(p.name, v),
                }}
              />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
