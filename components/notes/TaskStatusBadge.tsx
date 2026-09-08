import { Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { TaskStatus } from '@/types/task';

const STATUS_CONFIG: Record<TaskStatus, { label: string; className: string }> = {
  plan: { label: '计划', className: 'bg-sky-500/15 text-sky-600 dark:text-sky-400' },
  backlog: { label: '积压', className: 'bg-violet-500/15 text-violet-600 dark:text-violet-400' },
  queued: { label: '排队中', className: 'bg-muted text-muted-foreground' },
  running: { label: '执行中', className: 'bg-blue-500/15 text-blue-600 dark:text-blue-400' },
  review: { label: '待审核', className: 'bg-amber-500/15 text-amber-600 dark:text-amber-400' },
  done: { label: '已完成', className: 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400' },
  rejected: { label: '已打回', className: 'bg-red-500/15 text-red-600 dark:text-red-400' },
  interrupted: { label: '已中断', className: 'bg-orange-500/15 text-orange-600 dark:text-orange-400' },
};

export function TaskStatusBadge({ status, className }: { status: TaskStatus; className?: string }) {
  const config = STATUS_CONFIG[status];
  return (
    <span
      className={cn(
        'inline-flex shrink-0 items-center gap-0.5 rounded-full px-1.5 py-0 text-[10px] font-medium',
        config.className,
        className,
      )}
    >
      {status === 'running' && <Loader2 className="w-2.5 h-2.5 animate-spin" />}
      {config.label}
    </span>
  );
}
