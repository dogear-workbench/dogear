import { useEffect, useMemo, useState } from 'react';
import { History, Loader2, Pencil, Play, Plus, RefreshCw, Trash2 } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { client } from '@/lib/client';
import { cn } from '@/lib/utils';
import { useConfirmStore } from '@/stores/confirm-store';
import { useSchedulerStore } from '@/stores/scheduler-store';
import { useUIStore } from '@/stores/ui-store';
import type { PlanWithNextRun, SchedulerRunningPlan } from '@/types/scheduler';
import { PlanEditor } from './PlanEditor';
import { describeTask, describeTrigger, formatRelativeFuture } from './utils';
import type { WorkspaceOption } from './utils';

export function SchedulerPanel() {
  const plans = useSchedulerStore((s) => s.plans);
  const loading = useSchedulerStore((s) => s.loading);
  const loadingError = useSchedulerStore((s) => s.loadingError);
  const activity = useSchedulerStore((s) => s.activity);
  const loadPlans = useSchedulerStore((s) => s.loadPlans);
  const deletePlan = useSchedulerStore((s) => s.deletePlan);
  const setPlanEnabled = useSchedulerStore((s) => s.setPlanEnabled);
  const runNow = useSchedulerStore((s) => s.runNow);
  const startActivityPolling = useSchedulerStore((s) => s.startActivityPolling);
  const stopActivityPolling = useSchedulerStore((s) => s.stopActivityPolling);

  const confirm = useConfirmStore((s) => s.confirm);
  const closeSettings = useUIStore((s) => s.closeSettings);

  const [workspaces, setWorkspaces] = useState<WorkspaceOption[]>([]);
  const [editorOpen, setEditorOpen] = useState(false);
  const [editingPlan, setEditingPlan] = useState<PlanWithNextRun | null>(null);
  const [, setDisplayTick] = useState(0);

  useEffect(() => {
    loadPlans();
    client
      .getAll()
      .then((r) => {
        if (r.workspaces) setWorkspaces(r.workspaces.map((w) => ({ id: w.id, name: w.name })));
      })
      .catch(() => {});
    startActivityPolling();
    return () => stopActivityPolling();
  }, [loadPlans, startActivityPolling, stopActivityPolling]);

  useEffect(() => {
    const id = setInterval(() => setDisplayTick((t) => t + 1), 60_000);
    return () => clearInterval(id);
  }, []);

  const runningMap = useMemo(() => {
    const map = new Map<string, SchedulerRunningPlan>();
    for (const r of activity?.running ?? []) map.set(r.planId, r);
    return map;
  }, [activity]);

  const planNameOf = (planId: string) => plans.find((p) => p.id === planId)?.name;

  const handleToggle = async (plan: PlanWithNextRun, enabled: boolean) => {
    if (!enabled && runningMap.has(plan.id)) {
      const ok = await confirm({
        title: '停用正在运行的计划',
        description: `「${plan.name}」正在运行，停用不会中断当前运行，只是之后不再自动触发。`,
        buttons: [
          { label: '取消', value: 'cancel', variant: 'outline' },
          { label: '停用', value: 'confirm', variant: 'destructive' },
        ],
      });
      if (ok !== 'confirm') return;
    }
    await setPlanEnabled(plan.id, enabled);
  };

  const handleDelete = async (plan: PlanWithNextRun) => {
    const running = runningMap.has(plan.id);
    const ok = await confirm({
      title: '删除计划',
      description: running
        ? `「${plan.name}」正在运行，删除后当前运行仍会完成，但计划不会再被触发。确定删除吗？`
        : `确定删除计划「${plan.name}」吗？此操作不可恢复。`,
      buttons: [
        { label: '取消', value: 'cancel', variant: 'outline' },
        { label: '删除', value: 'confirm', variant: 'destructive' },
      ],
    });
    if (ok === 'confirm') await deletePlan(plan.id);
  };

  const handleViewHistory = () => {
    closeSettings();
    window.location.hash = '#/run-history';
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <Button size="sm" onClick={() => { setEditingPlan(null); setEditorOpen(true); }}>
          <Plus className="w-4 h-4 mr-1" />
          新建计划
        </Button>
        <Button variant="outline" size="sm" onClick={handleViewHistory}>
          <History className="w-4 h-4 mr-1" />
          查看执行历史
        </Button>
        <Button variant="ghost" size="sm" className="ml-auto" onClick={() => loadPlans()} title="刷新计划列表">
          <RefreshCw className={cn('w-3.5 h-3.5', loading && 'animate-spin')} />
        </Button>
      </div>

      {plans.length === 0 && loading && (
        <p className="text-sm text-muted-foreground py-8 text-center">加载计划中…</p>
      )}
      {plans.length === 0 && !loading && loadingError && (
        <p className="text-sm text-destructive py-8 text-center">{loadingError}</p>
      )}
      {plans.length === 0 && !loading && !loadingError && (
        <p className="text-sm text-muted-foreground py-8 text-center">
          暂无计划，点击「新建计划」创建第一个定时计划
        </p>
      )}

      <div className="space-y-2">
        {plans.map((plan) => {
          const running = runningMap.get(plan.id);
          return (
            <div key={plan.id} className={cn('rounded-md border p-3 flex items-start gap-3', !plan.enabled && 'opacity-60')}>
              <div className="flex-1 min-w-0 space-y-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-sm font-medium truncate">{plan.name}</span>
                  {running && (
                    <Badge variant="secondary" className="gap-1 whitespace-nowrap">
                      <Loader2 className="w-3 h-3 animate-spin" />
                      运行中{running.currentTaskName ? `：${running.currentTaskName}` : ''}
                    </Badge>
                  )}
                </div>
                <div className="text-xs text-muted-foreground truncate">
                  {plan.tasks.length > 0 ? plan.tasks.map(describeTask).join(' → ') : '无任务'}
                </div>
                <div className="text-xs text-muted-foreground truncate">
                  {plan.triggers.length > 0
                    ? plan.triggers.map((t) => describeTrigger(t, planNameOf)).join('；')
                    : '无触发器'}
                </div>
              </div>
              <div className="flex flex-col items-end gap-2 shrink-0">
                <div className="flex items-center gap-2">
                  <span className="text-xs text-muted-foreground w-24 text-right truncate" title="下次运行">
                    {plan.nextRunAt ? formatRelativeFuture(plan.nextRunAt) : '—'}
                  </span>
                  <Switch checked={plan.enabled} onCheckedChange={(v) => handleToggle(plan, v)} />
                </div>
                <div className="flex items-center gap-1">
                  <Button variant="ghost" size="sm" className="h-7 px-2 text-xs"
                    onClick={() => { setEditingPlan(plan); setEditorOpen(true); }}>
                    <Pencil className="w-3.5 h-3.5 mr-1" />
                    编辑
                  </Button>
                  <Button variant="ghost" size="sm" className="h-7 px-2 text-xs"
                    onClick={() => runNow(plan.id)}
                    title={plan.enabled ? '立即运行' : '立即运行（计划已停用，本次仍会执行）'}>
                    <Play className="w-3.5 h-3.5 mr-1" />
                    运行
                  </Button>
                  <Button variant="ghost" size="sm" className="h-7 px-2 text-xs text-destructive hover:text-destructive"
                    onClick={() => handleDelete(plan)}>
                    <Trash2 className="w-3.5 h-3.5 mr-1" />
                    删除
                  </Button>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      <PlanEditor
        open={editorOpen}
        plan={editingPlan}
        workspaces={workspaces}
        onOpenChange={setEditorOpen}
      />
    </div>
  );
}
