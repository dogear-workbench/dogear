import { ChevronDown } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Switch } from '@/components/ui/switch';
import type { ScenePackCell } from '../../../electron/main/tipc/ability-scene';
import type { PackToggleLinks } from '../ability/config-mutations';

interface SceneAbilityRowProps {
  cell: ScenePackCell;
  /** 状态徽标文案（父层算好）：可编辑行条件未满足提示 / 只读行装载状态 */
  badge: string | null;
  /** 行开关联动素材；缺省（联动表未就绪）时行开关禁用 */
  links: PackToggleLinks | undefined;
  /** skill 子开关写回素材就绪（skillToPacks 可用） */
  skillReady: boolean;
  expanded: boolean;
  onToggleExpanded: () => void;
  onPackToggle: (enable: boolean) => void;
  onSkillToggle: (name: string, enable: boolean) => void;
  onToolPackToggle: (id: string, enable: boolean) => void;
}

export function SceneAbilityRow({
  cell,
  badge,
  links,
  skillReady,
  expanded,
  onToggleExpanded,
  onPackToggle,
  onSkillToggle,
  onToolPackToggle,
}: SceneAbilityRowProps) {
  const subToggles = cell.subToggles;
  const expandable = !!subToggles && (subToggles.skills.length > 0 || subToggles.toolPacks.length > 0);
  const canToggle = cell.editable && !!links;

  return (
    <div className={cn('rounded-md border bg-background', !cell.editable && 'opacity-75')}>
      <div className="flex items-start gap-2.5 px-3 py-2">
        {expandable ? (
          <button
            type="button"
            className="mt-1 shrink-0"
            aria-expanded={expanded}
            aria-label={expanded ? `收起 ${cell.label} 子开关` : `展开 ${cell.label} 子开关`}
            onClick={onToggleExpanded}
          >
            <ChevronDown
              className={cn('w-4 h-4 text-muted-foreground transition-transform', !expanded && '-rotate-90')}
            />
          </button>
        ) : (
          <span className="w-4 shrink-0" />
        )}
        <Switch
          className="mt-0.5 shrink-0"
          checked={cell.enabled}
          disabled={!canToggle}
          onCheckedChange={onPackToggle}
          aria-label={`${cell.enabled ? '关闭' : '开启'} ${cell.label}`}
        />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-medium">{cell.label}</span>
            {badge && (
              <span
                className={cn(
                  'text-xs px-1.5 py-0.5 rounded shrink-0',
                  badge === '固定装载' || badge === '已装载'
                    ? 'bg-emerald-50 dark:bg-emerald-950 text-emerald-700 dark:text-emerald-400'
                    : 'bg-muted text-muted-foreground',
                )}
              >
                {badge}
              </span>
            )}
            {expandable && (
              <span className="text-xs text-muted-foreground/70">
                {subToggles!.skills.length > 0 && `Skill ${subToggles!.skills.length}`}
                {subToggles!.skills.length > 0 && subToggles!.toolPacks.length > 0 && ' · '}
                {subToggles!.toolPacks.length > 0 && `工具组 ${subToggles!.toolPacks.length}`}
              </span>
            )}
          </div>
          <p className="text-xs text-muted-foreground leading-relaxed mt-0.5">{cell.reason}</p>
        </div>
      </div>

      {expanded && expandable && (
        <div className="border-t border-border/60 bg-muted/10 px-3 py-2 space-y-2.5">
          {subToggles!.skills.length > 0 && (
            <div className="space-y-1.5">
              <p className="text-xs font-medium text-muted-foreground">Skill</p>
              <div className="flex flex-wrap gap-1.5">
                {subToggles!.skills.map((skill) => (
                  <button
                    key={skill.name}
                    type="button"
                    aria-pressed={skill.enabled}
                    disabled={!skillReady}
                    title={skill.title ?? skill.name}
                    onClick={() => onSkillToggle(skill.name, !skill.enabled)}
                    className={cn(
                      'rounded-full border px-2.5 py-0.5 text-xs transition-colors',
                      skill.enabled
                        ? 'border-primary/60 bg-primary/10 text-foreground'
                        : 'border-border text-muted-foreground hover:border-primary/40 hover:text-foreground',
                      !skillReady && 'pointer-events-none opacity-50',
                    )}
                  >
                    {skill.title ?? skill.name}
                  </button>
                ))}
              </div>
            </div>
          )}
          {subToggles!.toolPacks.length > 0 && (
            <div className="space-y-1">
              <p className="text-xs font-medium text-muted-foreground">工具包</p>
              {subToggles!.toolPacks.map((tp) => {
                const bundled = !!links && !links.linkedPackIds.includes(tp.id);
                return (
                  <div key={tp.id} className="flex items-center gap-2.5 py-0.5">
                    <Switch
                      className="shrink-0"
                      checked={tp.enabled}
                      disabled={bundled}
                      onCheckedChange={(v) => onToolPackToggle(tp.id, v)}
                      aria-label={`${tp.enabled ? '关闭' : '开启'} ${tp.label}`}
                    />
                    <div className="flex items-center gap-1.5 min-w-0 flex-wrap">
                      <span className="text-xs font-medium">{tp.label}</span>
                      {bundled && (
                        <span className="text-xs text-muted-foreground/70">随包整体装载，无独立开关</span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
