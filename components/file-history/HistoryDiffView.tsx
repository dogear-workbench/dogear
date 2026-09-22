import { cn } from '@/lib/utils';
import type { DiffRow } from '@/lib/line-diff';

const MAX_RENDER_ROWS = 5000;

export function HistoryDiffView({ rows }: { rows: DiffRow[] }) {
  const shown = rows.slice(0, MAX_RENDER_ROWS);
  const truncated = rows.length > MAX_RENDER_ROWS;
  return (
    <div className="font-mono text-xs leading-5">
      {shown.map((row, i) => (
        <div
          key={i}
          className={cn(
            'flex rounded-sm',
            row.type === 'add' && 'bg-green-500/10',
            row.type === 'del' && 'bg-red-500/10',
          )}
        >
          <span className="w-10 shrink-0 select-none pr-1.5 text-right text-muted-foreground/50">
            {row.oldNo ?? ''}
          </span>
          <span className="w-10 shrink-0 select-none pr-1.5 text-right text-muted-foreground/50">
            {row.newNo ?? ''}
          </span>
          <span
            className={cn(
              'w-4 shrink-0 select-none text-center',
              row.type === 'add' && 'text-green-600 dark:text-green-400',
              row.type === 'del' && 'text-red-600 dark:text-red-400',
            )}
          >
            {row.type === 'add' ? '+' : row.type === 'del' ? '-' : ' '}
          </span>
          <span className="flex-1 min-w-0 whitespace-pre-wrap break-all">{row.text}</span>
        </div>
      ))}
      {truncated && (
        <div className="py-2 text-center text-muted-foreground">
          差异过大，仅显示前 {MAX_RENDER_ROWS} 行
        </div>
      )}
    </div>
  );
}
