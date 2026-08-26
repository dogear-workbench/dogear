import { useEffect, useMemo, useState } from 'react';
import { Cog, History, Loader2, Pencil, Play, Plus, RefreshCw, Square, Trash2 } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { cn } from '@/lib/utils';
import { useVisiblePolling } from '@/hooks/use-visible-polling';
import { useConfirmStore } from '@/stores/confirm-store';
import { useSchedulerStore } from '@/stores/scheduler-store';
import type { ScheduledTaskWithNextRun, SchedulerRunningPlan } from '@/types/scheduler';
import type { Workspace } from '@/types/electron-api';
import { HistorySheet } from './HistorySheet';
import { TaskEditor } from './TaskEditor';
import { describeTrigger, formatRelativeFuture } from './utils';
import type { WorkspaceOption } from './utils';

const ACTIVITY_POLL_MS = 10_000;

interface Props {
  workspaces: Workspace[];
}

export function SchedulerPanel({ workspaces }: Props) {
  const tasks = useSchedulerStore((s) => s.tasks);
  const loading = useSchedulerStore((s) => s.loading);
  const loadingError = useSchedulerStore((s) => s.loadingError);
  const activity = useSchedulerStore((s) => s.activity);
  const loadTasks = useSchedulerStore((s) => s.loadTasks);
  const deleteTask = useSchedulerStore((s) => s.deleteTask);
  const setTaskEnabled = useSchedulerStore((s) => s.setTaskEnabled);
  const runTaskNow = useSchedulerStore((s) => s.runTaskNow);
  const stopTask = useSchedulerStore((s) => s.stopTask);
  const refreshActivity = useSchedulerStore((s) => s.refreshActivity);

  const confirm = useConfirmStore((s) => s.confirm);

  const workspaceOptions: WorkspaceOption[] = useMemo(
    () => workspaces.map((w) => ({ id: w.id, name: w.name })),
    [workspaces],
  );
  const [editorOpen, setEditorOpen] = useState(false);
  const [editingTask, setEditingTask] = useState<ScheduledTaskWithNextRun | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [workspaceId, setWorkspaceId] = useState<string>('all');
  const [, setDisplayTick] = useState(0);

  useEffect(() => {
    loadTasks();
  }, [loadTasks]);

  useVisiblePolling(() => refreshActivity(), ACTIVITY_POLL_MS);

  useEffect(() => {
    const id = setInterval(() => setDisplayTick((t) => t + 1), 60_000);
    return () => clearInterval(id);
  }, []);

  const runningMap = useMemo(() => {
    const map = new Map<string, SchedulerRunningPlan>();
    for (const r of activity?.running ?? []) map.set(r.taskId, r);
    return map;
  }, [activity]);

  const visibleTasks = useMemo(
    () => workspaceId === 'all'
      ? tasks
      : tasks.filter((t) => !t.workspaceId || t.workspaceId === workspaceId),
    [tasks, workspaceId],
  );

  const handleToggle = async (task: ScheduledTaskWithNextRun, enabled: boolean) => {
    if (!enabled && runningMap.has(task.id)) {
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

  const handleDelete = async (task: ScheduledTaskWithNextRun) => {
    const running = runningMap.has(task.id);
    const ok = await confirm({
      title: '删除任务',
      description: running
        ? `「${task.name}」正在运行，删除后当前运行仍会完成，但任务不会再被触发。确定删除吗？`
        : `确定删除任务「${task.name}」吗？此操作不可恢复。`,
      buttons: [
        { label: '取消', value: 'cancel', variant: 'outline' },
        { label: '删除', value: 'confirm', variant: 'destructive' },
      ],
    });
    if (ok === 'confirm') await deleteTask(task.id);
  };

  const handleViewHistory = () => setHistoryOpen(true);

  return (
    <div className="space-y-3">
      <div className="mb-3">
        <h2 className="text-lg font-semibold mb-1">定时计划</h2>
        <p className="text-sm text-muted-foreground">
          每个任务一行：内置任务（组卡提炼 / 复盘报告 / 补分类 / 分类整理）常驻可改不可删，也可新建自定义任务；按时间规则（每天时刻 / 间隔 / 时间窗口 / 单次）或条件事件（启动、关会话、窗口关闭）触发，多个触发器任一命中即触发。
        </p>
      </div>
      <div className="flex items-center gap-2">
        <Button size="sm" onClick={() => { setEditingTask(null); setEditorOpen(true); }}>
          <Plus className="w-4 h-4 mr-1" />
          新建任务
        </Button>
        <Button variant="outline" size="sm" onClick={handleViewHistory}>
          <History className="w-4 h-4 mr-1" />
          查看执行历史
        </Button>
        <Select value={workspaceId} onValueChange={setWorkspaceId}>
          <SelectTrigger size="sm" className="ml-auto w-[180px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">全部工作区</SelectItem>
            {workspaces.map((w) => (
              <SelectItem key={w.id} value={w.id}>{w.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button variant="ghost" size="sm" onClick={() => loadTasks()} title="刷新任务列表">
          <RefreshCw className={cn('w-3.5 h-3.5', loading && 'animate-spin')} />
        </Button>
      </div>

      {tasks.length === 0 && loading && (
        <p className="text-sm text-muted-foreground py-8 text-center">加载任务中…</p>
      )}
      {tasks.length === 0 && !loading && loadingError && (
        <p className="text-sm text-destructive py-8 text-center">{loadingError}</p>
      )}
      {tasks.length === 0 && !loading && !loadingError && (
        <p className="text-sm text-muted-foreground py-8 text-center">
          暂无任务，点击「新建任务」创建第一个定时任务
        </p>
      )}
      {tasks.length > 0 && visibleTasks.length === 0 && (
        <p className="text-sm text-muted-foreground py-8 text-center">该工作区暂无任务</p>
      )}

      <div className="space-y-2">
        {visibleTasks.map((task) => {
          const running = runningMap.get(task.id);
          return (
            <div key={task.id} className={cn('rounded-md border p-3 flex items-start gap-3', !task.enabled && 'opacity-60')}>
              <div className="flex-1 min-w-0 space-y-1">
                <div className="flex items-center gap-2 flex-wrap">
                  {task.kind === 'builtin' && <Cog className="w-3.5 h-3.5 text-muted-foreground shrink-0" />}
                  <span className="text-sm font-medium truncate">{task.name}</span>
                  {running && (
                    <Badge variant="secondary" className="gap-1 whitespace-nowrap">
                      <Loader2 className="w-3 h-3 animate-spin" />
                      运行中：{running.taskName}
                    </Badge>
                  )}
                </div>
                <div className="text-xs text-muted-foreground truncate">
                  {task.triggers.length > 0
                    ? task.triggers.map((t) => describeTrigger(t, (id) => tasks.find((x) => x.id === id)?.name)).join('；')
                    : '无触发器'}
                </div>
              </div>
              <div className="flex flex-col items-end gap-2 shrink-0">
                <div className="flex items-center gap-2">
                  <span className="text-xs text-muted-foreground w-24 text-right truncate" title="下次运行">
                    {task.nextRunAt ? formatRelativeFuture(task.nextRunAt) : '—'}
                  </span>
                  <Switch checked={task.enabled} onCheckedChange={(v) => handleToggle(task, v)} />
                </div>
                <div className="flex items-center gap-1">
                  <Button variant="ghost" size="sm" className="h-7 px-2 text-xs"
                    onClick={() => { setEditingTask(task); setEditorOpen(true); }}>
                    <Pencil className="w-3.5 h-3.5 mr-1" />
                    编辑
                  </Button>
                  {running ? (
                    <Button variant="ghost" size="sm" className="h-7 px-2 text-xs text-destructive hover:text-destructive"
                      onClick={() => stopTask(task.id)}
                      title="停止运行中的任务">
                      <Square className="w-3.5 h-3.5 mr-1" />
                      停止
                    </Button>
                  ) : (
                    <Button variant="ghost" size="sm" className="h-7 px-2 text-xs"
                      onClick={() => runTaskNow(task.id)}
                      title={task.enabled ? '立即运行' : '立即运行（任务已停用，本次仍会执行）'}>
                      <Play className="w-3.5 h-3.5 mr-1" />
                      运行
                    </Button>
                  )}
                  {task.kind === 'custom' && (
                    <Button variant="ghost" size="sm" className="h-7 px-2 text-xs text-destructive hover:text-destructive"
                      onClick={() => handleDelete(task)}>
                      <Trash2 className="w-3.5 h-3.5 mr-1" />
                      删除
                    </Button>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      <TaskEditor
        open={editorOpen}
        task={editingTask}
        workspaces={workspaceOptions}
        defaultWorkspaceId={workspaceId === 'all' ? '' : workspaceId}
        onOpenChange={setEditorOpen}
      />

      <HistorySheet open={historyOpen} onOpenChange={setHistoryOpen} />
    </div>
  );
}
