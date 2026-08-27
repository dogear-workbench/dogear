import { useEffect } from 'react';
import { Clock, ListTodo, Tags, Trash2, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
import { useNotesStore } from '@/stores/notes-store';
import { useSessionStore, NOTES_TAB_ID } from '@/stores/session-store';
import { useWorkspaceStore } from '@/stores/workspace-store';
import type { NoteMeta } from '@/types/note';

const VIEWS = [
  { id: 'timeline', label: '时间流', icon: Clock },
  { id: 'todos', label: '待办', icon: ListTodo },
  { id: 'tags', label: '标签', icon: Tags },
  { id: 'trash', label: '回收站', icon: Trash2 },
] as const;

function formatTime(iso: string): string {
  return new Date(iso).toLocaleString('zh-CN', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function NoteCardItem({ note }: { note: NoteMeta }) {
  const undoneCount = note.todos.filter((t) => t.status !== 'done').length;

  return (
    <div className="px-4 py-3 hover:bg-muted/30">
      <div className="flex items-center gap-2">
        <span className="text-xs text-muted-foreground shrink-0">{formatTime(note.created)}</span>
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
    </div>
  );
}

export function NotesPanel() {
  const activeTabId = useSessionStore((s) => s.activeTabId);
  const workspace = useWorkspaceStore((s) => s.workspace);
  const notes = useNotesStore((s) => s.notes);
  const loading = useNotesStore((s) => s.loading);
  const loadedWorkspacePath = useNotesStore((s) => s.loadedWorkspacePath);
  const loadNotes = useNotesStore((s) => s.loadNotes);
  const subscribeNotesChanged = useNotesStore((s) => s.subscribeNotesChanged);

  const isActive = activeTabId === NOTES_TAB_ID;

  useEffect(() => {
    return subscribeNotesChanged();
  }, [subscribeNotesChanged]);

  useEffect(() => {
    if (!isActive || !workspace || loadedWorkspacePath === workspace.path) return;
    void loadNotes(workspace.path);
  }, [isActive, workspace, loadedWorkspacePath, loadNotes]);

  return (
    <div className="flex-1 flex min-h-0">
      <nav className="w-20 border-r bg-muted/30 flex flex-col items-center gap-1 py-3 shrink-0">
        {VIEWS.map(({ id, label, icon: Icon }) => {
          const enabled = id === 'timeline';
          return (
            <button
              key={id}
              disabled={!enabled}
              title={label}
              className={cn(
                'flex flex-col items-center gap-1 px-2 py-2 rounded-md text-xs w-16',
                enabled
                  ? 'bg-background shadow-sm font-medium text-foreground cursor-pointer'
                  : 'text-muted-foreground/50 cursor-not-allowed',
              )}
            >
              <Icon className="w-4 h-4" />
              <span>{label}</span>
            </button>
          );
        })}
      </nav>

      <div className="flex-1 overflow-y-auto min-w-0">
        {loading ? (
          <div className="h-full flex items-center justify-center">
            <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
          </div>
        ) : notes.length === 0 ? (
          <div className="h-full flex items-center justify-center text-sm text-muted-foreground">
            暂无笔记
          </div>
        ) : (
          <div className="divide-y">
            {notes.map((note) => (
              <NoteCardItem key={note.id} note={note} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
