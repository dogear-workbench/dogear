import { useState } from 'react';
import { ArrowLeft, ChevronRight, Cog, Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { ModelSelector } from '@/components/ModelSelector';
import { useSettingsStore } from '@/stores/settings-store';
import { useSchedulerStore } from '@/stores/scheduler-store';
import { showConfirm } from '@/stores/confirm-store';
import type {
  CustomScheduledTask,
  ScheduledTask,
  ScheduledTaskWithNextRun,
} from '@/types/scheduler';
import { BuiltinParamsSection, BuiltinPromptSection } from './BuiltinTaskDetailSection';
import { CustomToolPacksSection } from './CustomToolPacksSection';
import { TriggerListEditor } from './TriggerListEditor';
import { findTriggerOverlaps } from './utils';
import type { WorkspaceOption } from './utils';

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
    if (t.type === 'on_task_done' && !t.taskId) return `触发器 ${i + 1}: 请选择上游任务`;
  }
  return null;
}

interface Props {
  task: 'new' | ScheduledTaskWithNextRun;
  workspaces: WorkspaceOption[];
  defaultWorkspaceId?: string;
  onExit: () => void;
}

export function TaskEditorPage({ task, workspaces, defaultWorkspaceId, onExit }: Props) {
  const settings = useSettingsStore((s) => s.settings);
  const schedulerTasks = useSchedulerStore((s) => s.tasks);
  const saveTask = useSchedulerStore((s) => s.saveTask);
  const [draft, setDraft] = useState<ScheduledTask>(() =>
    task === 'new' ? blankCustomTask(defaultWorkspaceId ?? '') : toDraft(task),
  );
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const patch = (updates: Partial<ScheduledTask>) => {
    setDraft((d) => ({ ...d, ...updates }) as ScheduledTask);
  };

  const handleSave = async () => {
    const err = validateDraft(draft, workspaces);
    if (err) {
      setError(err);
      return;
    }
    const overlaps = findTriggerOverlaps(draft.triggers);
    if (overlaps) {
      const proceed = await showConfirm(
        '存在重叠的时间规则',
        `以下规则会在某些时刻同时触发，任务将执行两次：${overlaps.join('；')}`,
      );
      if (!proceed) return;
    }
    setSaving(true);
    const ok = await saveTask(draft);
    setSaving(false);
    if (ok) onExit();
  };

  const title = task === 'new' ? '新建任务' : '编辑任务';

  return (
    <div className="h-full flex flex-col min-h-0">
      <div className="flex items-center gap-2 border-b px-4 py-2 shrink-0">
        <Button variant="ghost" size="sm" onClick={onExit}>
          <ArrowLeft className="w-4 h-4 mr-1" />
          返回
        </Button>
        <span className="text-sm text-muted-foreground">定时计划</span>
        <ChevronRight className="w-3.5 h-3.5 text-muted-foreground" />
        <span className="text-sm font-medium">{title}</span>
        <div className="ml-auto flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={onExit}>取消</Button>
          <Button size="sm" onClick={handleSave} disabled={saving}>
            {saving ? '保存中…' : '保存'}
          </Button>
        </div>
      </div>
      {error && (
        <p className="border-b bg-destructive/5 px-4 py-1.5 text-sm text-destructive">{error}</p>
      )}
      <div className="flex-1 flex min-h-0">
        <div className="flex-1 min-w-0 flex flex-col gap-4 p-4">
          {draft.kind === 'builtin' ? (
            <>
              <div className="flex items-center gap-2">
                <Cog className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                <span className="text-sm font-medium">{draft.name}</span>
                <span className="text-xs text-muted-foreground">（内置任务，名称固定）</span>
              </div>
              <BuiltinPromptSection builtinId={draft.builtinId} />
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
              <div className="flex-1 min-h-0 flex flex-col gap-1.5">
                <label className="text-sm font-medium">提示词</label>
                <Textarea
                  className="flex-1 min-h-0 resize-none field-sizing-fixed text-sm font-mono"
                  value={draft.prompt}
                  onChange={(e) => patch({ prompt: e.target.value })}
                  placeholder="任务的完整提示词，将交给 AI 执行"
                />
              </div>
            </>
          )}
        </div>
        <div className="w-80 shrink-0 space-y-4 overflow-y-auto border-l p-4">
          {draft.kind === 'builtin' ? (
            <>
              <section className="rounded-lg border bg-card p-3 space-y-2">
                <label className="text-sm font-medium">工作区</label>
                <Select
                  value={draft.workspaceId ?? 'all'}
                  onValueChange={(v) => patch({ workspaceId: v === 'all' ? undefined : v })}
                >
                  <SelectTrigger size="sm" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">全部工作区</SelectItem>
                    {workspaces.map((w) => (
                      <SelectItem key={w.id} value={w.id}>{w.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </section>
              <BuiltinParamsSection builtinId={draft.builtinId} />
              <section className="rounded-lg border bg-card p-3 space-y-2">
                <label className="text-sm font-medium">触发器（任一命中即触发）</label>
                <TriggerListEditor
                  triggers={draft.triggers}
                  onChange={(triggers) => patch({ triggers })}
                  tasks={schedulerTasks.map((t) => ({ id: t.id, name: t.name }))}
                  selfTaskId={draft.id || undefined}
                />
              </section>
            </>
          ) : (
            <>
              <section className="rounded-lg border bg-card p-3 space-y-2">
                <label className="text-sm font-medium">模型</label>
                <ModelSelector
                  settings={settings}
                  value={draft.modelSelection ?? null}
                  onChange={(v) => patch({ modelSelection: v ?? undefined })}
                  allowUnset={true}
                  triggerVariant="block"
                />
                <p className="text-xs text-muted-foreground">选「不指定」时回退到默认模型</p>
              </section>
              <section className="rounded-lg border bg-card p-3 space-y-2">
                <label className="text-sm font-medium">工作区</label>
                <Select
                  value={draft.workspaceId || undefined}
                  onValueChange={(v) => patch({ workspaceId: v })}
                >
                  <SelectTrigger size="sm" className="w-full">
                    <SelectValue placeholder="选择工作区…" />
                  </SelectTrigger>
                  <SelectContent>
                    {workspaces.map((w) => (
                      <SelectItem key={w.id} value={w.id}>{w.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </section>
              {draft.workspaceId && (
                <section className="rounded-lg border bg-card p-3">
                  <CustomToolPacksSection
                    workspaceId={draft.workspaceId}
                    override={draft.toolPacksOverride}
                    onChange={(v) => patch({ toolPacksOverride: v })}
                  />
                </section>
              )}
              <section className="rounded-lg border bg-card p-3 space-y-2">
                <label className="text-sm font-medium">触发器（任一命中即触发）</label>
                <TriggerListEditor
                  triggers={draft.triggers}
                  onChange={(triggers) => patch({ triggers })}
                  tasks={schedulerTasks.map((t) => ({ id: t.id, name: t.name }))}
                  selfTaskId={draft.id || undefined}
                />
              </section>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
