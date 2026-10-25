import { Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { ExecProfile, TaskStatus } from '@/types/task';

export const TASK_STATUS_CONFIG: Record<TaskStatus, { label: string; className: string }> = {
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
  const config = TASK_STATUS_CONFIG[status];
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

const EXEC_PROFILE_CONFIG: Record<ExecProfile, { label: string; className: string; title: string }> = {
  default: { label: '默认', className: 'bg-muted text-muted-foreground', title: '默认执行：按场景配置装配能力，直接按计划实施' },
  'code-impl': {
    label: '代码实施',
    className: 'bg-fuchsia-500/15 text-fuchsia-600 dark:text-fuchsia-400',
    title: '代码实施：挂载 staged-execution，逐 step 派子会话实施',
  },
};

export function TaskExecProfileBadge({ execProfile, className }: { execProfile?: ExecProfile; className?: string }) {
  const config = EXEC_PROFILE_CONFIG[execProfile ?? 'default'];
  return (
    <span
      title={config.title}
      className={cn(
        'inline-flex shrink-0 items-center rounded-full px-1.5 py-0 text-[10px] font-medium',
        config.className,
        className,
      )}
    >
      {config.label}
    </span>
  );
}
