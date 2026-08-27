import { useCallback, useEffect, useState } from 'react';
import { cn } from '@/lib/utils';
import { client } from '@/lib/client';
import { rendererEvents } from '@/lib/events';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { NoteEmpty, NoteLoading } from '@/components/notes/NoteState';
import type { NoteTodoEntry } from '@/types/note';

interface NoteGroup {
  noteId: string;
  noteTitle: string;
  entries: NoteTodoEntry[];
}

function groupByNote(entries: NoteTodoEntry[]): NoteGroup[] {
  const map = new Map<string, NoteGroup>();
  for (const entry of entries) {
    const group = map.get(entry.noteId);
    if (group) {
      group.entries.push(entry);
    } else {
      map.set(entry.noteId, { noteId: entry.noteId, noteTitle: entry.noteTitle, entries: [entry] });
    }
  }
  return [...map.values()];
}

const STATUS_BADGE: Record<'pending' | 'in_progress', { label: string; className: string }> = {
  pending: { label: '待办', className: '' },
  in_progress: { label: '进行中', className: 'text-amber-600' },
};

interface TodoRowProps {
  entry: NoteTodoEntry;
  checking: boolean;
  onCheck: () => void;
}

function TodoRow({ entry, checking, onCheck }: TodoRowProps) {
  const { todo } = entry;
  const badge = STATUS_BADGE[todo.status === 'in_progress' ? 'in_progress' : 'pending'];

  return (
    <div className="py-0.5">
      <div className="flex items-center gap-2">
        <Checkbox
          checked={todo.status === 'in_progress' ? 'indeterminate' : false}
          disabled={checking}
          onCheckedChange={onCheck}
          title={todo.status === 'in_progress' ? '进行中（点击完成）' : '点击完成'}
          className="w-3.5 h-3.5 shrink-0 data-[state=indeterminate]:border-primary data-[state=indeterminate]:bg-primary data-[state=indeterminate]:text-primary-foreground"
        />
        <span
          className={cn(
            'flex-1 min-w-0 truncate text-sm',
            todo.status === 'in_progress' && 'text-amber-600',
          )}
        >
          {todo.text}
        </span>
        <Badge variant="subtle" className={cn('px-1.5 py-0 text-[10px] font-normal shrink-0', badge.className)}>
          {badge.label}
        </Badge>
      </div>
      {todo.plan && (
        <p className="ml-5.5 mt-0.5 text-xs text-primary truncate" title={todo.plan}>
          {todo.plan}
        </p>
      )}
    </div>
  );
}

interface GroupSectionProps {
  label: string;
  groups: NoteGroup[];
  checkingKey: string | null;
  onCheck: (entry: NoteTodoEntry) => void;
  onOpenNote: (noteId: string) => void;
}

function GroupSection({ label, groups, checkingKey, onCheck, onOpenNote }: GroupSectionProps) {
  if (groups.length === 0) return null;
  return (
    <div>
      <div className="px-4 pt-3 pb-1 text-xs font-medium text-muted-foreground">{label}</div>
      <div className="divide-y">
        {groups.map((group) => (
          <div key={group.noteId} className="px-4 py-2.5">
            <button
              onClick={() => onOpenNote(group.noteId)}
              title="打开卡片"
              className="max-w-full truncate text-left text-xs text-muted-foreground hover:text-foreground hover:underline"
            >
              {group.noteTitle || '（无内容）'}
            </button>
            <div className="mt-1">
              {group.entries.map((entry) => (
                <TodoRow
                  key={entry.todo.id}
                  entry={entry}
                  checking={checkingKey === `${entry.noteId}:${entry.todo.id}`}
                  onCheck={() => onCheck(entry)}
                />
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

interface TodosViewProps {
  workspacePath: string;
  onOpenNote: (noteId: string) => void;
}

export function TodosView({ workspacePath, onOpenNote }: TodosViewProps) {
  const [entries, setEntries] = useState<NoteTodoEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [checkingKey, setCheckingKey] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const result = await client.listTodos({ workspacePath });
      if ('todos' in result) {
        setEntries((result.todos ?? []).filter((e) => e.todo.status !== 'done'));
      } else {
        console.error('[notes] listTodos 失败:', result.error);
      }
    } catch (error) {
      console.error('[notes] listTodos 失败:', error);
    } finally {
      setLoading(false);
    }
  }, [workspacePath]);

  useEffect(() => {
    void load();
  }, [load]);

  // 勾选回写后主进程广播 notesChanged，这里同步刷新聚合列表
  useEffect(() => {
    const unsub = rendererEvents.notesChanged.listen((data) => {
      if (data.workspacePath === workspacePath) void load();
    });
    return () => unsub();
  }, [workspacePath, load]);

  const handleCheck = async (entry: NoteTodoEntry) => {
    const key = `${entry.noteId}:${entry.todo.id}`;
    setCheckingKey(key);
    try {
      const result = await client.getNote({ workspacePath, noteId: entry.noteId });
      if ('note' in result && result.note) {
        const todos = result.note.todos.map((t) =>
          t.id === entry.todo.id ? { ...t, status: 'done' as const } : t,
        );
        await client.updateNote({ workspacePath, noteId: entry.noteId, patch: { todos } });
      }
    } catch (error) {
      console.error('[notes] 完成待办失败:', error);
    } finally {
      setCheckingKey(null);
    }
  };

  const planEntries = entries.filter((e) => e.todo.plan);
  const plainEntries = entries.filter((e) => !e.todo.plan);

  return (
    <div className="flex-1 overflow-y-auto min-h-0">
      {loading ? (
        <NoteLoading />
      ) : entries.length === 0 ? (
        <NoteEmpty text="没有未完成待办" />
      ) : (
        <>
          <GroupSection
            label={`可执行待办（${planEntries.length}）`}
            groups={groupByNote(planEntries)}
            checkingKey={checkingKey}
            onCheck={(entry) => void handleCheck(entry)}
            onOpenNote={onOpenNote}
          />
          <GroupSection
            label={`普通待办（${plainEntries.length}）`}
            groups={groupByNote(plainEntries)}
            checkingKey={checkingKey}
            onCheck={(entry) => void handleCheck(entry)}
            onOpenNote={onOpenNote}
          />
        </>
      )}
    </div>
  );
}
