import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

interface BadgeConfig {
  text?: string;
  variant?: 'resident' | 'conditional' | 'optional';
}

interface AbilityCardProps {
  title: string;
  badge?: BadgeConfig;
  leftContent: ReactNode;
  rightContent?: ReactNode;
  actions?: ReactNode;
}

const BADGE_STYLES: Record<NonNullable<BadgeConfig['variant']>, string> = {
  resident:
    'bg-emerald-50 dark:bg-emerald-950 text-emerald-700 dark:text-emerald-400',
  conditional:
    'bg-blue-50 dark:bg-blue-950 text-blue-700 dark:text-blue-400',
  optional:
    'bg-amber-50 dark:bg-amber-950 text-amber-700 dark:text-amber-400',
};

const BADGE_LABEL: Record<NonNullable<BadgeConfig['variant']>, string> = {
  resident: '常驻',
  conditional: '条件挂载',
  optional: '可选',
};

export function AbilityCard({
  title,
  badge,
  leftContent,
  rightContent,
  actions,
}: AbilityCardProps) {
  const variant = badge?.variant ?? 'optional';
  return (
    <section className="border rounded-lg p-4 space-y-3 bg-background">
      <header className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2 flex-wrap">
          <h3 className="text-sm font-semibold">{title}</h3>
          {badge && (
            <span
              className={cn(
                'text-[10px] px-1.5 py-0.5 rounded font-medium',
                BADGE_STYLES[variant],
              )}
            >
              {badge.text ?? BADGE_LABEL[variant]}
            </span>
          )}
        </div>
        {actions && <div className="flex items-center gap-2">{actions}</div>}
      </header>

      <div className="flex flex-col md:flex-row gap-4">
        <div className="md:min-w-[40%] md:flex-[2] min-w-0 space-y-3">
          {leftContent}
        </div>
        {rightContent && (
          <div className="md:flex-1 min-w-0 space-y-2">{rightContent}</div>
        )}
      </div>
    </section>
  );
}
