import { useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { DiffFold, DiffRow, HunkSection } from '@/lib/line-diff';

const MAX_RENDER_ROWS = 5000;

type RenderUnit =
  | { kind: 'row'; row: DiffRow }
  | { kind: 'fold'; index: number; fold: DiffFold };

function DiffRowView({ row }: { row: DiffRow }) {
  return (
    <div
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
  );
}

export function HistoryDiffView({ sections }: { sections: HunkSection[] }) {
  const [expanded, setExpanded] = useState<ReadonlySet<number>>(() => new Set());

  const toggleFold = (index: number) => {
    setExpanded(prev => {
      const next = new Set(prev);
      if (next.has(index)) {
        next.delete(index);
      } else {
        next.add(index);
      }
      return next;
    });
  };

  const units: RenderUnit[] = [];
  for (let i = 0; i < sections.length; i++) {
    const s = sections[i];
    if ('kind' in s) {
      if (expanded.has(i)) {
        for (const row of s.rows) units.push({ kind: 'row', row });
      } else {
        units.push({ kind: 'fold', index: i, fold: s });
      }
    } else {
      units.push({ kind: 'row', row: s });
    }
  }

  const shown = units.slice(0, MAX_RENDER_ROWS);
  const truncated = units.length > MAX_RENDER_ROWS;

  return (
    <div className="font-mono text-xs leading-5">
      {shown.map((u, i) =>
        u.kind === 'row' ? (
          <DiffRowView key={i} row={u.row} />
        ) : (
          <button
            key={`fold-${u.index}`}
            className="flex w-full items-center gap-1.5 rounded-sm py-0.5 text-muted-foreground hover:bg-muted/60 hover:text-foreground transition-colors"
            onClick={() => toggleFold(u.index)}
          >
            {expanded.has(u.index) ? (
              <ChevronDown className="w-3.5 h-3.5 shrink-0" />
            ) : (
              <ChevronRight className="w-3.5 h-3.5 shrink-0" />
            )}
            <span>⋯ 省略 {u.fold.count} 行</span>
          </button>
        ),
      )}
      {truncated && (
        <div className="py-2 text-center text-muted-foreground">
          差异过大，仅显示前 {MAX_RENDER_ROWS} 行
        </div>
      )}
    </div>
  );
}
