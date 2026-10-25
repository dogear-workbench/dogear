import {
  ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuSeparator, ContextMenuTrigger,
} from '@/components/ui/context-menu';
import { cn } from '@/lib/utils';
import { TaskExecProfileBadge } from './TaskStatusBadge';
import { formatNoteTime } from '@/components/notes/NoteCardItem';
import type { ReviewAction, Task } from '@/types/task';

interface TaskCardItemProps {
  task: Task;
  active: boolean;
  onOpen: () => void;
  onExecute: () => Promise<void>;
  onCancel: () => Promise<void>;
  onComplete: () => Promise<void>;
  onDelete: () => Promise<void>;
  onMove: (to: 'backlog' | 'plan') => Promise<void>;
  onReview: (action: ReviewAction) => Promise<void>;
}

export function TaskCardItem({ task, active, onOpen, onExecute, onCancel, onComplete, onDelete, onMove, onReview }: TaskCardItemProps) {
  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <div
          role="button"
          tabIndex={0}
          data-task-id={task.id}
          onClick={onOpen}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              onOpen();
            }
          }}
          className={cn(
            'text-left mx-1 rounded-sm px-3 py-2.5 cursor-pointer transition-colors focus-visible:outline-none',
            active ? 'bg-blue-100 dark:bg-blue-900/30' : 'hover:bg-muted/30',
          )}
        >
          <p className={cn('text-sm font-medium line-clamp-1', active && 'text-blue-700 dark:text-blue-300')}>{task.title}</p>
          <div className="mt-1 flex items-center gap-1 text-xs text-muted-foreground min-w-0">
            <TaskExecProfileBadge execProfile={task.execProfile} />
            <span className="shrink-0" title={`更新于 ${formatNoteTime(task.updatedAt)}`}>
              {formatNoteTime(task.updatedAt)}
            </span>
          </div>
        </div>
      </ContextMenuTrigger>
      <ContextMenuContent onCloseAutoFocus={(event) => event.preventDefault()}>
        {(task.status === 'plan' || task.status === 'rejected') && (
          <>
            <ContextMenuItem onClick={() => void onMove('backlog')}>移到待办</ContextMenuItem>
            <ContextMenuItem onClick={() => void onComplete()}>手动完成</ContextMenuItem>
          </>
        )}
        {task.status === 'backlog' && (
          <>
            <ContextMenuItem onClick={() => void onExecute()}>执行</ContextMenuItem>
            <ContextMenuItem onClick={() => void onComplete()}>手动完成</ContextMenuItem>
          </>
        )}
        {(task.status === 'queued' || task.status === 'running') && (
          <ContextMenuItem onClick={() => void onCancel()}>取消</ContextMenuItem>
        )}
        {task.status === 'review' && (
          <>
            <ContextMenuItem onClick={() => void onReview('approve')}>通过</ContextMenuItem>
            <ContextMenuItem onClick={() => void onReview('reject')}>打回</ContextMenuItem>
          </>
        )}
        {task.status === 'interrupted' && (
          <>
            <ContextMenuItem onClick={() => void onExecute()}>重新入队</ContextMenuItem>
            <ContextMenuItem onClick={() => void onMove('plan')}>移回计划</ContextMenuItem>
            <ContextMenuItem onClick={() => void onComplete()}>手动完成</ContextMenuItem>
          </>
        )}
        {task.status === 'done' && (
          <ContextMenuItem onClick={() => void onMove('plan')}>移回计划</ContextMenuItem>
        )}
        <ContextMenuSeparator />
        <ContextMenuItem className="text-destructive" onClick={() => void onDelete()}>
          删除
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
}
