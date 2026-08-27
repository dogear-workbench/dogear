import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
import type { NoteMeta } from '@/types/note';

export function formatNoteTime(iso: string): string {
  return new Date(iso).toLocaleString('zh-CN', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

interface NoteCardItemProps {
  note: NoteMeta;
  active: boolean;
  onOpen: () => void;
}

export function NoteCardItem({ note, active, onOpen }: NoteCardItemProps) {
  const undoneCount = note.todos.filter((t) => t.status !== 'done').length;

  return (
    <button
      onClick={onOpen}
      className={cn('w-full text-left px-4 py-3 hover:bg-muted/30', active && 'bg-muted/50')}
    >
      <div className="flex items-center gap-2">
        <span className="text-xs text-muted-foreground shrink-0">{formatNoteTime(note.created)}</span>
        {note.todos.length > 0 && (
          <span
            className={cn(
              'text-xs shrink-0 tabular-nums',
              undoneCount > 0 ? 'text-amber-600' : 'text-muted-foreground',
            )}
            title="未完成/全部待办"
          >
            {undoneCount}/{note.todos.length}
          </span>
        )}
        <div className="flex-1 flex justify-end gap-1 flex-wrap min-w-0">
          {note.tags.map((tag) => (
            <Badge key={tag} variant="subtle" className="px-1.5 py-0 text-[10px] font-normal">
              {tag}
            </Badge>
          ))}
        </div>
      </div>
      <p className="mt-1 text-sm line-clamp-1">{note.title || '（无内容）'}</p>
    </button>
  );
}
