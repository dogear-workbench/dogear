import { useCallback, useEffect, useRef, useState } from 'react';
import type { Editor } from '@tiptap/react';
import { ArrowLeft, Loader2, Trash2, MessagesSquare, Link2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { client } from '@/lib/client';
import { Button } from '@/components/ui/button';
import { NoteMetaSection } from '@/components/notes/NoteMetaSection';
import { TiptapEditor } from '@/components/notes/TiptapEditor';
import { useNotesStore, type NotePatch } from '@/stores/notes-store';
import { useWorkspaceStore } from '@/stores/workspace-store';
import { referenceNoteIntoFocus, jumpToSourceConversation } from '@/lib/reference-guard';
import type { Note } from '@/types/note';

type SaveState = 'idle' | 'saving' | 'saved' | 'error';

function formatTime(iso: string): string {
  return new Date(iso).toLocaleString('zh-CN', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function formatMetaDate(iso: string): string {
  const d = new Date(iso);
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

/** 标题即正文首个 ATX 标题行（frontmatter 无标题字段），编辑区把它剥离为独立标题输入 */
function splitLeadingHeading(content: string): { heading: string | null; body: string } {
  const lines = content.split(/\r?\n/);
  let start = 0;
  while (start < lines.length && lines[start].trim() === '') start += 1;
  const match = start < lines.length ? lines[start].match(/^#{1,6}\s+(.+?)\s*$/) : null;
  if (!match) return { heading: null, body: content };
  return { heading: match[1], body: lines.slice(start + 1).join('\n').replace(/^\s*\n/, '') };
}

function joinHeading(heading: string, body: string): string {
  return `# ${heading}\n\n${body}`;
}

interface NoteEditorProps {
  workspaceId: string;
  noteId: string;
  onClose: () => void;
  onDelete?: () => void;
}

// 父组件以 key={noteId} 挂载：换卡即重挂载，编辑器内容随初值重建，避免串卡
export function NoteEditor({ workspaceId, noteId, onClose, onDelete }: NoteEditorProps) {
  const [note, setNote] = useState<Note | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [titleDraft, setTitleDraft] = useState('');
  const [editorMarkdown, setEditorMarkdown] = useState('');
  const [tags, setTags] = useState<string[]>([]);
  const [metaExpanded, setMetaExpanded] = useState(false);
  const [saveState, setSaveState] = useState<SaveState>('idle');

  const pendingRef = useRef<NotePatch>({});
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const savedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const titleDraftRef = useRef('');
  const titleDirtyRef = useRef(false);
  const hadHeadingRef = useRef(false);
  const editorBodyRef = useRef('');
  const shouldFocusTitleRef = useRef(false);
  const titleInputRef = useRef<HTMLInputElement>(null);
  const tiptapRef = useRef<Editor | null>(null);

  const updateNote = useNotesStore((s) => s.updateNote);
  // 正文路径点击时拼绝对路径用（openFileInFolder 需要绝对路径）
  const noteWorkspacePath = useWorkspaceStore((s) => s.workspace?.path) ?? '';

  const flush = useCallback(async () => {
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    const patch = pendingRef.current;
    if (Object.keys(patch).length === 0) return;
    pendingRef.current = {};
    setSaveState('saving');
    const ok = await updateNote(workspaceId, noteId, patch);
    if (ok) {
      setSaveState('saved');
      if (savedTimerRef.current !== null) clearTimeout(savedTimerRef.current);
      savedTimerRef.current = setTimeout(() => setSaveState('idle'), 1500);
    } else {
      pendingRef.current = { ...patch, ...pendingRef.current };
      setSaveState('error');
    }
  }, [workspaceId, noteId, updateNote]);

  const commit = useCallback(
    (patch: NotePatch, immediate = false) => {
      pendingRef.current = { ...pendingRef.current, ...patch };
      setSaveState((s) => (s === 'error' || s === 'saving' ? s : 'idle'));
      if (immediate) {
        void flush();
        return;
      }
      if (timerRef.current !== null) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => void flush(), 800);
    },
    [flush],
  );

  const commitContent = useCallback(
    (title: string) => {
      const trimmed = title.trim();
      const content =
        trimmed && (titleDirtyRef.current || hadHeadingRef.current)
          ? joinHeading(trimmed, editorBodyRef.current)
          : editorBodyRef.current;
      commit({ content });
    },
    [commit],
  );

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const result = await client.getNote({ workspaceId, noteId });
      if (cancelled) return;
      if ('note' in result && result.note) {
        const loaded = result.note;
        const { heading, body } = splitLeadingHeading(loaded.content);
        hadHeadingRef.current = heading !== null;
        editorBodyRef.current = body;
        titleDraftRef.current = heading ?? '';
        setTitleDraft(heading ?? '');
        setEditorMarkdown(body);
        setTags(loaded.tags);
        setNote(loaded);
        if (!loaded.content.trim()) shouldFocusTitleRef.current = true;
      } else {
        setLoadError(true);
      }
    })();
    return () => {
      cancelled = true;
      void flush();
    };
  }, [workspaceId, noteId, flush]);

  useEffect(() => {
    if (note && shouldFocusTitleRef.current) {
      shouldFocusTitleRef.current = false;
      titleInputRef.current?.focus();
    }
  }, [note]);

  useEffect(
    () => () => {
      if (savedTimerRef.current !== null) clearTimeout(savedTimerRef.current);
    },
    [],
  );

  const handleTitleChange = (value: string) => {
    titleDraftRef.current = value;
    titleDirtyRef.current = true;
    setTitleDraft(value);
    commitContent(value);
  };

  const handleEditorChange = (md: string) => {
    editorBodyRef.current = md;
    commitContent(titleDraftRef.current);
  };

  const handleTagsChange = (next: string[]) => {
    setTags(next);
    commit({ tags: next }, true);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.nativeEvent.isComposing || e.defaultPrevented) return;
    if (e.key === 'Escape') {
      e.preventDefault();
      onClose();
    } else if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      void flush().finally(onClose);
    }
  };

  return (
    <div className="flex-1 flex flex-col min-w-0 min-h-0 bg-background" onKeyDown={handleKeyDown}>
      {loadError ? (
        <div className="flex-1 flex flex-col items-center justify-center gap-3 text-sm text-muted-foreground">
          卡片不存在或已被删除
          <Button variant="outline" size="sm" onClick={onClose}>
            返回列表
          </Button>
        </div>
      ) : !note ? (
        <div className="flex-1 flex items-center justify-center">
          <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
        </div>
      ) : (
        <div className="flex-1 overflow-y-auto min-h-0">
          <div className="mx-auto flex w-full max-w-[760px] flex-col px-8 pt-8 pb-24">
            <input
              ref={titleInputRef}
              value={titleDraft}
              onChange={(e) => handleTitleChange(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  tiptapRef.current?.commands.focus('end');
                }
              }}
              placeholder="无标题"
              className="w-full bg-transparent text-2xl font-semibold outline-none placeholder:text-muted-foreground/40"
            />

            <div className="mt-1.5 flex items-center gap-3 text-xs text-muted-foreground">
              <span title={`创建于 ${formatTime(note.created)}`}>{formatMetaDate(note.created)}</span>
              {note.source && (
                <button
                  onClick={() => void jumpToSourceConversation(note.source!)}
                  title={`来自会话「${note.source.title || '未命名会话'}」· ${new Date(note.source.date).toLocaleDateString('zh-CN')}，点击跳转`}
                  className="cursor-pointer hover:text-foreground"
                >
                  <Link2 className="w-3 h-3" />
                </button>
              )}
              <button
                onClick={() => void referenceNoteIntoFocus({
                  noteId: note.id,
                  title: titleDraft.trim() || note.title,
                  workspaceId,
                })}
                title="引用到最近的会话"
                className="cursor-pointer hover:text-foreground"
              >
                <MessagesSquare className="w-3 h-3" />
              </button>
              <button
                onClick={() => setMetaExpanded((v) => !v)}
                title={tags.length > 0 ? `${tags.length} 个标签，点击展开标签与引用` : '添加标签'}
                className={cn('cursor-pointer hover:text-foreground', metaExpanded && 'text-foreground')}
              >
                #{tags.length}
              </button>
              <span className="flex-1" />
              {saveState === 'saving' && <span>保存中…</span>}
              {saveState === 'saved' && <span>已保存</span>}
              {saveState === 'error' && (
                <span className="text-destructive" title="内容已保留，下次输入或 Ctrl+Enter 时会重新保存">
                  保存失败
                </span>
              )}
              <Button variant="ghost" size="icon-xs" onClick={onClose} title="返回列表（Esc）">
                <ArrowLeft className="w-3.5 h-3.5" />
              </Button>
              {onDelete && (
                <Button
                  variant="ghost"
                  size="icon-xs"
                  onClick={onDelete}
                  title="移入回收站"
                  className="text-destructive hover:text-destructive"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </Button>
              )}
            </div>

            {metaExpanded && (
              <NoteMetaSection tags={tags} onTagsChange={handleTagsChange} />
            )}

            {/* 间距类只放外层容器，不进编辑器 attributes（Step 4 挂 body 浮层时同理） */}
            <div className="mt-2">
              <TiptapEditor
                workspaceId={workspaceId}
                workspacePath={noteWorkspacePath}
                initialMarkdown={editorMarkdown}
                onChange={handleEditorChange}
                onReady={(editor) => {
                  tiptapRef.current = editor;
                }}
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
