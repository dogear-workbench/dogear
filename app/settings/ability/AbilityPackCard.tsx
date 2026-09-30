import { cn } from '@/lib/utils';
import type { AbilityPackView } from '../../../electron/main/tipc/ability';
import { PACK_TYPE_LABELS } from './pack-meta';

interface AbilityPackCardProps {
  pack: AbilityPackView;
  enabled: boolean;
  onOpen: () => void;
}

export function AbilityPackCard({ pack, enabled, onOpen }: AbilityPackCardProps) {
  const stats = [
    pack.segments.length > 0 && `段 ${pack.segments.length}`,
    pack.toolGroupMetas.length > 0 && `工具组 ${pack.toolGroupMetas.length}`,
    pack.skillMetas.length > 0 && `Skill ${pack.skillMetas.length}`,
  ].filter(Boolean) as string[];

  return (
    <button
      type="button"
      onClick={onOpen}
      className="rounded-lg border bg-background p-4 text-left transition-colors hover:border-primary/50 hover:bg-muted/20 flex flex-col gap-2"
      aria-label={`打开 ${pack.label} 详情`}
    >
      <div className="flex items-start gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-base font-semibold truncate">{pack.label}</span>
            <span className="text-xs px-1.5 py-0.5 rounded bg-muted text-muted-foreground shrink-0">
              {PACK_TYPE_LABELS[pack.type]}
            </span>
          </div>
          <p className="text-xs text-muted-foreground leading-relaxed mt-0.5 line-clamp-2">
            {pack.description}
          </p>
        </div>
      </div>
      <div className="flex items-center gap-2 flex-wrap">
        {stats.map((s) => (
          <span key={s} className="text-xs text-muted-foreground bg-muted/40 rounded px-1.5 py-0.5">
            {s}
          </span>
        ))}
        {!enabled && (
          <span className={cn('text-xs px-1.5 py-0.5 rounded bg-amber-50 dark:bg-amber-950 text-amber-700 dark:text-amber-400')}>
            已关闭
          </span>
        )}
      </div>
    </button>
  );
}
