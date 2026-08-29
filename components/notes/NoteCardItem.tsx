import { Trash2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
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
  onDelete?: () => void;
}

export function NoteCardItem({ note, active, onOpen, onDelete }: NoteCardItemProps) {
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onOpen();
        }
      }}
      className={cn(
        'group w-full text-left px-4 py-3 hover:bg-muted/30 cursor-pointer focus-visible:outline-none',
        active && 'bg-muted/50',
      )}
    >
      <div className="flex items-start gap-2">
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium line-clamp-1">{note.title || '（无标题）'}</p>
          <div className="mt-1 flex items-center gap-1.5 flex-wrap min-w-0">
            <span className="text-xs text-muted-foreground shrink-0">{formatNoteTime(note.created)}</span>
            {note.tags.map((tag) => (
              <Badge key={tag} variant="subtle" className="px-1.5 py-0 text-[10px] font-normal">
                {tag}
              </Badge>
            ))}
          </div>
        </div>
        <div className="flex gap-0.5 shrink-0">
          {onDelete && (
            <Button
              variant="ghost"
              size="icon-xs"
              onClick={(e) => {
                e.stopPropagation();
                onDelete();
              }}
              title="移入回收站"
              className="opacity-0 group-hover:opacity-100"
            >
              <Trash2 className="w-3.5 h-3.5" />
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
