import { useEffect, useMemo, useState } from 'react';
import { ChevronDown, ChevronRight, Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { NoteEmpty, NoteLoading } from '@/components/notes/NoteState';
import { TodoItem, dueDateOf } from '@/components/notes/TodoItem';
import { filterByQuery, useTodoStore } from '@/stores/todo-store';
import { useNotesStore } from '@/stores/notes-store';
import type { HumanTodo } from '@/types/todo';

function sortPending(todos: HumanTodo[]): HumanTodo[] {
  return [...todos].sort((a, b) => {
    const da = dueDateOf(a);
    const db = dueDateOf(b);
    if (da && db) return da.localeCompare(db);
    if (da) return -1;
    if (db) return 1;
    return b.createdAt.localeCompare(a.createdAt);
  });
}

interface TodosPanelProps {
  workspacePath: string;
  /** 顶栏分域搜索词（step6 接线），前端 store 过滤 */
  query?: string;
  onOpenNote: (noteId: string) => void;
}

export function TodosPanel({ workspacePath, query, onOpenNote }: TodosPanelProps) {
  const todos = useTodoStore((s) => s.todos);
  const loading = useTodoStore((s) => s.loading);
  const loadedWorkspacePath = useTodoStore((s) => s.loadedWorkspacePath);
  const loadTodos = useTodoStore((s) => s.loadTodos);
  const createTodo = useTodoStore((s) => s.createTodo);
  const updateTodo = useTodoStore((s) => s.updateTodo);
  const setTodoStatus = useTodoStore((s) => s.setTodoStatus);
  const softDeleteTodo = useTodoStore((s) => s.softDeleteTodo);
  const subscribeTodosChanged = useTodoStore((s) => s.subscribeTodosChanged);
  const notes = useNotesStore((s) => s.notes);

  const [draft, setDraft] = useState('');
  const [showDone, setShowDone] = useState(false);

  // 惰性加载；loadedWorkspacePath 去重，切工作区后自动重拉
  useEffect(() => {
    if (loadedWorkspacePath === workspacePath) return;
    void loadTodos(workspacePath);
  }, [workspacePath, loadedWorkspacePath, loadTodos]);

  useEffect(() => {
    return subscribeTodosChanged();
  }, [subscribeTodosChanged]);

  const handleCreate = async () => {
    const text = draft.trim();
    if (!text) return;
    setDraft('');
    await createTodo(workspacePath, { text });
  };

  const visible = filterByQuery(todos, query ?? '');
  const pending = useMemo(() => sortPending(visible.filter((t) => t.status === 'pending')), [visible]);
  const done = useMemo(
    () => visible.filter((t) => t.status === 'done').sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)),
    [visible],
  );

  const noteTitleOf = (noteId: string | undefined): string | null =>
    noteId ? (notes.find((n) => n.id === noteId)?.title ?? null) : null;

  const renderItems = (items: HumanTodo[]) => (
    <div className="divide-y">
      {items.map((todo) => (
        <TodoItem
          key={todo.id}
          todo={todo}
          noteTitle={noteTitleOf(todo.noteId)}
          onToggle={() => void setTodoStatus(workspacePath, todo.id, todo.status === 'done' ? 'pending' : 'done')}
          onUpdate={(patch) => void updateTodo(workspacePath, todo.id, patch)}
          onDelete={() => void softDeleteTodo(workspacePath, todo.id)}
          onOpenNote={onOpenNote}
        />
      ))}
    </div>
  );

  return (
    <div className="flex flex-col h-full min-h-0">
      <div className="p-2 border-b shrink-0">
        <div className="relative">
          <Input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void handleCreate();
            }}
            placeholder="新待办，Enter 创建"
            className="h-7 pr-7 text-xs"
          />
          <Button
            variant="ghost"
            size="sm"
            className="absolute right-0.5 top-1/2 -translate-y-1/2 h-5 w-5 p-0 text-muted-foreground hover:text-foreground"
            onClick={() => void handleCreate()}
            disabled={!draft.trim()}
            title="创建待办"
          >
            <Plus className="w-3.5 h-3.5" />
          </Button>
        </div>
      </div>
      <div className="flex-1 overflow-y-auto min-h-0">
        {loading && todos.length === 0 ? (
          <NoteLoading />
        ) : pending.length === 0 && done.length === 0 ? (
          <NoteEmpty text={query ? '无匹配待办' : '暂无待办，在上方输入快速创建'} />
        ) : (
          <>
            {pending.length > 0 ? renderItems(pending) : !query && <NoteEmpty text="全部完成" />}
            {done.length > 0 && (
              <div>
                <button
                  onClick={() => setShowDone((v) => !v)}
                  className="flex w-full items-center gap-1 px-3 pt-3 pb-1.5 text-xs font-medium text-muted-foreground hover:text-foreground cursor-pointer"
                >
                  {showDone ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
                  已完成 · {done.length}
                </button>
                {showDone && <div className="pb-2">{renderItems(done)}</div>}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
