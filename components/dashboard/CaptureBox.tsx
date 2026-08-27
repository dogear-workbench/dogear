import { useEffect, useState, type KeyboardEvent } from 'react';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { useNotesStore } from '@/stores/notes-store';
import { useSessionStore, NOTES_TAB_ID } from '@/stores/session-store';
import { useWorkspaceStore } from '@/stores/workspace-store';
import { formatNoteTime } from '@/components/notes/NoteCardItem';
import type { NoteMeta } from '@/types/note';

const TAG_RE = /#[\w\u4e00-\u9fa5-]+/g;

function parseCapture(raw: string): { content: string; tags: string[] } {
  const tags = [...new Set((raw.match(TAG_RE) ?? []).map((t) => t.slice(1)))];
  const content = raw.replace(TAG_RE, '').trim().replace(/[ \t]{2,}/g, ' ');
  return { content, tags };
}

export function CaptureBox() {
  const workspace = useWorkspaceStore((s) => s.workspace);
  const notes = useNotesStore((s) => s.notes);
  const loading = useNotesStore((s) => s.loading);
  const loadedWorkspacePath = useNotesStore((s) => s.loadedWorkspacePath);
  const loadNotes = useNotesStore((s) => s.loadNotes);
  const createNote = useNotesStore((s) => s.createNote);
  const setActiveNoteId = useNotesStore((s) => s.setActiveNoteId);
  const switchTab = useSessionStore((s) => s.switchTab);
  const [draft, setDraft] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!workspace || loadedWorkspacePath === workspace.path) return;
    void loadNotes(workspace.path);
  }, [workspace, loadedWorkspacePath, loadNotes]);

  const submit = async () => {
    const raw = draft.trim();
    if (!raw || !workspace || saving) return;
    const { content, tags } = parseCapture(raw);
    setSaving(true);
    try {
      await createNote(workspace.path, { content, tags });
      setDraft('');
    } finally {
      setSaving(false);
    }
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key !== 'Enter' || e.shiftKey || e.nativeEvent.isComposing) return;
    e.preventDefault();
    void submit();
  };

  const openNote = (noteId: string) => {
    setActiveNoteId(noteId);
    switchTab(NOTES_TAB_ID);
  };

  const recent = notes.slice(0, 5);

  return (
    <section className="flex h-full min-h-0 flex-col gap-2">
      <h2 className="shrink-0 px-1 text-sm font-semibold text-foreground">捕捉</h2>
      <Textarea
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder="记点什么…（#标签 回车保存）"
        className="min-h-10 max-h-40 resize-none overflow-y-auto"
      />
      <div className="flex min-h-0 flex-1 flex-col">
        <span className="shrink-0 px-1 text-xs font-medium text-muted-foreground">最近</span>
        <div className="mt-1 min-h-0 flex-1 overflow-y-auto rounded-lg border border-border bg-background">
          {recent.length === 0 ? (
            <p className="px-3 py-4 text-xs text-muted-foreground">
              {loading ? '加载中…' : '暂无卡片，在上方输入后回车创建'}
            </p>
          ) : (
            <div className="divide-y">
              {recent.map((note) => (
                <RecentCard key={note.id} note={note} onOpen={() => openNote(note.id)} />
              ))}
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

function RecentCard({ note, onOpen }: { note: NoteMeta; onOpen: () => void }) {
  return (
    <button onClick={onOpen} className="w-full px-3 py-2.5 text-left hover:bg-muted/30">
      <div className="flex items-center gap-2">
        <span className="shrink-0 text-xs text-muted-foreground">{formatNoteTime(note.created)}</span>
        <div className="flex min-w-0 flex-1 flex-wrap justify-end gap-1">
          {note.tags.map((tag) => (
            <Badge key={tag} variant="subtle" className="px-1.5 py-0 text-[10px] font-normal">
              {tag}
            </Badge>
          ))}
        </div>
      </div>
      <p className="mt-1 line-clamp-2 text-sm">{note.title || '（无内容）'}</p>
    </button>
  );
}
