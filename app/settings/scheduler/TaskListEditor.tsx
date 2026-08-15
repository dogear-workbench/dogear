import { useState } from 'react';
import { ChevronDown, ChevronUp, Cog, Plus, Sparkles, Trash2, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { ModelSelector } from '@/components/ModelSelector';
import { useSettingsStore } from '@/stores/settings-store';
import { useWorkspaceStore } from '@/stores/workspace-store';
import { cn } from '@/lib/utils';
import type { BuiltinTaskId, CustomPlanTask, PlanTask } from '@/types/scheduler';
import { BUILTIN_TASK_LABELS, WorkspaceOption } from './utils';

const BUILTIN_OPTIONS: BuiltinTaskId[] = ['group_digest', 'review', 'categorize', 'categorize_organize'];

const selectCls = 'h-8 px-2 text-xs border rounded-md bg-background focus:outline-none focus:ring-1 focus:ring-ring';

interface Props {
  tasks: PlanTask[];
  workspaces: WorkspaceOption[];
  onChange: (tasks: PlanTask[]) => void;
}

export function TaskListEditor({ tasks, workspaces, onChange }: Props) {
  const activeWorkspaceId = useWorkspaceStore((s) => s.workspace?.id);
  const settings = useSettingsStore((s) => s.settings);
  const [builtinDraft, setBuiltinDraft] = useState<BuiltinTaskId | ''>('');
  const [customOpen, setCustomOpen] = useState(false);
  const [customDraft, setCustomDraft] = useState<CustomPlanTask>(() => ({
    id: '', kind: 'custom', name: '', prompt: '', workspaceId: '',
  }));

  const patch = (index: number, updates: Partial<PlanTask>) => {
    onChange(tasks.map((t, i) => (i === index ? ({ ...t, ...updates } as PlanTask) : t)));
  };

  const move = (index: number, delta: -1 | 1) => {
    const target = index + delta;
    if (target < 0 || target >= tasks.length) return;
    const next = [...tasks];
    [next[index], next[target]] = [next[target], next[index]];
    onChange(next);
  };

  const addBuiltin = () => {
    if (!builtinDraft) return;
    onChange([...tasks, { id: crypto.randomUUID(), kind: 'builtin', builtinId: builtinDraft }]);
    setBuiltinDraft('');
  };
  const addCustom = () => {
    if (!customDraft.name.trim() || !customDraft.prompt.trim()) return;
    onChange([...tasks, { ...customDraft, id: crypto.randomUUID() }]);
    setCustomDraft({ id: '', kind: 'custom', name: '', prompt: '', workspaceId: '' });
    setCustomOpen(false);
  };

  return (
    <div className="space-y-2">
      {tasks.length === 0 && (
        <p className="text-xs text-muted-foreground italic py-2 text-center">尚未添加任务</p>
      )}
      {tasks.map((task, index) => (
        <div key={task.id} className="flex items-center gap-2 rounded-md border px-2 py-1.5">
          {task.kind === 'builtin'
            ? <Cog className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
            : <Sparkles className="w-3.5 h-3.5 text-primary shrink-0" />}
          <span className="text-sm truncate min-w-0 max-w-[200px]">
            {task.kind === 'builtin' ? BUILTIN_TASK_LABELS[task.builtinId] : task.name}
          </span>
          <select
            className={cn(selectCls, 'ml-auto max-w-[180px]')}
            value={task.workspaceId ?? (task.kind === 'builtin' ? '' : '__unset__')}
            onChange={(e) => {
              const v = e.target.value;
              if (task.kind === 'builtin') {
                patch(index, { workspaceId: v === '' ? undefined : v });
              } else {
                patch(index, { workspaceId: v === '__unset__' ? '' : v });
              }
            }}
            title="任务工作区"
          >
            {task.kind === 'builtin' && <option value="">全部工作区</option>}
            {task.kind === 'custom' && <option value="__unset__" disabled>选择工作区…</option>}
            {workspaces.map((w) => (
              <option key={w.id} value={w.id}>{w.name}</option>
            ))}
          </select>
          <div className="flex items-center gap-0.5 shrink-0">
            <Button variant="ghost" size="sm" className="h-6 w-6 p-0" disabled={index === 0}
              onClick={() => move(index, -1)} title="上移">
              <ChevronUp className="w-3.5 h-3.5" />
            </Button>
            <Button variant="ghost" size="sm" className="h-6 w-6 p-0" disabled={index === tasks.length - 1}
              onClick={() => move(index, 1)} title="下移">
              <ChevronDown className="w-3.5 h-3.5" />
            </Button>
            <Button variant="ghost" size="sm" className="h-6 w-6 p-0 text-destructive hover:text-destructive"
              onClick={() => onChange(tasks.filter((_, i) => i !== index))} title="删除任务">
              <Trash2 className="w-3.5 h-3.5" />
            </Button>
          </div>
        </div>
      ))}

      <div className="flex flex-wrap items-center gap-2 pt-1">
        <select className={cn(selectCls, 'w-40')} value={builtinDraft} onChange={(e) => setBuiltinDraft(e.target.value as BuiltinTaskId | '')}>
          <option value="" disabled>选择内置任务…</option>
          {BUILTIN_OPTIONS.map((id) => (
            <option key={id} value={id}>{BUILTIN_TASK_LABELS[id]}</option>
          ))}
        </select>
        <Button variant="outline" size="sm" disabled={!builtinDraft} onClick={addBuiltin}>
          <Plus className="w-3.5 h-3.5 mr-1" />
          添加内置任务
        </Button>
        <div className="w-px h-5 bg-border mx-1" />
        <Button variant="outline" size="sm" onClick={() => {
          setCustomDraft({ id: '', kind: 'custom', name: '', prompt: '', workspaceId: activeWorkspaceId ?? '' });
          setCustomOpen(true);
        }}>
          <Sparkles className="w-3.5 h-3.5 mr-1" />
          添加自定义任务
        </Button>
      </div>

      {customOpen && (
        <div className="rounded-md border bg-muted/30 p-3 space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium">自定义任务</span>
            <Button variant="ghost" size="sm" className="h-6 w-6 p-0" onClick={() => setCustomOpen(false)}>
              <X className="w-3.5 h-3.5" />
            </Button>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground w-16 shrink-0">名称</span>
            <Input className="h-8 text-sm" value={customDraft.name}
              onChange={(e) => setCustomDraft((d) => ({ ...d, name: e.target.value }))}
              placeholder="如：夜间维护提醒" />
          </div>
          <div className="flex items-start gap-2">
            <span className="text-xs text-muted-foreground w-16 shrink-0 pt-1.5">Prompt</span>
            <Textarea className="min-h-[100px] text-sm font-mono" value={customDraft.prompt}
              onChange={(e) => setCustomDraft((d) => ({ ...d, prompt: e.target.value }))}
              placeholder="任务的完整提示词，将交给 AI 执行" />
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs text-muted-foreground w-16 shrink-0">模型</span>
            <div className="min-w-[220px]">
              <ModelSelector
                settings={settings}
                value={customDraft.modelSelection ?? null}
                onChange={(v) => setCustomDraft((d) => ({ ...d, modelSelection: v ?? undefined }))}
                allowUnset={true}
                triggerVariant="block"
              />
            </div>
            <span className="text-xs text-muted-foreground">选「不指定」时回退到默认模型</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground w-16 shrink-0">工作区</span>
            <select className={cn(selectCls, 'w-52')} value={customDraft.workspaceId}
              onChange={(e) => setCustomDraft((d) => ({ ...d, workspaceId: e.target.value }))}>
              <option value="" disabled>选择工作区…</option>
              {workspaces.map((w) => (
                <option key={w.id} value={w.id}>{w.name}</option>
              ))}
            </select>
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="outline" size="sm" onClick={() => setCustomOpen(false)}>取消</Button>
            <Button size="sm" disabled={!customDraft.name.trim() || !customDraft.prompt.trim() || !customDraft.workspaceId}
              onClick={addCustom}>
              添加
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
