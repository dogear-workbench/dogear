import { useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { Plus } from 'lucide-react';
import { useNotesStore } from '@/stores/notes-store';
import { useWorkspaceStore } from '@/stores/workspace-store';
import { useUIStore } from '@/stores/ui-store';
import { cn } from '@/lib/utils';
import { useNotesListDrag } from '@/hooks/use-panel-linkage';
import { NoteEditor } from '@/components/notes/NoteEditor';
import { NoteCardItem } from '@/components/notes/NoteCardItem';
import { NoteEmpty, NoteLoading } from '@/components/notes/NoteState';
import { CollapsibleSection } from '@/components/notes/CollapsibleSection';
import { currentMonthKey, groupByMonth, monthKey } from '@/components/notes/month-grouping';
import { showConfirm } from '@/stores/confirm-store';
import { referenceNoteIntoFocus } from '@/lib/reference-guard';
import type { NoteMeta } from '@/types/note';

export function NotesTimelinePane() {
  const workspace = useWorkspaceStore((s) => s.workspace);
  const notes = useNotesStore((s) => s.notes);
  const loading = useNotesStore((s) => s.loading);
  const activeNoteId = useNotesStore((s) => s.activeNoteId);
  const setActiveNoteId = useNotesStore((s) => s.setActiveNoteId);
  const createNote = useNotesStore((s) => s.createNote);
  const deleteNote = useNotesStore((s) => s.deleteNote);
  const listHidden = useUIStore((s) => s.notesListHidden);
  const notesListWidth = useUIStore((s) => s.notesListWidth);
  const widthDrag = useNotesListDrag();

  const scrollRef = useRef<HTMLDivElement>(null);
  const [monthOverrides, setMonthOverrides] = useState<Record<string, boolean>>({});
  const lastLocatedNoteId = useRef<string | null>(null);

  useEffect(() => {
    if (!activeNoteId || lastLocatedNoteId.current === activeNoteId) return;
    lastLocatedNoteId.current = activeNoteId;
    const note = notes.find((n) => n.id === activeNoteId);
    if (!note) return;
    const key = monthKey(note.updated);
    const collapsed = key !== currentMonthKey() && (monthOverrides[key] ?? true);
    if (collapsed) setMonthOverrides((m) => ({ ...m, [key]: true }));
    const timer = window.setTimeout(
      () => {
        scrollRef.current
          ?.querySelector(`[data-note-id="${CSS.escape(activeNoteId)}"]`)
          ?.scrollIntoView({ block: 'nearest' });
      },
      collapsed ? 80 : 0,
    );
    return () => window.clearTimeout(timer);
  }, [activeNoteId, notes, monthOverrides]);

  const handleCreate = () => {
    if (!workspace) return;
    void createNote(workspace.id).then((note) => {
      if (note) setActiveNoteId(note.id);
    });
  };

  const handleDelete = async (note: NoteMeta) => {
    if (!workspace) return;
    const ok = await showConfirm(
      '移入回收站',
      `「${note.title || '（无内容）'}」将移入回收站，可在 归档·回收站 恢复。`,
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
    if (loading) return <NoteLoading />;
    if (notes.length === 0) return <NoteEmpty text="暂无笔记" />;
    // 按 updated 分月，当月平铺、历史月折叠（折叠态为会话内 state，不持久化）
    const currentKey = currentMonthKey();
    return groupByMonth(notes, (n) => n.updated).map((month) =>
      month.key === currentKey ? (
        <div key={month.key}>{month.items.map(renderItem)}</div>
      ) : (
        <CollapsibleSection
          key={month.key}
          label={month.label}
          count={month.items.length}
          collapsed={monthOverrides[month.key] ?? true}
          onToggle={() =>
            setMonthOverrides((m) => ({ ...m, [month.key]: !(m[month.key] ?? true) }))
          }
        >
          {month.items.map(renderItem)}
        </CollapsibleSection>
      ),
    );
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
          'relative flex flex-col min-h-0 shrink-0 overflow-hidden border-r transition-[width] duration-200',
          widthDrag.dragging && 'transition-none',
          listHidden && 'border-r-0',
        )}
        style={{ width: listHidden ? 0 : notesListWidth }}
      >
        <div ref={scrollRef} className="flex-1 overflow-y-auto min-h-0">
          <button
            onClick={handleCreate}
            disabled={!workspace}
            className="sticky top-0 z-10 w-full flex items-center gap-2 px-4 py-2.5 text-xs text-muted-foreground bg-background border-b hover:bg-muted/30 hover:text-foreground cursor-pointer disabled:cursor-default"
          >
            <Plus className="w-3.5 h-3.5" />
            新建笔记
          </button>
          {renderTimeline()}
        </div>
        {!listHidden && (
          <div
            className="absolute right-0 top-0 bottom-0 w-[3px] z-10 cursor-col-resize hover:bg-primary/40"
            onMouseDown={widthDrag.startDrag}
          />
        )}
      </aside>

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
