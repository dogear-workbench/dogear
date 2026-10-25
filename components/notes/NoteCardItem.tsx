import { Bot, Trash2, MessagesSquare } from 'lucide-react';
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
  const hoverBtn = 'opacity-0 pointer-events-none group-hover:opacity-100 group-hover:pointer-events-auto transition-opacity';
  return (
    <div
      role="button"
      tabIndex={0}
      data-note-id={note.id}
      onClick={onOpen}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onOpen();
        }
      }}
      className={cn(
        'group text-left mx-1 rounded-sm px-3 py-2.5 cursor-pointer transition-colors focus-visible:outline-none',
        active ? 'bg-blue-100 dark:bg-blue-900/30' : 'hover:bg-muted/30',
      )}
    >
      <div className="flex items-center gap-1">
        <p className={cn('min-w-0 flex-1 truncate text-sm font-medium', active && 'text-blue-700 dark:text-blue-300')} title={title}>
          {title}
        </p>
        {note.source && (
          <span className="shrink-0 text-muted-foreground" title="Agent 转存">
            <Bot className="h-3 w-3" />
          </span>
        )}
      </div>
      <div className="mt-1 flex items-center gap-1 text-xs text-muted-foreground min-w-0">
        <span className="shrink-0" title={`创建于 ${formatNoteTime(note.created)}`}>
          {getRelativeTime(new Date(note.created).getTime())}
        </span>
        {note.source && (
          <span
            className="min-w-0 truncate"
            title={`来自会话「${note.source.title || '未命名会话'}」`}
          >
            {note.source.title || '未命名会话'}
          </span>
        )}
        <span className={cn('ml-auto flex items-center gap-0.5 shrink-0', hoverBtn)}>
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
  );
}
