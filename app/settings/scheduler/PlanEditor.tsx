import { useEffect, useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useSchedulerStore } from '@/stores/scheduler-store';
import type { Plan, PlanWithNextRun } from '@/types/scheduler';
import { TaskListEditor } from './TaskListEditor';
import { TriggerListEditor } from './TriggerListEditor';
import type { WorkspaceOption } from './utils';

function blankPlan(): Plan {
  return { id: '', name: '', enabled: true, tasks: [], triggers: [], createdAt: 0, updatedAt: 0 };
}

function toDraft(plan: PlanWithNextRun): Plan {
  return {
    id: plan.id,
    name: plan.name,
    enabled: plan.enabled,
    tasks: structuredClone(plan.tasks),
    triggers: structuredClone(plan.triggers),
    createdAt: plan.createdAt,
    updatedAt: plan.updatedAt,
  };
}

function validateDraft(plan: Plan, workspaces: WorkspaceOption[]): string | null {
  if (!plan.name.trim()) return '计划名称不能为空';
  if (plan.tasks.length === 0) return '至少需要一个任务';
  const wsIds = new Set(workspaces.map((w) => w.id));
  for (const [i, t] of plan.tasks.entries()) {
    if (t.kind === 'custom') {
      if (!t.name.trim()) return `任务 ${i + 1}: 自定义任务名称不能为空`;
      if (!t.prompt.trim()) return `任务 ${i + 1}: 自定义任务 prompt 不能为空`;
      if (!t.workspaceId) return `任务 ${i + 1}: 自定义任务必须选择工作区`;
    }
    if (t.workspaceId && !wsIds.has(t.workspaceId)) return `任务 ${i + 1}: 所选工作区已不存在`;
  }
  for (const [i, t] of plan.triggers.entries()) {
    if (t.type === 'interval' && (!Number.isInteger(t.minutes) || t.minutes <= 0)) {
      return `触发器 ${i + 1}: 间隔分钟数须为正整数`;
    }
    if (t.type === 'once' && !(t.at > 0)) return `触发器 ${i + 1}: 请选择单次触发时间`;
    if ((t.type === 'window' && t.start === t.end) ||
        (t.type === 'on_window_close' && t.window.start === t.window.end)) {
      return `触发器 ${i + 1}: 窗口起止时间不能相同`;
    }
    if (t.type === 'on_plan_done' && !t.planId) return `触发器 ${i + 1}: 请选择依赖的计划`;
  }
  return null;
}

interface Props {
  open: boolean;
  plan: PlanWithNextRun | null;
  workspaces: WorkspaceOption[];
  onOpenChange: (open: boolean) => void;
}

export function PlanEditor({ open, plan, workspaces, onOpenChange }: Props) {
  const plans = useSchedulerStore((s) => s.plans);
  const savePlan = useSchedulerStore((s) => s.savePlan);
  const [draft, setDraft] = useState<Plan>(blankPlan);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) {
      setDraft(plan ? toDraft(plan) : blankPlan());
      setError(null);
    }
  }, [open, plan]);

  const handleSave = async () => {
    const err = validateDraft(draft, workspaces);
    if (err) {
      setError(err);
      return;
    }
    setSaving(true);
    const ok = await savePlan(draft);
    setSaving(false);
    if (ok) onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{plan ? '编辑计划' : '新建计划'}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <label className="text-sm font-medium">计划名称</label>
            <Input
              value={draft.name}
              onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))}
              placeholder="如：夜间维护"
            />
          </div>
          <div className="space-y-1.5">
            <label className="text-sm font-medium">任务（按顺序执行）</label>
            <TaskListEditor
              tasks={draft.tasks}
              workspaces={workspaces}
              onChange={(tasks) => setDraft((d) => ({ ...d, tasks }))}
            />
          </div>
          <div className="space-y-1.5">
            <label className="text-sm font-medium">触发器（任一命中即触发）</label>
            <TriggerListEditor
              triggers={draft.triggers}
              plans={plans}
              selfPlanId={draft.id}
              onChange={(triggers) => setDraft((d) => ({ ...d, triggers }))}
            />
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>取消</Button>
          <Button onClick={handleSave} disabled={saving}>{saving ? '保存中…' : '保存'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
