import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Loader2,
  Newspaper,
  NotebookPen,
  Plus,
  Search,
  SquareCheckBig,
  Trash2,
  X,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { client } from '@/lib/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useNotesStore } from '@/stores/notes-store';
import { useTaskStore } from '@/stores/task-store';
import { useTaskFocusStore } from '@/stores/task-focus-store';
import { TaskPanel } from '@/components/notes/TaskPanel';
import { TagFilterMenu } from '@/components/notes/TagFilterMenu';
import { TrashView } from '@/components/notes/TrashView';
import { NotesTimelinePane } from '@/components/notes/NotesTimelinePane';
import { ReportSection } from '@/components/notes/ReportSection';
import { useSessionStore, NOTES_TAB_ID } from '@/stores/session-store';
import { useWorkspaceStore } from '@/stores/workspace-store';
import type { NoteMeta } from '@/types/note';

type PanelMode = 'notes' | 'tasks' | 'trash' | 'report';

const MODES = [
  { id: 'notes', label: '笔记', icon: NotebookPen },
  { id: 'tasks', label: '任务', icon: SquareCheckBig },
  { id: 'trash', label: '回收站', icon: Trash2 },
  { id: 'report', label: '报告', icon: Newspaper },
] as const;

const SEARCH_PLACEHOLDER: Record<PanelMode, string> = {
  notes: '搜索标题与正文',
  tasks: '过滤任务',
  trash: '过滤回收站',
  report: '',
};

export interface NoteFilter {
  query?: string;
  tag?: string;
}

export function NotesPanel() {
  const activeTabId = useSessionStore((s) => s.activeTabId);
  const workspace = useWorkspaceStore((s) => s.workspace);
  const loadedWorkspacePath = useNotesStore((s) => s.loadedWorkspacePath);
  const loadNotes = useNotesStore((s) => s.loadNotes);
  const subscribeNotesChanged = useNotesStore((s) => s.subscribeNotesChanged);
  const setActiveNoteId = useNotesStore((s) => s.setActiveNoteId);
  const createNote = useNotesStore((s) => s.createNote);

  const taskGroups = useTaskStore((s) => s.groups);
  const taskLoadedWorkspacePath = useTaskStore((s) => s.loadedWorkspacePath);
  const loadTasks = useTaskStore((s) => s.loadTasks);
  const subscribeTasksChanged = useTaskStore((s) => s.subscribeTasksChanged);
  const taskFocusReq = useTaskFocusStore((s) => s.focusReq);
  const activeNoteId = useNotesStore((s) => s.activeNoteId);
  const reviewCount = taskGroups?.review.length ?? 0;

  const [mode, setMode] = useState<PanelMode>('report');
  const [listHidden, setListHidden] = useState(false);
  const [searchDraft, setSearchDraft] = useState('');
  const [selectedTag, setSelectedTag] = useState<string | null>(null);
  const [filter, setFilter] = useState<NoteFilter | null>(null);
  const [filterResults, setFilterResults] = useState<NoteMeta[]>([]);
  const [filterLoading, setFilterLoading] = useState(false);
  const searchSeqRef = useRef(0);

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
    return subscribeTasksChanged();
  }, [subscribeTasksChanged]);

  useEffect(() => {
    if (!isActive || !workspace || taskLoadedWorkspacePath === workspace.path) return;
    void loadTasks(workspace.path);
  }, [isActive, workspace, taskLoadedWorkspacePath, loadTasks]);

  // 任务通知深链：切到任务视图（选中任务由 TaskPanel 响应同一请求）
  useEffect(() => {
    if (taskFocusReq) setMode('tasks');
  }, [taskFocusReq]);

  // 卡片跳转深链：切回笔记视图（选中卡片由 NotesTimelinePane 响应 activeNoteId）
  useEffect(() => {
    if (activeNoteId) setMode('notes');
  }, [activeNoteId]);

  useEffect(() => {
    if (!isActive || !workspace || loadedWorkspacePath === workspace.path) return;
    void loadNotes(workspace.path);
  }, [isActive, workspace, loadedWorkspacePath, loadNotes]);

  const runSearch = useCallback(
    async (next: NoteFilter) => {
      if (!workspace) return;
      const seq = ++searchSeqRef.current;
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

  // 笔记 mode：query/tag 叠加搜索（300ms 防抖）；双空退出过滤。其余 mode 的 query 由对应面板前端过滤，不走 IPC
  useEffect(() => {
    if (mode !== 'notes') return;
    const query = searchDraft.trim();
    if (!query && !selectedTag) {
      searchSeqRef.current += 1;
      setFilter(null);
      setFilterResults([]);
      setFilterLoading(false);
      return;
    }
    const timer = setTimeout(() => void runSearch({ query, tag: selectedTag ?? undefined }), 300);
    return () => clearTimeout(timer);
  }, [searchDraft, selectedTag, mode, runSearch]);

  const switchMode = (next: PanelMode) => {
    if (next === mode) return;
    setMode(next);
    setSearchDraft('');
    setSelectedTag(null);
    setFilter(null);
    setFilterResults([]);
    setFilterLoading(false);
  };

  const toggleTag = (tag: string) => {
    setSelectedTag((prev) => (prev === tag ? null : tag));
  };

  const toggleListHidden = useCallback(() => setListHidden((v) => !v), []);

  const handlePanelKeyDown = (e: React.KeyboardEvent) => {
    if ((e.ctrlKey || e.metaKey) && e.key === '\\') {
      e.preventDefault();
      toggleListHidden();
    }
  };

  const renderContent = () => {
    if (mode === 'report') {
      if (!workspace) {
        return (
          <div className="flex-1 flex items-center justify-center text-sm text-muted-foreground">
            请先选择工作区
          </div>
        );
      }
      return (
        <div className="flex-1 min-h-0 overflow-y-auto bg-muted/10">
          <div className="px-6 py-6">
            <ReportSection workspaceId={workspace.id} />
          </div>
        </div>
      );
    }
    if (mode === 'notes') {
      return (
        <NotesTimelinePane
          listHidden={listHidden}
          onToggleListHidden={toggleListHidden}
          filter={filter}
          filterResults={filterResults}
          filterLoading={filterLoading}
        />
      );
    }
    if (!workspacePath) {
      return (
        <div className="flex-1 flex items-center justify-center text-sm text-muted-foreground">
          请先选择工作区
        </div>
      );
    }
    if (mode === 'tasks') {
      return (
        <TaskPanel
          workspacePath={workspacePath}
          query={searchDraft}
          listHidden={listHidden}
          onToggleListHidden={toggleListHidden}
        />
      );
    }
    return (
      <div className="flex-1 flex flex-col min-h-0">
        <TrashView workspacePath={workspacePath} query={searchDraft} />
      </div>
    );
  };

  return (
    <div className="flex-1 flex flex-col min-h-0" onKeyDown={handlePanelKeyDown}>
      <header className="flex items-center gap-2 px-3 py-2 border-b shrink-0">
        <div className="flex items-center gap-0.5 p-0.5 rounded-md bg-muted/50 shrink-0">
          {MODES.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              onClick={() => switchMode(id)}
              className={cn(
                'flex items-center gap-1 px-2.5 py-1 rounded text-xs cursor-pointer',
                mode === id
                  ? 'bg-background shadow-sm font-medium text-foreground'
                  : 'text-muted-foreground hover:text-foreground',
              )}
            >
              <Icon className="w-3.5 h-3.5" />
              {label}
              {id === 'tasks' && reviewCount > 0 && (
                <span className="inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-amber-500 px-1 text-[10px] font-semibold leading-none text-white">
                  {reviewCount}
                </span>
              )}
            </button>
          ))}
        </div>
        {mode !== 'report' && (
          <div className="relative flex-1 max-w-96 min-w-0">
            <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground pointer-events-none" />
            <Input
              value={searchDraft}
              onChange={(e) => setSearchDraft(e.target.value)}
              placeholder={SEARCH_PLACEHOLDER[mode]}
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
        )}
        {mode === 'notes' && (
          <>
            <TagFilterMenu selected={selectedTag} onToggle={toggleTag} />
            {selectedTag && (
              <button
                onClick={() => setSelectedTag(null)}
                title="移除标签过滤"
                className="flex items-center gap-0.5 h-7 px-2 rounded-md bg-primary/10 text-primary text-xs hover:bg-primary/20 cursor-pointer shrink-0 max-w-36"
              >
                <span className="truncate">#{selectedTag}</span>
                <X className="w-3 h-3 shrink-0" />
              </button>
            )}
            <Button variant="outline" size="xs" onClick={handleCreate} disabled={!workspace}>
              <Plus className="w-3 h-3" />
              新建卡片
            </Button>
          </>
        )}
      </header>

      {renderContent()}
    </div>
  );
}
