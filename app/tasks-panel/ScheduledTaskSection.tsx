import { useEffect, useMemo, useState } from 'react';
import { ChevronDown, ChevronRight, Loader2, Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { useConfirmStore } from '@/stores/confirm-store';
import { useSchedulerStore } from '@/stores/scheduler-store';
import { useTasksPanelStore } from '@/stores/tasks-panel-store';
import { cn } from '@/lib/utils';
import { SectionHeader } from './SectionHeader';
import { TaskRunList } from './TaskRunList';
import { describeTrigger, formatRelativeFuture } from './utils';

interface RowProps {
  taskId: string;
}

function ScheduledTaskRow({ taskId }: RowProps) {
  const task = useSchedulerStore((s) => s.tasks.find((t) => t.id === taskId));
  const running = useSchedulerStore((s) =>
    s.activity?.running.find((r) => r.taskId === taskId && r.source === 'scheduler'),
  );
  const setTaskEnabled = useSchedulerStore((s) => s.setTaskEnabled);
  const tasks = useSchedulerStore((s) => s.tasks);
  const selection = useTasksPanelStore((s) => s.selection);
  const select = useTasksPanelStore((s) => s.select);
  const confirm = useConfirmStore((s) => s.confirm);
  const [expanded, setExpanded] = useState(false);
  const [, setTick] = useState(0);

  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 60_000);
    return () => clearInterval(id);
  }, []);

  if (!task) return null;

  const selected = selection?.kind === 'scheduled' && selection.planId === task.id;

  const handleToggle = async (enabled: boolean) => {
    if (!enabled && running) {
      const ok = await confirm({
        title: '停用正在运行的任务',
        description: `「${task.name}」正在运行，停用不会中断当前运行，只是之后不再自动触发。`,
        buttons: [
          { label: '取消', value: 'cancel', variant: 'outline' },
          { label: '停用', value: 'confirm', variant: 'destructive' },
        ],
      });
      if (ok !== 'confirm') return;
    }
    await setTaskEnabled(task.id, enabled);
  };

  return (
    <div>
      <div
        role="button"
        tabIndex={0}
        onClick={() => select({ kind: 'scheduled', planId: task.id })}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            select({ kind: 'scheduled', planId: task.id });
          }
        }}
        className={cn(
          'group mx-1 rounded-sm px-2 py-2 cursor-pointer transition-colors focus-visible:outline-none',
          selected ? 'bg-blue-100 dark:bg-blue-900/30' : 'hover:bg-muted/30',
          !task.enabled && 'opacity-60',
        )}
      >
        <div className="flex items-center gap-1 min-w-0">
          <button
            className="p-0.5 rounded hover:bg-muted/80 text-muted-foreground shrink-0"
            onClick={(e) => {
              e.stopPropagation();
              setExpanded((v) => !v);
            }}
            title={expanded ? '收起运行记录' : '展开运行记录'}
          >
            {expanded ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
          </button>
          <span className={cn('text-sm font-medium truncate min-w-0', selected && 'text-blue-700 dark:text-blue-300')}>
            {task.name}
          </span>
          {running && (
            <span className="inline-flex shrink-0 items-center gap-0.5 rounded-full bg-blue-500/15 px-1.5 py-0 text-[10px] font-medium text-blue-600 dark:text-blue-400">
              <Loader2 className="w-2.5 h-2.5 animate-spin" />
              运行中
            </span>
          )}
          <span
            className="ml-auto shrink-0 text-[11px] text-muted-foreground tabular-nums"
            title="下次运行"
            onClick={(e) => e.stopPropagation()}
          >
            {task.nextRunAt ? formatRelativeFuture(task.nextRunAt) : ''}
          </span>
          <span className="shrink-0" onClick={(e) => e.stopPropagation()}>
            <Switch checked={task.enabled} onCheckedChange={(v) => void handleToggle(v)} />
          </span>
        </div>
        <p className="mt-0.5 pl-5 text-xs text-muted-foreground truncate">
          {task.triggers.length > 0
            ? task.triggers
                .map((t) => describeTrigger(t, (id) => tasks.find((x) => x.id === id)?.name))
                .join('；')
            : '无触发器'}
        </p>
      </div>
      {expanded && <TaskRunList planId={task.id} running={running} />}
    </div>
  );
}

/** 左栏定时任务区：任务行 + 展开运行记录 */
export function ScheduledTaskSection() {
  const tasks = useSchedulerStore((s) => s.tasks);
  const loading = useSchedulerStore((s) => s.loading);
  const loadingError = useSchedulerStore((s) => s.loadingError);
  const openEditor = useTasksPanelStore((s) => s.openEditor);
  const taskIds = useMemo(() => tasks.map((t) => t.id), [tasks]);

  return (
    <section>
      <SectionHeader
        label="定时任务"
        count={tasks.length}
        action={
          <Button variant="ghost" size="xs" onClick={() => openEditor('new')}>
            <Plus className="w-3 h-3" />
            添加任务
          </Button>
        }
      />
      {loading && tasks.length === 0 && (
        <p className="px-3 py-3 text-xs text-muted-foreground">加载中…</p>
      )}
      {!loading && loadingError && tasks.length === 0 && (
        <p className="px-3 py-3 text-xs text-destructive">{loadingError}</p>
      )}
      {!loading && !loadingError && tasks.length === 0 && (
        <p className="px-3 py-3 text-xs text-muted-foreground">暂无定时任务</p>
      )}
      {taskIds.map((id) => (
        <ScheduledTaskRow key={id} taskId={id} />
      ))}
    </section>
  );
}
