import { Trash2, MessagesSquare } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { getRelativeTime } from '@/components/conversation-list/utils';
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
  /** 有值时 hover 区显示「引用进会话」按钮（回收站等场景不传） */
  onReference?: () => void;
}

export function NoteCardItem({ note, active, onOpen, onDelete, onReference }: NoteCardItemProps) {
  const title = note.title || '（无标题）';
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
      <div className="min-w-0">
        <p className="text-sm font-medium truncate" title={title}>
          {title}
        </p>
        <div className="mt-0.5 flex items-center gap-1 text-xs text-muted-foreground min-w-0">
          <span className="shrink-0">{getRelativeTime(new Date(note.created).getTime())}</span>
          {note.source && (
            <span
              className="min-w-0 truncate"
              title={`来自会话「${note.source.title || '未命名会话'}」`}
            >
              {note.source.title || '未命名会话'}
            </span>
          )}
          <span className="ml-auto flex items-center gap-0.5 opacity-0 pointer-events-none group-hover:opacity-100 group-hover:pointer-events-auto transition-opacity shrink-0">
            {onReference && (
              <Button
                variant="ghost"
                size="icon-xs"
                onClick={(e) => {
                  e.stopPropagation();
                  onReference();
                }}
                title="引用到最近的会话"
              >
                <MessagesSquare className="w-3.5 h-3.5" />
              </Button>
            )}
            {onDelete && (
              <Button
                variant="ghost"
                size="icon-xs"
                onClick={(e) => {
                  e.stopPropagation();
                  onDelete();
                }}
                title="移入回收站"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </Button>
            )}
          </span>
        </div>
      </div>
    </div>
  );
}
