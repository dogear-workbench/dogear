import { useCallback, useEffect, useRef, useState } from 'react';
import { Clock, ListTodo, Loader2, Plus, Search, Tags, Trash2, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { client } from '@/lib/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useNotesStore } from '@/stores/notes-store';
import { NoteEditor } from '@/components/notes/NoteEditor';
import { NoteCardItem } from '@/components/notes/NoteCardItem';
import { NoteEmpty, NoteLoading } from '@/components/notes/NoteState';
import { TodosView } from '@/components/notes/TodosView';
import { TagsView } from '@/components/notes/TagsView';
import { TrashView } from '@/components/notes/TrashView';
import { useSessionStore, NOTES_TAB_ID } from '@/stores/session-store';
import { useWorkspaceStore } from '@/stores/workspace-store';
import type { NoteMeta } from '@/types/note';

const VIEWS = [
  { id: 'timeline', label: '时间流', icon: Clock },
  { id: 'todos', label: '待办', icon: ListTodo },
  { id: 'tags', label: '标签', icon: Tags },
  { id: 'trash', label: '回收站', icon: Trash2 },
] as const;

type NotesView = (typeof VIEWS)[number]['id'];

interface NoteFilter {
  query?: string;
  tag?: string;
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

  const [view, setView] = useState<NotesView>('timeline');
  const [searchDraft, setSearchDraft] = useState('');
  const [filter, setFilter] = useState<NoteFilter | null>(null);
  const [filterResults, setFilterResults] = useState<NoteMeta[]>([]);
  const [filterLoading, setFilterLoading] = useState(false);
  const searchSeqRef = useRef(0);
  const activeQueryRef = useRef<string | null>(null);

  const isActive = activeTabId === NOTES_TAB_ID;
  const workspacePath = workspace?.path ?? null;

  // 详情归属特定工作区的卡片，切工作区时关闭，避免跨区 id 悬空
  useEffect(() => {
    setActiveNoteId(null);
  }, [workspacePath, setActiveNoteId]);

  const handleCreate = () => {
    if (!workspace) return;
    void createNote(workspace.path).then((note) => {
      if (note) setActiveNoteId(note.id);
    });
  };

  useEffect(() => {
    return subscribeNotesChanged();
  }, [subscribeNotesChanged]);

  useEffect(() => {
    if (!isActive || !workspace || loadedWorkspacePath === workspace.path) return;
    void loadNotes(workspace.path);
  }, [isActive, workspace, loadedWorkspacePath, loadNotes]);

  const runSearch = useCallback(
    async (next: NoteFilter) => {
      if (!workspace) return;
      const seq = ++searchSeqRef.current;
      activeQueryRef.current = next.query ?? null;
      setFilter(next);
      setFilterLoading(true);
      try {
        const result = await client.searchNotes({
          workspacePath: workspace.path,
          query: next.query || undefined,
          tag: next.tag || undefined,
        });
        if (seq !== searchSeqRef.current) return;
        if ('notes' in result) {
          setFilterResults(result.notes ?? []);
        } else {
          console.error('[notes] searchNotes 失败:', result.error);
        }
      } catch (error) {
        console.error('[notes] searchNotes 失败:', error);
      } finally {
        if (seq === searchSeqRef.current) setFilterLoading(false);
      }
    },
    [workspace],
  );

  // 搜索词变化 300ms 防抖触发关键词搜索；清空时仅退出 query 过滤，不打断标签过滤
  useEffect(() => {
    const query = searchDraft.trim();
    if (!query) {
      if (activeQueryRef.current) {
        activeQueryRef.current = null;
        searchSeqRef.current += 1;
        setFilter(null);
        setFilterResults([]);
        setFilterLoading(false);
      }
      return;
    }
    const timer = setTimeout(() => void runSearch({ query }), 300);
    return () => clearTimeout(timer);
  }, [searchDraft, workspace, runSearch]);

  const switchView = (next: NotesView) => {
    setView(next);
    searchSeqRef.current += 1;
    activeQueryRef.current = null;
    setSearchDraft('');
    setFilter(null);
    setFilterResults([]);
    setFilterLoading(false);
  };

  const handlePickTag = (tag: string) => {
    setView('timeline');
    setSearchDraft('');
    void runSearch({ tag });
  };

  const viewTitle =
    view === 'todos'
      ? '待办'
      : view === 'tags'
        ? '标签'
        : view === 'trash'
          ? '回收站'
          : filter?.query
            ? `搜索：${filter.query}`
            : filter?.tag
              ? `标签：${filter.tag}`
              : '时间流';

  const renderTimeline = () => {
    if (filter) {
      if (filterLoading && filterResults.length === 0) return <NoteLoading />;
      if (filterResults.length === 0) return <NoteEmpty text="无匹配结果" />;
      return (
        <div className="divide-y">
          {filterResults.map((note) => (
            <NoteCardItem
              key={note.id}
              note={note}
              active={note.id === activeNoteId}
              onOpen={() => setActiveNoteId(note.id)}
            />
          ))}
        </div>
      );
    }
    if (loading) return <NoteLoading />;
    if (notes.length === 0) return <NoteEmpty text="暂无笔记" />;
    return (
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
    );
  };

  return (
    <div className="flex-1 flex min-h-0">
      <nav className="w-20 border-r bg-muted/30 flex flex-col items-center gap-1 py-3 shrink-0">
        {VIEWS.map(({ id, label, icon: Icon }) => {
          const active = view === id;
          return (
            <button
              key={id}
              onClick={() => switchView(id)}
              title={label}
              className={cn(
                'flex flex-col items-center gap-1 px-2 py-2 rounded-md text-xs w-16 cursor-pointer',
                active
                  ? 'bg-background shadow-sm font-medium text-foreground'
                  : 'text-muted-foreground hover:bg-muted/50',
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
          <span className="text-xs font-medium text-muted-foreground shrink-0 truncate max-w-20">
            {viewTitle}
          </span>
          <div className="relative flex-1 min-w-0">
            <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground pointer-events-none" />
            <Input
              value={searchDraft}
              onChange={(e) => setSearchDraft(e.target.value)}
              placeholder="搜索标题与正文"
              className="h-7 pl-7 pr-7 text-xs md:text-xs"
            />
            {filterLoading ? (
              <Loader2 className="absolute right-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 animate-spin text-muted-foreground" />
            ) : searchDraft ? (
              <button
                onClick={() => setSearchDraft('')}
                title="清除搜索"
                className="absolute right-1.5 top-1/2 -translate-y-1/2 p-0.5 rounded hover:bg-muted"
              >
                <X className="w-3 h-3 text-muted-foreground" />
              </button>
            ) : null}
          </div>
          <Button variant="outline" size="xs" onClick={handleCreate} disabled={!workspace}>
            <Plus className="w-3 h-3" />
            新建卡片
          </Button>
        </div>

        <div className="flex-1 overflow-y-auto min-h-0">
          {view === 'timeline' ? (
            workspacePath ? (
              renderTimeline()
            ) : (
              <NoteEmpty text="请先选择工作区" />
            )
          ) : !workspacePath ? (
            <NoteEmpty text="请先选择工作区" />
          ) : view === 'todos' ? (
            <TodosView workspacePath={workspacePath} onOpenNote={setActiveNoteId} />
          ) : view === 'tags' ? (
            <TagsView onPickTag={handlePickTag} />
          ) : (
            <TrashView workspacePath={workspacePath} />
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
