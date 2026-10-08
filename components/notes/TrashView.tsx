import { useEffect, useMemo, useState } from 'react';
import { RotateCcw, Trash2 } from 'lucide-react';
import { client } from '@/lib/client';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { NoteEmpty, NoteLoading } from '@/components/notes/NoteState';
import { formatNoteTime } from '@/components/notes/NoteCardItem';
import { showConfirm } from '@/stores/confirm-store';
import type { NoteMeta } from '@/types/note';
import type { Task } from '@/types/task';

interface TrashViewProps {
  workspaceId: string;
  /** 任务段仍走工作区路径契约（tasks 未迁全局） */
  workspacePath: string;
  query?: string;
}

type BusyKey = `note:${string}` | `task:${string}`;

interface TrashRowProps {
  primary: string;
  meta: string;
  busy: boolean;
  /** 笔记段保持常显按钮（沿用旧样式），任务段 hover 浮出 */
  hoverActions: boolean;
  onRestore: () => void;
  onPurge: () => void;
}

function TrashRow({ primary, meta, busy, hoverActions, onRestore, onPurge }: TrashRowProps) {
  return (
    <div className="group flex items-center gap-1.5 px-4 py-2.5">
      <div className="min-w-0 flex-1">
        <p className="text-sm line-clamp-1">{primary}</p>
        <p className="mt-0.5 text-xs text-muted-foreground">{meta}</p>
      </div>
      <div
        className={cn(
          'flex items-center shrink-0',
          hoverActions &&
            'opacity-0 pointer-events-none group-hover:opacity-100 group-hover:pointer-events-auto transition-opacity',
        )}
      >
        <Button variant="ghost" size="icon-xs" disabled={busy} onClick={onRestore} title="恢复">
          <RotateCcw className="w-3.5 h-3.5" />
        </Button>
        <Button
          variant="ghost"
          size="icon-xs"
          disabled={busy}
          onClick={onPurge}
          title="彻底删除"
          className="text-destructive hover:text-destructive"
        >
          <Trash2 className="w-3.5 h-3.5" />
        </Button>
      </div>
    </div>
  );
}

function SectionHeader({ label, count }: { label: string; count: number }) {
  return (
    <div className="sticky top-0 z-10 flex items-center gap-1.5 bg-muted/40 px-4 py-1 text-xs font-medium text-muted-foreground">
      {label}
      <span className="tabular-nums">{count}</span>
    </div>
  );
}

export function TrashView({ workspaceId, workspacePath, query = '' }: TrashViewProps) {
  const [notes, setNotes] = useState<NoteMeta[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyKey, setBusyKey] = useState<BusyKey | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    void (async () => {
      const [noteRes, taskRes] = await Promise.all([
        client.listTrashNotes({ workspaceId }).catch((error) => {
          console.error('[notes] listTrashNotes 失败:', error);
          return null;
        }),
        client.listDeletedCollabTasks({ workspacePath }).catch((error) => {
          console.error('[tasks] listDeletedCollabTasks 失败:', error);
          return null;
        }),
      ]);
      if (cancelled) return;
      if (noteRes && 'notes' in noteRes) setNotes(noteRes.notes ?? []);
      if (taskRes && 'tasks' in taskRes) setTasks(taskRes.tasks ?? []);
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [workspacePath]);

  const q = query.trim().toLowerCase();
  const filteredNotes = useMemo(
    () => (q ? notes.filter((n) => (n.title || '').toLowerCase().includes(q)) : notes),
    [notes, q],
  );
  const filteredTasks = useMemo(
    () => (q ? tasks.filter((t) => t.title.toLowerCase().includes(q)) : tasks),
    [tasks, q],
  );

  // 恢复/彻底删除后各 service 广播对应 changed 事件，原视图列表由 store 订阅自动刷新，这里只做本地移除
  const withBusy = async (key: BusyKey, fn: () => Promise<boolean>) => {
    setBusyKey(key);
    try {
      if (await fn()) {
        if (key.startsWith('note:')) setNotes((prev) => prev.filter((it) => it.id !== key.slice(5)));
        else setTasks((prev) => prev.filter((it) => it.id !== key.slice(5)));
      }
    } finally {
      setBusyKey(null);
    }
  };

  const handleRestoreNote = (note: NoteMeta) =>
    withBusy(`note:${note.id}`, async () => {
      try {
        const result = await client.restoreNote({ workspaceId, noteId: note.id });
        if ('success' in result && result.success) return true;
        if ('error' in result) console.error('[notes] restoreNote 失败:', result.error);
        return false;
      } catch (error) {
        console.error('[notes] restoreNote 失败:', error);
        return false;
      }
    });

  const handlePurgeNote = (note: NoteMeta) =>
    withBusy(`note:${note.id}`, async () => {
      const ok = await showConfirm('彻底删除', `「${note.title || '（无内容）'}」将被永久删除，不可恢复。`);
      if (!ok) return false;
      try {
        const result = await client.purgeNote({ workspaceId, noteId: note.id });
        if ('success' in result && result.success) return true;
        if ('error' in result) console.error('[notes] purgeNote 失败:', result.error);
        return false;
      } catch (error) {
        console.error('[notes] purgeNote 失败:', error);
        return false;
      }
    });

  const handleRestoreTask = (task: Task) =>
    withBusy(`task:${task.id}`, async () => {
      try {
        const result = await client.restoreCollabTask({ workspacePath, taskId: task.id });
        if ('task' in result) return true;
        if ('error' in result) console.error('[tasks] restoreCollabTask 失败:', result.error);
        return false;
      } catch (error) {
        console.error('[tasks] restoreCollabTask 失败:', error);
        return false;
      }
    });

  const handlePurgeTask = (task: Task) =>
    withBusy(`task:${task.id}`, async () => {
      const ok = await showConfirm('彻底删除', `「${task.title}」将被永久删除，不可恢复。`);
      if (!ok) return false;
      try {
        const result = await client.purgeCollabTask({ workspacePath, taskId: task.id });
        if ('success' in result && result.success) return true;
        if ('error' in result) console.error('[tasks] purgeCollabTask 失败:', result.error);
        return false;
      } catch (error) {
        console.error('[tasks] purgeCollabTask 失败:', error);
        return false;
      }
    });

  if (loading) return <NoteLoading />;

  const empty = notes.length === 0 && tasks.length === 0;
  if (empty) return <NoteEmpty text="回收站为空" />;

  const noMatch = filteredNotes.length === 0 && filteredTasks.length === 0;
  if (noMatch) return <NoteEmpty text="无匹配结果" />;

  return (
    <div className="flex-1 overflow-y-auto min-h-0">
      {filteredNotes.length > 0 && (
        <section>
          <SectionHeader label="笔记" count={filteredNotes.length} />
          <div className="divide-y">
            {filteredNotes.map((note) => (
              <TrashRow
                key={note.id}
                primary={note.title || '（无内容）'}
                meta={`更新于 ${formatNoteTime(note.updated)}`}
                busy={busyKey === `note:${note.id}`}
                hoverActions={false}
                onRestore={() => void handleRestoreNote(note)}
                onPurge={() => void handlePurgeNote(note)}
              />
            ))}
          </div>
        </section>
      )}
      {filteredTasks.length > 0 && (
        <section>
          <SectionHeader label="任务" count={filteredTasks.length} />
          <div className="divide-y">
            {filteredTasks.map((task) => (
              <TrashRow
                key={task.id}
                primary={task.title}
                meta={task.deletedAt ? `删除于 ${formatNoteTime(task.deletedAt)}` : ''}
                busy={busyKey === `task:${task.id}`}
                hoverActions
                onRestore={() => void handleRestoreTask(task)}
                onPurge={() => void handlePurgeTask(task)}
              />
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
