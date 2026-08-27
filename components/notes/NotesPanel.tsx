import { useEffect } from 'react';
import { Clock, ListTodo, Plus, Tags, Trash2, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { useNotesStore } from '@/stores/notes-store';
import { NoteEditor } from '@/components/notes/NoteEditor';
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

function NoteCardItem({ note, active, onOpen }: { note: NoteMeta; active: boolean; onOpen: () => void }) {
  const undoneCount = note.todos.filter((t) => t.status !== 'done').length;

  return (
    <button
      onClick={onOpen}
      className={cn('w-full text-left px-4 py-3 hover:bg-muted/30', active && 'bg-muted/50')}
    >
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
    </button>
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
  const activeNoteId = useNotesStore((s) => s.activeNoteId);
  const setActiveNoteId = useNotesStore((s) => s.setActiveNoteId);
  const createNote = useNotesStore((s) => s.createNote);

  const isActive = activeTabId === NOTES_TAB_ID;
  const workspacePath = workspace?.path ?? null;

  // 详情归属特定工作区的卡片，切工作区时关闭，避免跨区 id 悬空
  useEffect(() => {
    setActiveNoteId(null);
  }, [workspacePath, setActiveNoteId]);

  const handleCreate = () => {
    if (!workspace) return;
    void createNote(workspace.path);
  };

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

      <div
        className={cn(
          'flex flex-col min-w-0 min-h-0',
          activeNoteId ? 'w-72 shrink-0 border-r' : 'flex-1',
        )}
      >
        <div className="flex items-center justify-between gap-2 px-3 py-2 border-b shrink-0">
          <span className="text-xs font-medium text-muted-foreground">时间流</span>
          <Button
            variant="outline"
            size="xs"
            onClick={handleCreate}
            disabled={!workspace}
          >
            <Plus className="w-3 h-3" />
            新建卡片
          </Button>
        </div>
        <div className="flex-1 overflow-y-auto min-h-0">
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
                <NoteCardItem
                  key={note.id}
                  note={note}
                  active={note.id === activeNoteId}
                  onOpen={() => setActiveNoteId(note.id)}
                />
              ))}
            </div>
          )}
        </div>
      </div>

      {activeNoteId && workspace && (
        <NoteEditor
          key={activeNoteId}
          workspacePath={workspace.path}
          noteId={activeNoteId}
          onClose={() => setActiveNoteId(null)}
        />
      )}
    </div>
  );
}
