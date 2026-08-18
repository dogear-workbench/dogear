import { useEffect, useState } from 'react';
import { Cog, Sparkles } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { ModelSelector } from '@/components/ModelSelector';
import { useSettingsStore } from '@/stores/settings-store';
import { useSchedulerStore } from '@/stores/scheduler-store';
import { useWorkspaceStore } from '@/stores/workspace-store';
import { cn } from '@/lib/utils';
import type {
  CustomScheduledTask,
  ScheduledTask,
  ScheduledTaskWithNextRun,
} from '@/types/scheduler';
import { TriggerListEditor } from './TriggerListEditor';
import type { WorkspaceOption } from './utils';

const selectCls = 'h-8 px-2 text-xs border rounded-md bg-background focus:outline-none focus:ring-1 focus:ring-ring w-52';

function blankCustomTask(workspaceId: string): CustomScheduledTask {
  return {
    id: '', kind: 'custom', name: '', prompt: '', enabled: true,
    triggers: [], workspaceId, createdAt: 0, updatedAt: 0,
  };
}

function toDraft(task: ScheduledTaskWithNextRun): ScheduledTask {
  const { nextRunAt: _nextRunAt, ...rest } = task;
  return structuredClone(rest);
}

function validateDraft(task: ScheduledTask, workspaces: WorkspaceOption[]): string | null {
  const wsIds = new Set(workspaces.map((w) => w.id));
  if (task.kind === 'custom') {
    if (!task.name.trim()) return '任务名称不能为空';
    if (!task.prompt.trim()) return '任务提示词不能为空';
    if (!task.workspaceId) return '自定义任务必须选择工作区';
  }
  if (task.workspaceId && !wsIds.has(task.workspaceId)) return '所选工作区已不存在';
  for (const [i, t] of task.triggers.entries()) {
    if (t.type === 'interval' && (!Number.isInteger(t.minutes) || t.minutes <= 0)) {
      return `触发器 ${i + 1}: 间隔分钟数须为正整数`;
    }
    if (t.type === 'once' && !(t.at > 0)) return `触发器 ${i + 1}: 请选择单次触发时间`;
    if ((t.type === 'window' && t.start === t.end) ||
        (t.type === 'on_window_close' && t.window.start === t.window.end)) {
      return `触发器 ${i + 1}: 窗口起止时间不能相同`;
    }
  }
  return null;
}

interface Props {
  open: boolean;
  task: ScheduledTaskWithNextRun | null;
  workspaces: WorkspaceOption[];
  onOpenChange: (open: boolean) => void;
}

export function TaskEditor({ open, task, workspaces, onOpenChange }: Props) {
  const activeWorkspaceId = useWorkspaceStore((s) => s.workspace?.id);
  const settings = useSettingsStore((s) => s.settings);
  const saveTask = useSchedulerStore((s) => s.saveTask);
  const [draft, setDraft] = useState<ScheduledTask>(() => blankCustomTask(''));
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) {
      setDraft(task ? toDraft(task) : blankCustomTask(activeWorkspaceId ?? ''));
      setError(null);
    }
  }, [open, task, activeWorkspaceId]);

  const patch = (updates: Partial<ScheduledTask>) => {
    setDraft((d) => ({ ...d, ...updates }) as ScheduledTask);
  };

  const handleSave = async () => {
    const err = validateDraft(draft, workspaces);
    if (err) {
      setError(err);
      return;
    }
    setSaving(true);
    const ok = await saveTask(draft);
    setSaving(false);
    if (ok) onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-4xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{task ? '编辑任务' : '新建任务'}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          {draft.kind === 'builtin' ? (
            <>
              <div className="space-y-1.5">
                <label className="text-sm font-medium">任务名称</label>
                <div className="flex items-center gap-2 h-8">
                  <Cog className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                  <span className="text-sm text-muted-foreground">{draft.name}</span>
                  <span className="text-xs text-muted-foreground">（内置任务，名称固定）</span>
                </div>
              </div>
              <div className="space-y-1.5">
                <label className="text-sm font-medium">工作区</label>
                <select
                  className={selectCls}
                  value={draft.workspaceId ?? ''}
                  onChange={(e) => {
                    const v = e.target.value;
                    patch({ workspaceId: v === '' ? undefined : v });
                  }}
                >
                  <option value="">全部工作区</option>
                  {workspaces.map((w) => (
                    <option key={w.id} value={w.id}>{w.name}</option>
                  ))}
                </select>
              </div>
            </>
          ) : (
            <>
              <div className="space-y-1.5">
                <label className="text-sm font-medium">任务名称</label>
                <div className="flex items-center gap-2">
                  <Sparkles className="w-4 h-4 text-primary shrink-0" />
                  <Input
                    value={draft.name}
                    onChange={(e) => patch({ name: e.target.value })}
                    placeholder="如：夜间维护提醒"
                  />
                </div>
              </div>
              <div className="space-y-1.5">
                <label className="text-sm font-medium">提示词</label>
                <Textarea
                  className="min-h-[140px] text-sm font-mono"
                  value={draft.prompt}
                  onChange={(e) => patch({ prompt: e.target.value })}
                  placeholder="任务的完整提示词，将交给 AI 执行"
                />
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm font-medium shrink-0">模型</span>
                <div className="min-w-[220px]">
                  <ModelSelector
                    settings={settings}
                    value={draft.modelSelection ?? null}
                    onChange={(v) => patch({ modelSelection: v ?? undefined })}
                    allowUnset={true}
                    triggerVariant="block"
                  />
                </div>
                <span className="text-xs text-muted-foreground">选「不指定」时回退到默认模型</span>
              </div>
              <div className="space-y-1.5">
                <label className="text-sm font-medium">工作区</label>
                <select
                  className={cn(selectCls)}
                  value={draft.workspaceId ?? ''}
                  onChange={(e) => patch({ workspaceId: e.target.value })}
                >
                  <option value="" disabled>选择工作区…</option>
                  {workspaces.map((w) => (
                    <option key={w.id} value={w.id}>{w.name}</option>
                  ))}
                </select>
              </div>
            </>
          )}
          <div className="space-y-1.5">
            <label className="text-sm font-medium">触发器（任一命中即触发）</label>
            <TriggerListEditor
              triggers={draft.triggers}
              onChange={(triggers) => patch({ triggers })}
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
