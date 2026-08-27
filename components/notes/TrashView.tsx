import { useEffect, useState } from 'react';
import { RotateCcw, Trash2 } from 'lucide-react';
import { client } from '@/lib/client';
import { Button } from '@/components/ui/button';
import { NoteEmpty, NoteLoading } from '@/components/notes/NoteState';
import { formatNoteTime } from '@/components/notes/NoteCardItem';
import { showConfirm } from '@/stores/confirm-store';
import type { NoteMeta } from '@/types/note';

interface TrashViewProps {
  workspacePath: string;
}

export function TrashView({ workspacePath }: TrashViewProps) {
  const [items, setItems] = useState<NoteMeta[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const result = await client.listTrashNotes({ workspacePath });
        if (cancelled) return;
        if ('notes' in result) {
          setItems(result.notes ?? []);
        } else {
          console.error('[notes] listTrashNotes 失败:', result.error);
        }
      } catch (error) {
        if (!cancelled) console.error('[notes] listTrashNotes 失败:', error);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [workspacePath]);

  const removeFromLocal = (noteId: string) => {
    setItems((prev) => prev.filter((it) => it.id !== noteId));
  };

  // 时间流列表的刷新交给 notesChanged 广播，这里只做本地移除避免重复拉取
  const handleRestore = async (note: NoteMeta) => {
    setBusyId(note.id);
    try {
      const result = await client.restoreNote({ workspacePath, noteId: note.id });
      if ('success' in result && result.success) {
        removeFromLocal(note.id);
      } else if ('error' in result) {
        console.error('[notes] restoreNote 失败:', result.error);
      }
    } catch (error) {
      console.error('[notes] restoreNote 失败:', error);
    } finally {
      setBusyId(null);
    }
  };

  const handlePurge = async (note: NoteMeta) => {
    const ok = await showConfirm('彻底删除', `「${note.title || '（无内容）'}」将被永久删除，不可恢复。`);
    if (!ok) return;
    setBusyId(note.id);
    try {
      const result = await client.purgeNote({ workspacePath, noteId: note.id });
      if ('success' in result && result.success) {
        removeFromLocal(note.id);
      } else if ('error' in result) {
        console.error('[notes] purgeNote 失败:', result.error);
      }
    } catch (error) {
      console.error('[notes] purgeNote 失败:', error);
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="flex-1 overflow-y-auto min-h-0">
      {loading ? (
        <NoteLoading />
      ) : items.length === 0 ? (
        <NoteEmpty text="回收站为空" />
      ) : (
        <div className="divide-y">
          {items.map((note) => (
            <div key={note.id} className="flex items-center gap-1.5 px-4 py-2.5">
              <div className="min-w-0 flex-1">
                <p className="text-sm line-clamp-1">{note.title || '（无内容）'}</p>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  更新于 {formatNoteTime(note.updated)}
                </p>
              </div>
              <Button
                variant="ghost"
                size="icon-xs"
                disabled={busyId === note.id}
                onClick={() => void handleRestore(note)}
                title="恢复到时间流"
              >
                <RotateCcw className="w-3.5 h-3.5" />
              </Button>
              <Button
                variant="ghost"
                size="icon-xs"
                disabled={busyId === note.id}
                onClick={() => void handlePurge(note)}
                title="彻底删除"
                className="text-destructive hover:text-destructive"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </Button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
