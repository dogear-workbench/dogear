import { useState } from 'react';
import { ChevronDown, Eye } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { SystemPromptSegment } from '@/types/system-prompt';
import type { ToolGroup } from './ability-types';
import { RESIDENT_GROUPS } from './ability-types';

function SegmentList({
  segments,
  onSegmentClick,
}: {
  segments: SystemPromptSegment[];
  onSegmentClick: (segment: SystemPromptSegment) => void;
}) {
  if (segments.length === 0) {
    return <p className="text-xs text-muted-foreground">当前上下文无注入。</p>;
  }
  return (
    <div className="space-y-1.5">
      {segments.map((seg) => (
        <div key={seg.key} className="p-2 rounded-md border border-border/60 bg-muted/20">
          <div className="flex items-center gap-1.5">
            <span className="text-xs font-semibold">{seg.label}</span>
            {seg.isDynamic && (
              <span className="text-[10px] px-1 py-0.5 rounded bg-muted text-muted-foreground">
                动态
              </span>
            )}
            <button
              type="button"
              className="flex items-center gap-1 px-1.5 h-6 rounded text-xs text-muted-foreground hover:bg-muted/50 hover:text-foreground transition-colors ml-auto"
              onClick={() => onSegmentClick(seg)}
              title="查看提示词段全文"
            >
              <Eye className="w-3 h-3" />
              详情
            </button>
          </div>
          {seg.triggerDescription && (
            <p className="text-xs text-muted-foreground/80 leading-relaxed mt-1">
              {seg.triggerDescription}
            </p>
          )}
        </div>
      ))}
    </div>
  );
}

interface AbilityResidentSectionProps {
  segments: SystemPromptSegment[];
  groupByServer: Record<string, ToolGroup>;
  onSegmentClick: (segment: SystemPromptSegment) => void;
  onToolClick: (tool: { name: string; description: string }) => void;
}

export function AbilityResidentSection({
  segments,
  groupByServer,
  onSegmentClick,
  onToolClick,
}: AbilityResidentSectionProps) {
  const [expanded, setExpanded] = useState(false);
  const [expandedGroups, setExpandedGroups] = useState<Record<string, boolean>>({});

  const toggleGroup = (server: string) =>
    setExpandedGroups((prev) => ({ ...prev, [server]: !prev[server] }));

  return (
    <section className="rounded-lg border bg-muted/10 overflow-hidden">
      <button
        type="button"
        className="w-full flex items-center gap-3 px-4 py-2.5 text-left hover:bg-muted/30 transition-colors"
        onClick={() => setExpanded((v) => !v)}
        aria-expanded={expanded}
      >
        <ChevronDown
          className={cn(
            'w-4 h-4 shrink-0 text-muted-foreground transition-transform',
            !expanded && '-rotate-90',
          )}
        />
        <span className="text-sm font-semibold">常驻能力</span>
        <span className="text-xs text-muted-foreground">
          全局只读 · 提示词段 {segments.length} · 工具组 {RESIDENT_GROUPS.length}
        </span>
      </button>
      {expanded && (
        <div className="px-4 pb-4 pt-1 grid gap-4 md:grid-cols-2">
          <div className="space-y-1.5">
            <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">
              提示词段 · 按会话上下文自动注入
            </p>
            <SegmentList segments={segments} onSegmentClick={onSegmentClick} />
          </div>
          <div className="space-y-1.5">
            <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">
              常驻工具组 · 满足条件时自动注册
            </p>
            <div className="space-y-2">
              {RESIDENT_GROUPS.map((g) => {
                const tools = groupByServer[g.server]?.tools;
                return (
                  <div key={g.server} className="rounded-md border bg-background overflow-hidden">
                    <button
                      type="button"
                      className="w-full flex items-center gap-2 px-3 py-1.5 bg-muted/30 text-left hover:bg-muted/50 transition-colors"
                      onClick={() => toggleGroup(g.server)}
                      aria-expanded={!!expandedGroups[g.server]}
                    >
                      <ChevronDown
                        className={cn(
                          'w-3.5 h-3.5 shrink-0 text-muted-foreground transition-transform',
                          !expandedGroups[g.server] && '-rotate-90',
                        )}
                      />
                      <span className="text-xs font-semibold">{g.label}</span>
                      <span className="text-[10px] text-muted-foreground font-mono hidden sm:inline">
                        {g.server}
                      </span>
                      {tools && (
                        <span className="text-[10px] text-muted-foreground shrink-0 ml-auto">
                          {tools.length} 个
                        </span>
                      )}
                    </button>
                    <p className="px-3 py-1 text-[10px] text-muted-foreground/70 bg-muted/30 border-t border-border/40">
                      {g.injectNote}
                    </p>
                    {expandedGroups[g.server] &&
                      (tools && tools.length > 0 ? (
                        <div className="divide-y divide-border/60">
                          {tools.map((t) => (
                            <button
                              key={t.name}
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
                        <p className="px-3 py-1.5 text-xs text-muted-foreground/70">
                          当前上下文未注册，会话满足条件后自动出现。
                        </p>
                      ))}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
