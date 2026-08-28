import { ChevronDown, Eye } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Switch } from '@/components/ui/switch';
import type { AbilityDomainView, DomainPackItem, DomainSkillItem } from './ability-types';

function StatusBadge({ enabled }: { enabled: boolean }) {
  return (
    <span
      className={cn(
        'text-[10px] px-1 py-0.5 rounded shrink-0',
        enabled
          ? 'bg-emerald-50 dark:bg-emerald-950 text-emerald-700 dark:text-emerald-400'
          : 'bg-amber-50 dark:bg-amber-950 text-amber-700 dark:text-amber-400',
      )}
    >
      {enabled ? '已挂载' : '未挂载'}
    </span>
  );
}

function SkillCard({
  skill,
  packLabels,
  busy,
  disabled,
  compact,
  onDetail,
  onToggle,
  onJumpToPack,
}: {
  skill: DomainSkillItem;
  packLabels: Map<string, { label: string; count: number; enabled: boolean }>;
  busy: boolean;
  disabled?: boolean;
  compact?: boolean;
  onDetail: (skill: { name: string; description?: string }) => void;
  onToggle: (name: string, enabled: boolean) => void;
  onJumpToPack: (server: string) => void;
}) {
  const badges = skill.packServers
    .map((s) => (packLabels.has(s) ? { server: s, ...packLabels.get(s)! } : null))
    .filter((b): b is { server: string; label: string; count: number; enabled: boolean } => !!b);
  return (
    <div className={cn('rounded-md border bg-background p-2', compact && 'h-full flex flex-col')}>
      <div className="flex items-center gap-1.5 flex-wrap">
        <span className="text-xs font-semibold font-mono break-all">{skill.name}</span>
        {skill.badge && (
          <span className="text-[10px] px-1 py-0.5 rounded bg-muted text-muted-foreground shrink-0">
            {skill.badge}
          </span>
        )}
        <StatusBadge enabled={skill.enabled} />
        <div className="flex items-center gap-1 shrink-0 ml-auto">
          <button
            type="button"
            className="flex items-center gap-1 px-1.5 h-6 rounded text-xs text-muted-foreground hover:bg-muted/50 hover:text-foreground transition-colors"
            onClick={() => onDetail(skill)}
            title="查看 SKILL.md 全文"
          >
            <Eye className="w-3 h-3" />
            详情
          </button>
          <Switch
            checked={skill.enabled}
            disabled={busy || disabled}
            onCheckedChange={(v) => onToggle(skill.name, v)}
            aria-label={`${skill.enabled ? '取消挂载' : '挂载'} ${skill.name}`}
          />
        </div>
      </div>
      {badges.length > 0 && (
        <div className="flex items-center gap-1 flex-wrap mt-1">
          <span className="text-[10px] text-muted-foreground">随带工具包</span>
          {badges.map((b) => (
            <button
              key={b.server}
              type="button"
              className={cn(
                'text-[10px] px-1.5 py-0.5 rounded font-medium transition-opacity hover:opacity-75',
                b.enabled
                  ? 'bg-blue-50 dark:bg-blue-950 text-blue-700 dark:text-blue-400'
                  : 'bg-amber-50 dark:bg-amber-950 text-amber-700 dark:text-amber-400',
              )}
              onClick={() => onJumpToPack(b.server)}
              title={`定位工具包 ${b.label}${b.enabled ? '' : '（该包未启用）'}`}
            >
              {b.label} ×{b.count}
            </button>
          ))}
        </div>
      )}
      {skill.description && (
        <p className={cn('text-xs text-muted-foreground leading-relaxed mt-1', compact && 'flex-1')}>
          {skill.description}
        </p>
      )}
    </div>
  );
}

function PackPanel({
  pack,
  expanded,
  highlighted,
  onToggleExpand,
  onToolClick,
}: {
  pack: DomainPackItem;
  expanded: boolean;
  highlighted: boolean;
  onToggleExpand: () => void;
  onToolClick: (tool: { name: string; description: string }) => void;
}) {
  const count = pack.tools?.length ?? pack.toolCount;
  return (
    <div
      data-server={pack.server}
      className={cn(
        'rounded-md border bg-background overflow-hidden transition-shadow',
        highlighted && 'ring-2 ring-primary',
      )}
    >
      <button
        type="button"
        className="w-full flex items-center gap-2 px-3 py-1.5 bg-muted/30 text-left hover:bg-muted/50 transition-colors"
        onClick={onToggleExpand}
        aria-expanded={expanded}
      >
        <ChevronDown
          className={cn(
            'w-3.5 h-3.5 shrink-0 text-muted-foreground transition-transform',
            !expanded && '-rotate-90',
          )}
        />
        <span className="text-xs font-semibold truncate">{pack.label}</span>
        <span className="text-[10px] text-muted-foreground font-mono shrink-0 hidden sm:inline">
          {pack.server}
        </span>
        <span className="text-[10px] text-muted-foreground shrink-0 ml-auto">{count} 个</span>
        <StatusBadge enabled={pack.enabled} />
      </button>
      {expanded && (
        <div className="px-3 py-2 space-y-1.5 border-t border-border/40">
          <p className="text-xs text-muted-foreground/80 leading-relaxed">
            {pack.description}
            {pack.requirements && (
              <span className="text-muted-foreground/60">（{pack.requirements}）</span>
            )}
          </p>
          {pack.tools && pack.tools.length > 0 ? (
            <div className="divide-y divide-border/60 -mx-1">
              {pack.tools.map((t) => (
                <button
                  key={t.name}
                  type="button"
                  className="w-full flex items-start gap-2 px-1 py-1.5 text-left hover:bg-muted/30 transition-colors"
                  onClick={() => onToolClick(t)}
                >
                  <span className="text-xs font-mono text-foreground shrink-0">{t.name}</span>
                  <span className="text-xs text-muted-foreground leading-relaxed">
                    {t.shortDescription}
                  </span>
                </button>
              ))}
            </div>
          ) : (
            <p className="text-xs text-muted-foreground/70">
              会话启动后才会注册具体工具，此处暂无明细。
            </p>
          )}
        </div>
      )}
    </div>
  );
}

interface AbilityDomainCardProps {
  view: AbilityDomainView;
  busyKey: string | null;
  disabled?: boolean;
  expanded: boolean;
  onToggleExpand: () => void;
  expandedPacks: Record<string, boolean>;
  onTogglePackExpand: (server: string) => void;
  highlightServer: string | null;
  onSkillDetail: (skill: { name: string; description?: string }) => void;
  onToggleSkill: (name: string, enable: boolean) => void;
  onToggleDomain: (enable: boolean) => void;
  onToolClick: (tool: { name: string; description: string }) => void;
  onJumpToPack: (server: string) => void;
}

export function AbilityDomainCard({
  view,
  busyKey,
  disabled,
  expanded,
  onToggleExpand,
  expandedPacks,
  onTogglePackExpand,
  highlightServer,
  onSkillDetail,
  onToggleSkill,
  onToggleDomain,
  onToolClick,
  onJumpToPack,
}: AbilityDomainCardProps) {
  const domainBusy = busyKey === `domain:${view.id}`;
  const toolTotal = view.packs.reduce((sum, p) => sum + (p.tools?.length ?? p.toolCount), 0);
  const packLabels = new Map(
    view.packs.map((p) => [
      p.server,
      { label: p.label, count: p.tools?.length ?? p.toolCount, enabled: p.enabled },
    ]),
  );
  const showDomainToggle = view.skills.length > 1;

  return (
    <section
      data-domain={view.id}
      className="rounded-lg border bg-muted/10 overflow-hidden flex flex-col"
    >
      <div className="flex items-center gap-3 px-4 py-2.5 flex-wrap">
        <button
          type="button"
          className="flex items-center gap-2 flex-1 min-w-0 text-left"
          onClick={onToggleExpand}
          aria-expanded={expanded}
        >
          <ChevronDown
            className={cn(
              'w-4 h-4 shrink-0 text-muted-foreground transition-transform',
              !expanded && '-rotate-90',
            )}
          />
          <span className="text-sm font-semibold">{view.label}</span>
          <span className="text-xs text-muted-foreground hidden sm:inline">
            Skill {view.skills.filter((s) => s.enabled).length}/{view.skills.length}
            {view.packs.length > 0 && ` · 工具包 ${view.packs.length} 个 / ${toolTotal} 工具`}
          </span>
        </button>
        {showDomainToggle && (
          <div className="flex items-center gap-2 shrink-0">
            <span className="text-xs text-muted-foreground">整体</span>
            <Switch
              checked={view.allOn}
              disabled={domainBusy || disabled}
              onCheckedChange={(v) => onToggleDomain(v)}
              aria-label={`${view.label} 整体${view.allOn ? '关闭' : '开启'}`}
            />
          </div>
        )}
      </div>
      {expanded && (
        <div
          className={cn(
            'grid gap-3 px-4 pb-4 pt-1',
            view.packs.length > 0 ? 'md:grid-cols-2' : 'grid-cols-1',
          )}
        >
          <div
            className={cn(
              'space-y-1.5',
              view.packs.length === 0 &&
                'grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 space-y-0 gap-1.5',
            )}
          >
            {view.skills.map((s) => (
              <SkillCard
                key={s.name}
                skill={s}
                packLabels={packLabels}
                busy={busyKey === s.name || domainBusy}
                disabled={disabled}
                compact={view.packs.length === 0}
                onDetail={onSkillDetail}
                onToggle={onToggleSkill}
                onJumpToPack={onJumpToPack}
              />
            ))}
          </div>
          {view.packs.length > 0 && (
            <div className="space-y-2">
              <p className="text-[10px] text-muted-foreground">
                工具包随 Skill 挂载自动启用，无独立开关
              </p>
              {view.packs.map((p) => (
                <PackPanel
                  key={p.server}
                  pack={p}
                  expanded={!!expandedPacks[p.server]}
                  highlighted={highlightServer === p.server}
                  onToggleExpand={() => onTogglePackExpand(p.server)}
                  onToolClick={onToolClick}
                />
              ))}
            </div>
          )}
        </div>
      )}
    </section>
  );
}
