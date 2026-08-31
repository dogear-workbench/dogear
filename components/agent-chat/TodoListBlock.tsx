import { Check, Circle } from 'lucide-react';
import { cn } from '@/lib/utils';

interface TodoItem {
  content: string;
  activeForm: string;
  status: 'pending' | 'in_progress' | 'completed';
}

interface TodoListBlockProps {
  todos: TodoItem[];
}

export function TodoListBlock({ todos }: TodoListBlockProps) {
  if (!Array.isArray(todos) || todos.length === 0) return null;
  const total = todos.length;
  const done = todos.filter(t => t.status === 'completed').length;
  return (
    <div className="rounded-md border bg-muted/20 px-3 py-2 space-y-1.5 text-sm">
      <div className="text-xs text-muted-foreground">
        任务清单 {done}/{total}
      </div>
      <ul className="space-y-1">
        {todos.map((t, i) => (
          <li key={i} className="flex items-start gap-2">
            <span className="mt-0.5 flex-none">
              {t.status === 'completed' && <Check className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />}
              {t.status === 'in_progress' && (
                <Circle className="w-3.5 h-3.5 text-sky-600 fill-sky-600 dark:text-sky-400 dark:fill-sky-400" />
              )}
              {t.status === 'pending' && <Circle className="w-3.5 h-3.5 text-muted-foreground" />}
            </span>
            <span className={cn(
              t.status === 'completed' && 'line-through text-muted-foreground',
              t.status === 'in_progress' && 'font-medium',
            )}>
              {t.status === 'in_progress' ? t.activeForm : t.content}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
