import { useMemo } from 'react';
import { Check, Hash } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { useNotesStore } from '@/stores/notes-store';

interface TagFilterMenuProps {
  selected: string | null;
  onToggle: (tag: string) => void;
}

export function TagFilterMenu({ selected, onToggle }: TagFilterMenuProps) {
  const notes = useNotesStore((s) => s.notes);

  const entries = useMemo(() => {
    const counts = new Map<string, number>();
    for (const note of notes) {
      for (const tag of note.tags) counts.set(tag, (counts.get(tag) ?? 0) + 1);
    }
    return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  }, [notes]);

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          title="按标签过滤"
          className={cn(
            'h-7 w-7 p-0 shrink-0 text-muted-foreground hover:text-foreground',
            selected && 'text-primary hover:text-primary',
          )}
        >
          <Hash className="w-3.5 h-3.5" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-56 p-1">
        {entries.length === 0 ? (
          <div className="px-2 py-3 text-xs text-muted-foreground text-center">暂无标签</div>
        ) : (
          <div className="max-h-64 overflow-y-auto">
            {entries.map(([tag, count]) => (
              <button
                key={tag}
                onClick={() => onToggle(tag)}
                className={cn(
                  'flex w-full items-center gap-1.5 rounded px-2 py-1.5 text-xs cursor-pointer text-left',
                  selected === tag
                    ? 'bg-muted/60 font-medium text-foreground'
                    : 'hover:bg-muted/40 text-foreground/80',
                )}
              >
                <span className="truncate" title={tag}>
                  {tag}
                </span>
                <span className="ml-auto shrink-0 tabular-nums text-muted-foreground">{count}</span>
                {selected === tag && <Check className="w-3 h-3 shrink-0 text-primary" />}
              </button>
            ))}
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}
