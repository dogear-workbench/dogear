import { useState } from 'react';
import { toast } from 'sonner';
import { ChevronRight } from 'lucide-react';
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

/** 「最近编辑」窗口：updated 距今 ≤7 天算近期手记 */
const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

function isRecentlyUpdated(note: NoteMeta): boolean {
  return Date.now() - new Date(note.updated).getTime() <= SEVEN_DAYS_MS;
}

interface CollapsibleSectionProps {
  label: string;
  count: number;
  collapsed: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}

/** 折叠分组段（样式参考 TrashView.SectionHeader：sticky 分组头 + 条数） */
function CollapsibleSection({ label, count, collapsed, onToggle, children }: CollapsibleSectionProps) {
  return (
    <div>
      <button
        onClick={onToggle}
        className="sticky top-0 z-10 flex w-full items-center gap-1 bg-muted/40 px-4 py-1 text-xs font-medium text-muted-foreground hover:text-foreground"
      >
        <ChevronRight
          className={cn('h-3 w-3 shrink-0 transition-transform', !collapsed && 'rotate-90')}
        />
        {label}
        <span className="tabular-nums">{count}</span>
      </button>
      {!collapsed && <div className="divide-y">{children}</div>}
    </div>
  );
}

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

  // 折叠态组件内 useState，不持久化（刷新回默认展开）
  const [agentCollapsed, setAgentCollapsed] = useState(false);
  const [olderCollapsed, setOlderCollapsed] = useState(false);

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
      // 搜索/标签过滤：三段合并平铺，统一 created 倒序（服务端按 updated，前端重排）
      if (filterLoading && filterResults.length === 0) return <NoteLoading />;
      if (filterResults.length === 0) return <NoteEmpty text="无匹配结果" />;
      const sorted = [...filterResults].sort((a, b) => b.created.localeCompare(a.created));
      return <div className="divide-y">{sorted.map(renderItem)}</div>;
    }
    if (loading) return <NoteLoading />;
    if (notes.length === 0) return <NoteEmpty text="暂无笔记" />;
    // 非搜索模式：三段分组（notes 已按 created 倒序，filter 保序即各段内 created 倒序）
    const agentNotes = notes.filter((n) => n.source);
    const recentMine = notes.filter((n) => !n.source && isRecentlyUpdated(n));
    const olderMine = notes.filter((n) => !n.source && !isRecentlyUpdated(n));
    return (
      <>
        {recentMine.length > 0 && <div className="divide-y">{recentMine.map(renderItem)}</div>}
        {agentNotes.length > 0 && (
          <CollapsibleSection
            label="Agent 转存"
            count={agentNotes.length}
            collapsed={agentCollapsed}
            onToggle={() => setAgentCollapsed((v) => !v)}
          >
            {agentNotes.map(renderItem)}
          </CollapsibleSection>
        )}
        {olderMine.length > 0 && (
          <CollapsibleSection
            label="更早的手记"
            count={olderMine.length}
            collapsed={olderCollapsed}
            onToggle={() => setOlderCollapsed((v) => !v)}
          >
            {olderMine.map(renderItem)}
          </CollapsibleSection>
        )}
      </>
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
