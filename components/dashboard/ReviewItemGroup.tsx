import { cn } from '@/lib/utils';
import type { ReviewItem } from '@/stores/dashboard-store';

const KIND_STYLE: Record<string, string> = {
  '悬而未决': 'text-amber-600 dark:text-amber-500',
  '未闭环': 'text-rose-600 dark:text-rose-500',
  '反复出现': 'text-violet-600 dark:text-violet-500',
  '已否决': 'text-muted-foreground',
};

interface ReviewItemGroupProps {
  kind: string;
  items: ReviewItem[];
}

export function ReviewItemGroup({ kind, items }: ReviewItemGroupProps) {
  const kindColor = KIND_STYLE[kind] ?? 'text-muted-foreground';

  return (
    <div className="space-y-1.5">
      <div className="flex items-center gap-2">
        <span className={cn('text-xs font-semibold uppercase tracking-wide', kindColor)}>
          {kind}
        </span>
        <span className="text-xs text-muted-foreground bg-muted px-1.5 py-0.5 rounded-full">
          {items.length}
        </span>
      </div>
      <ul className="space-y-1">
        {items.map((item, i) => {
          const refTitles = item.refs.map((r) => r.sessionId.slice(0, 8)).join(', ');
          return (
            <li
              key={i}
              className="flex items-start justify-between gap-3 rounded-md px-3 py-2 bg-muted/40 hover:bg-muted/70 transition-colors"
            >
              <span className="text-sm text-foreground leading-snug flex-1">{item.text}</span>
              {item.refs.length > 0 && (
                <span
                  className="text-xs text-muted-foreground whitespace-nowrap shrink-0 mt-0.5"
                  title={refTitles}
                >
                  {item.refs.length} 处来源
                </span>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
