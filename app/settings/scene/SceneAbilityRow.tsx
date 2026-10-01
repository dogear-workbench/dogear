import { ChevronDown } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Switch } from '@/components/ui/switch';
import type { ScenePackCell } from '../../../electron/main/tipc/ability-scene';
import type { PackToggleLinks } from '../ability/config-mutations';

interface SceneAbilityRowProps {
  cell: ScenePackCell;
  /** 状态徽标文案（父层算好）：开关开着但最终没装配时提示 */
  badge: string | null;
  /** 行开关联动素材；缺省（联动表未就绪）时行开关禁用 */
  links: PackToggleLinks | undefined;
  /** skill 子开关写回素材就绪（skillToPacks 可用） */
  skillReady: boolean;
  expanded: boolean;
  onToggleExpanded: () => void;
  onPackToggle: (enable: boolean) => void;
  onSkillToggle: (name: string, enable: boolean) => void;
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
}: SceneAbilityRowProps) {
  const subToggles = cell.state === 'switchable' ? cell.subToggles : undefined;
  const expandable = !!subToggles && subToggles.skills.length > 0;
  const canToggle = cell.state === 'switchable' && !!links;

  return (
    <div className={cn('rounded-md border bg-background', cell.state === 'excluded' && 'opacity-60')}>
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
        {cell.state === 'switchable' ? (
          <Switch
            className="mt-0.5 shrink-0"
            checked={cell.enabled}
            disabled={!canToggle}
            onCheckedChange={onPackToggle}
            aria-label={`${cell.enabled ? '关闭' : '开启'} ${cell.label}`}
          />
        ) : (
          <span
            className={cn(
              'mt-0.5 shrink-0 rounded px-1.5 py-0.5 text-xs',
              cell.state === 'forced'
                ? 'bg-amber-50 dark:bg-amber-950 text-amber-700 dark:text-amber-400'
                : 'bg-muted text-muted-foreground',
            )}
          >
            {cell.state === 'forced' ? '强制' : '排除'}
          </span>
        )}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className={cn('text-sm font-medium', cell.state === 'excluded' && 'text-muted-foreground')}>
              {cell.label}
            </span>
            {badge && (
              <span className="text-xs px-1.5 py-0.5 rounded shrink-0 bg-muted text-muted-foreground">{badge}</span>
            )}
            {expandable && <span className="text-xs text-muted-foreground/70">Skill {subToggles!.skills.length}</span>}
          </div>
          <p className="text-xs text-muted-foreground leading-relaxed mt-0.5">{cell.reason}</p>
        </div>
      </div>

      {expanded && expandable && (
        <div className="border-t border-border/60 bg-muted/10 px-3 py-2 space-y-1.5">
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
    </div>
  );
}
