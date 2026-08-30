import { useEffect, useRef, useState } from 'react';
import { Bot, Calendar, FileText, Pencil, Trash2, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import type { HumanTodo } from '@/types/todo';

export function dueDateOf(todo: HumanTodo): string | null {
  return todo.due ? todo.due.slice(0, 10) : null;
}

export function isOverdue(todo: HumanTodo): boolean {
  if (todo.status !== 'pending' || !todo.due) return false;
  const now = new Date();
  const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  return dueDateOf(todo)! < today;
}

interface TodoItemProps {
  todo: HumanTodo;
  /** 关联笔记标题；noteId 存在但为 null = 目标笔记悬空（回收站/已删），chip 灰态不自动清理 */
  noteTitle: string | null;
  onToggle: () => void;
  onUpdate: (patch: { text?: string; due?: string | null }) => void;
  onDelete: () => void;
  onOpenNote: (noteId: string) => void;
}

export function TodoItem({ todo, noteTitle, onToggle, onUpdate, onDelete, onOpenNote }: TodoItemProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [dueEditing, setDueEditing] = useState(false);
  const editRef = useRef<HTMLInputElement>(null);
  const dueRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editing) editRef.current?.select();
  }, [editing]);

  useEffect(() => {
    if (dueEditing) {
      try {
        dueRef.current?.showPicker?.();
      } catch {
        // 非手势上下文浏览器会拒绝 showPicker，退化为手点输入框
      }
    }
  }, [dueEditing]);

  const startEdit = () => {
    setDraft(todo.text);
    setEditing(true);
  };

  const saveEdit = () => {
    const text = draft.trim();
    if (text && text !== todo.text) onUpdate({ text });
    setEditing(false);
  };

  const done = todo.status === 'done';
  const due = dueDateOf(todo);
  const overdue = isOverdue(todo);

  return (
    <div className="group flex items-center gap-2 py-1.5 pl-3 pr-2">
      <Checkbox
        checked={done}
        onCheckedChange={onToggle}
        title={done ? '标记为未完成' : '标记完成'}
        className="w-3.5 h-3.5 shrink-0"
      />
      {todo.source === 'agent' && (
        <span title="Agent 记录" className="flex shrink-0">
          <Bot className="w-3.5 h-3.5 text-purple-500" />
        </span>
      )}
      {editing ? (
        <input
          ref={editRef}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') saveEdit();
            else if (e.key === 'Escape') setEditing(false);
            e.stopPropagation();
          }}
          onBlur={saveEdit}
          className="flex-1 min-w-0 bg-background border border-primary rounded px-1.5 py-0.5 text-sm outline-none"
        />
      ) : (
        <span
          className={cn(
            'flex-1 min-w-0 truncate text-sm',
            done && 'text-muted-foreground line-through',
            overdue && 'text-destructive',
          )}
          title={todo.text}
        >
          {todo.text}
        </span>
      )}
      {dueEditing ? (
        <span className="flex items-center shrink-0">
          <input
            ref={dueRef}
            type="date"
            value={due ?? ''}
            onChange={(e) => {
              onUpdate({ due: e.target.value || null });
              setDueEditing(false);
            }}
            onBlur={() => setDueEditing(false)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') setDueEditing(false);
              e.stopPropagation();
            }}
            autoFocus
            className="h-5 w-28 rounded border border-input bg-background px-1 text-xs outline-none"
          />
          {todo.due && (
            <button
              onClick={() => {
                onUpdate({ due: null });
                setDueEditing(false);
              }}
              title="清除截止日期"
              className="p-0.5 rounded hover:bg-muted"
            >
              <X className="w-3 h-3 text-muted-foreground" />
            </button>
          )}
        </span>
      ) : due ? (
        <button
          onClick={() => setDueEditing(true)}
          title={`截止 ${due}，点击修改`}
          className={cn(
            'flex items-center gap-1 rounded px-1 py-0.5 text-xs shrink-0 hover:bg-muted',
            overdue ? 'text-destructive font-medium' : 'text-muted-foreground',
          )}
        >
          <Calendar className="w-3 h-3" />
          {due}
        </button>
      ) : null}
      {todo.noteId && (
        <button
          onClick={() => {
            if (noteTitle) onOpenNote(todo.noteId!);
          }}
          title={noteTitle ? `打开卡片：${noteTitle}` : '关联笔记在回收站或已删除'}
          className={cn(
            'flex items-center gap-1 min-w-0 max-w-28 rounded px-1 py-0.5 text-xs shrink-0',
            noteTitle ? 'text-primary hover:bg-muted' : 'text-muted-foreground/60 cursor-not-allowed',
          )}
        >
          <FileText className="w-3 h-3 shrink-0" />
          <span className="truncate">{noteTitle ?? '笔记缺失'}</span>
        </button>
      )}
      {!editing && (
        <span className="ml-auto flex items-center opacity-0 pointer-events-none group-hover:opacity-100 group-hover:pointer-events-auto transition-opacity shrink-0">
          {!due && (
            <Button
              variant="ghost"
              size="sm"
              className="h-5 w-5 p-0 text-muted-foreground hover:text-foreground"
              onClick={() => setDueEditing(true)}
              title="设置截止日期"
            >
              <Calendar className="w-3 h-3" />
            </Button>
          )}
          <Button
            variant="ghost"
            size="sm"
            className="h-5 w-5 p-0 text-muted-foreground hover:text-foreground"
            onClick={startEdit}
            title="编辑"
          >
            <Pencil className="w-3 h-3" />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="h-5 w-5 p-0 text-muted-foreground hover:text-destructive"
            onClick={onDelete}
            title="删除（进回收站）"
          >
            <Trash2 className="w-3 h-3" />
          </Button>
        </span>
      )}
    </div>
  );
}
