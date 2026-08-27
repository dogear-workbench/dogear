import { useMemo } from 'react';
import { Badge } from '@/components/ui/badge';
import { NoteEmpty } from '@/components/notes/NoteState';
import { useNotesStore } from '@/stores/notes-store';

interface TagsViewProps {
  onPickTag: (tag: string) => void;
}

export function TagsView({ onPickTag }: TagsViewProps) {
  const notes = useNotesStore((s) => s.notes);

  const tagCounts = useMemo(() => {
    const map = new Map<string, number>();
    for (const note of notes) {
      for (const tag of note.tags) map.set(tag, (map.get(tag) ?? 0) + 1);
    }
    return [...map.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  }, [notes]);

  if (tagCounts.length === 0) {
    return <NoteEmpty text="暂无标签" />;
  }

  return (
    <div className="flex-1 overflow-y-auto min-h-0 divide-y">
      {tagCounts.map(([tag, count]) => (
        <button
          key={tag}
          onClick={() => onPickTag(tag)}
          className="w-full flex items-center justify-between gap-2 px-4 py-2.5 hover:bg-muted/30"
        >
          <Badge variant="subtle" className="font-normal max-w-48 min-w-0">
            <span className="truncate">{tag}</span>
          </Badge>
          <span className="text-xs text-muted-foreground tabular-nums shrink-0">{count} 张卡片</span>
        </button>
      ))}
    </div>
  );
}
