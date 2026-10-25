import { useEffect, useState } from 'react';
import { ArchiveRestore, Loader2, Trash2, X } from 'lucide-react';
import { toast } from 'sonner';
import { client } from '@/lib/client';
import { Button } from '@/components/ui/button';
import { MarkdownRenderer } from '@/components/MarkdownRenderer';
import { formatNoteTime } from '@/components/notes/NoteCardItem';
import { splitLeadingHeading } from '@/components/notes/NoteEditor';
import type { Note } from '@/types/note';

interface TrashNoteDetailProps {
  workspaceId: string;
  noteId: string;
  /** 走 TrashView 句柄执行恢复（列表同步移除）；成功返回 true */
  onRestore: () => Promise<boolean>;
  onClose: () => void;
}

/** 回收站笔记只读详情：只能查看与恢复 */
export function TrashNoteDetail({ workspaceId, noteId, onRestore, onClose }: TrashNoteDetailProps) {
  const [note, setNote] = useState<Note | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [restoring, setRestoring] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const result = await client.getTrashNote({ workspaceId, noteId });
        if (cancelled) return;
        if ('note' in result && result.note) setNote(result.note);
        else setError('笔记不存在或已被清理');
      } catch (e) {
        if (!cancelled) {
          console.error('[notes] getTrashNote 失败:', e);
          setError('笔记读取失败');
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [workspaceId, noteId]);

  const handleRestore = async () => {
    if (restoring) return;
    setRestoring(true);
    try {
      if (await onRestore()) toast.success('笔记已恢复到笔记列表');
      else toast.error('恢复失败，请重试');
    } finally {
      setRestoring(false);
    }
  };

  const { heading, body } = splitLeadingHeading(note?.content ?? '');
  const title = heading ?? note?.title ?? '（无内容）';

  return (
    <div className="flex-1 flex flex-col min-w-0 min-h-0">
      <header className="shrink-0 border-b px-4 py-2.5 flex items-center gap-2 min-w-0">
        <h2 className="text-sm font-semibold truncate flex-1 min-w-0" title={title}>
          {title}
        </h2>
        <Button
          variant="outline"
          size="sm"
          className="shrink-0 h-7 px-2.5 text-xs"
          disabled={restoring || !note}
          onClick={() => void handleRestore()}
          title="恢复到笔记列表"
        >
          {restoring ? <Loader2 className="size-3.5 animate-spin" /> : <ArchiveRestore className="size-3.5" />}
          恢复
        </Button>
        <Button variant="ghost" size="icon-xs" onClick={onClose} title="关闭详情">
          <X className="w-3.5 h-3.5" />
        </Button>
      </header>
      <div className="flex-1 overflow-y-auto min-h-0">
        {error ? (
          <div className="h-full flex flex-col items-center justify-center gap-3 text-sm text-muted-foreground">
            <Trash2 className="w-8 h-8 opacity-40" />
            {error}
          </div>
        ) : !note ? (
          <div className="h-full flex items-center justify-center">
            <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <div className="mx-auto flex w-full max-w-[900px] flex-col px-8 pt-8 pb-24">
            <h1 className="text-2xl font-semibold leading-tight break-words">{title}</h1>
            <div className="mt-1.5 flex items-center gap-3 text-xs text-muted-foreground">
              <span title={`更新于 ${formatNoteTime(note.updated)}`}>{formatNoteTime(note.updated)}</span>
              {note.tags.length > 0 && (
                <span className="truncate">{note.tags.map((t) => `#${t}`).join(' ')}</span>
              )}
            </div>
            <div className="mt-6">
              <MarkdownRenderer content={body} />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
