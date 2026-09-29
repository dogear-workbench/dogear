import { toast } from 'sonner';
import { useNotesStore } from '@/stores/notes-store';
import { useWorkspaceStore } from '@/stores/workspace-store';
import { cn } from '@/lib/utils';
import { NoteEditor } from '@/components/notes/NoteEditor';
import { NoteCardItem } from '@/components/notes/NoteCardItem';
import { NoteEmpty, NoteLoading } from '@/components/notes/NoteState';
import { showConfirm } from '@/stores/confirm-store';
import { referenceNoteIntoFocus } from '@/lib/reference-guard';
import type { NoteFilter } from '@/components/notes/NotesPanel';
import type { NoteMeta } from '@/types/note';

interface NotesTimelinePaneProps {
  listHidden: boolean;
  onToggleListHidden: () => void;
  filter: NoteFilter | null;
  filterResults: NoteMeta[];
  filterLoading: boolean;
}

export function NotesTimelinePane({
  listHidden,
  onToggleListHidden,
  filter,
  filterResults,
  filterLoading,
}: NotesTimelinePaneProps) {
  const workspace = useWorkspaceStore((s) => s.workspace);
  const notes = useNotesStore((s) => s.notes);
  const loading = useNotesStore((s) => s.loading);
  const activeNoteId = useNotesStore((s) => s.activeNoteId);
  const setActiveNoteId = useNotesStore((s) => s.setActiveNoteId);
  const deleteNote = useNotesStore((s) => s.deleteNote);

  const handleDelete = async (note: NoteMeta) => {
    if (!workspace) return;
    const ok = await showConfirm(
      '移入回收站',
      `「${note.title || '（无内容）'}」将移入回收站，可从回收站恢复。`,
    );
    if (!ok) return;
    const success = await deleteNote(workspace.id, note.id);
    if (!success) {
      toast.error('移入回收站失败', { description: `卡片 ${note.id} 未删除，请重试或查看日志` });
      return;
    }
    if (note.id === activeNoteId) setActiveNoteId(null);
  };

  const handleReference = (note: NoteMeta) => {
    if (!workspace) return;
    void referenceNoteIntoFocus({ noteId: note.id, title: note.title, workspaceId: workspace.id });
  };

  const renderItem = (note: NoteMeta) => (
    <NoteCardItem
      key={note.id}
      note={note}
      active={note.id === activeNoteId}
      onOpen={() => setActiveNoteId(note.id)}
      onDelete={() => void handleDelete(note)}
      onReference={() => handleReference(note)}
    />
  );

  const renderTimeline = () => {
    if (filter) {
      if (filterLoading && filterResults.length === 0) return <NoteLoading />;
      if (filterResults.length === 0) return <NoteEmpty text="无匹配结果" />;
      return <div className="divide-y">{filterResults.map(renderItem)}</div>;
    }
    if (loading) return <NoteLoading />;
    if (notes.length === 0) return <NoteEmpty text="暂无笔记" />;
    return <div className="divide-y">{notes.map(renderItem)}</div>;
  };

  if (!workspace) {
    return (
      <div className="flex-1 flex items-center justify-center text-sm text-muted-foreground">
        请先选择工作区
      </div>
    );
  }

  return (
    <div className="flex-1 flex min-h-0">
      <aside
        className={cn(
          'flex flex-col min-h-0 shrink-0 overflow-hidden transition-[width] duration-200',
          listHidden ? 'w-0 border-r-0' : 'w-[300px] border-r',
        )}
      >
        <div className="flex-1 overflow-y-auto min-h-0">{renderTimeline()}</div>
      </aside>

      <div
        className="w-1 shrink-0 cursor-col-resize group/sep relative flex items-center justify-center"
        onDoubleClick={onToggleListHidden}
        title="双击隐藏/显示列表（Ctrl+\\）"
      >
        <div className="w-px h-full bg-border group-hover/sep:bg-primary/50 transition-colors" />
      </div>

      <section className="flex-1 min-w-0 min-h-0 flex flex-col">
        {activeNoteId ? (
          <NoteEditor
            key={activeNoteId}
            workspaceId={workspace.id}
            noteId={activeNoteId}
            onClose={() => setActiveNoteId(null)}
            onDelete={() => {
              const meta = notes.find((n) => n.id === activeNoteId);
              if (meta) void handleDelete(meta);
            }}
          />
        ) : (
          <div className="flex-1 flex items-center justify-center text-sm text-muted-foreground">
            {loading ? '加载中…' : '选择左侧卡片，或新建一张'}
          </div>
        )}
      </section>
    </div>
  );
}
