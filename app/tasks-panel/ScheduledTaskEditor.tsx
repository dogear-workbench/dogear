import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, Check, Loader2, Pencil, Play, Square, Trash2 } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { ModelSelector } from '@/components/ModelSelector';
import { EffortSelector } from '@/components/EffortSelector';
import { resolveEffectiveEffort } from '@/lib/model-selection';
import { MarkdownRenderer } from '@/components/MarkdownRenderer';
import { useSettingsStore } from '@/stores/settings-store';
import { useSchedulerStore } from '@/stores/scheduler-store';
import { showConfirm } from '@/stores/confirm-store';
import type { ScheduledTask, ScheduledTaskWithNextRun } from '@/types/scheduler';
import { CustomAbilityMatrix } from './CustomAbilityMatrix';
import { TriggerListEditor } from './TriggerListEditor';
import { describeTrigger, findTriggerOverlaps, formatRelativeFuture } from './utils';
import type { WorkspaceOption } from './utils';

type SaveState = 'idle' | 'saving' | 'saved' | 'error';

function blankCustomTask(workspaceId: string): ScheduledTask {
  return {
    id: crypto.randomUUID(), kind: 'custom', name: '', prompt: '', enabled: true,
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
  onCreated: (planId: string) => void;
}

// 父组件以 key 挂载（'new' / planId）：换任务即重挂载，draft 自任务快照或落盘数据重建
export function ScheduledTaskEditor({ task, workspaces, defaultWorkspaceId, onExit, onCreated }: Props) {
  const settings = useSettingsStore((s) => s.settings);
  const schedulerTasks = useSchedulerStore((s) => s.tasks);
  const liveTask = useSchedulerStore((s) =>
    task === 'new' ? undefined : s.tasks.find((t) => t.id === task.id),
  );
  const running = useSchedulerStore((s) =>
    task === 'new'
      ? undefined
      : s.activity?.running.find((r) => r.taskId === task.id && r.source === 'scheduler'),
  );
  const saveTask = useSchedulerStore((s) => s.saveTask);
  const deleteTask = useSchedulerStore((s) => s.deleteTask);
  const setTaskEnabled = useSchedulerStore((s) => s.setTaskEnabled);
  const runTaskNow = useSchedulerStore((s) => s.runTaskNow);
  const stopTask = useSchedulerStore((s) => s.stopTask);

  const [draft, setDraft] = useState<ScheduledTask>(() =>
    task === 'new' ? blankCustomTask(defaultWorkspaceId ?? '') : toDraft(task),
  );
  const draftRef = useRef(draft);
  const flushRef = useRef<() => void>(() => {});
  const pendingRef = useRef<Partial<ScheduledTask>>({});
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const savedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saveState, setSaveState] = useState<SaveState>('idle');
  const [promptEditing, setPromptEditing] = useState(
    () => task === 'new' || (task.kind === 'custom' && !task.prompt.trim()),
  );

  const [, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 60_000);
    return () => clearInterval(id);
  }, []);

  const flush = async () => {
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    const err = validateDraft(draftRef.current, workspaces);
    if (err) {
      setError(err);
      return;
    }
    setError(null);
    const pending = pendingRef.current;
    if (Object.keys(pending).length === 0) return;
    pendingRef.current = {};
    setSaveState('saving');
    const ok = await saveTask(draftRef.current);
    if (ok) {
      setSaveState('saved');
      if (savedTimerRef.current !== null) clearTimeout(savedTimerRef.current);
      savedTimerRef.current = setTimeout(() => setSaveState('idle'), 1500);
      if (task === 'new') onCreated(draftRef.current.id);
    } else {
      pendingRef.current = { ...pending, ...pendingRef.current };
      setSaveState('error');
    }
  };

  useEffect(() => {
    flushRef.current = () => void flush();
  });

  useEffect(
    () => () => {
      void flushRef.current();
      if (savedTimerRef.current !== null) clearTimeout(savedTimerRef.current);
    },
    [],
  );

  const patch = (updates: Partial<ScheduledTask>) => {
    const next = { ...draftRef.current, ...updates } as ScheduledTask;
    draftRef.current = next;
    setDraft(next);
    pendingRef.current = { ...pendingRef.current, ...updates };
    setSaveState((s) => (s === 'error' || s === 'saving' ? s : 'idle'));
    if (timerRef.current !== null) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => void flushRef.current(), 800);
  };

  const overlaps = useMemo(() => findTriggerOverlaps(draft.triggers), [draft.triggers]);

  const triggerSummary = draft.triggers.length > 0
    ? draft.triggers
        .map((t) => describeTrigger(t, (id) => schedulerTasks.find((x) => x.id === id)?.name))
        .join('；')
    : '无触发器';

  const togglePromptEditing = () => {
    if (!promptEditing) {
      setPromptEditing(true);
      return;
    }
    setPromptEditing(false);
    void flushRef.current();
  };

  const handleDelete = async () => {
    if (task === 'new') return;
    const dependents = schedulerTasks.filter((t) =>
      t.triggers.some((tr) => tr.type === 'on_task_done' && tr.taskId === task.id),
    );
    const depHint = dependents.length > 0
      ? `《${dependents.map((d) => d.name).join('》《')}》由该任务完成触发，删除后其触发不再命中，建议一并更新或删除。`
      : '';
    const ok = await showConfirm(
      '删除任务',
      `「${liveTask?.name ?? task.name}」将永久删除，运行历史保留可查。${depHint}`,
    );
    if (!ok) return;
    await deleteTask(task.id);
    onExit();
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.nativeEvent.isComposing || e.defaultPrevented) return;
    if (e.key === 'Escape') {
      e.preventDefault();
      onExit();
    }
  };

  return (
    <div className="flex-1 flex flex-col min-w-0 min-h-0 bg-background" onKeyDown={handleKeyDown}>
      {task !== 'new' && !liveTask ? (
        <div className="flex-1 flex flex-col items-center justify-center gap-3 text-sm text-muted-foreground">
          任务不存在或已被删除
          <Button variant="outline" size="sm" onClick={onExit}>
            返回
          </Button>
        </div>
      ) : (
        <div className="flex-1 overflow-y-auto min-h-0 @container">
          <div className="flex w-full flex-col px-6 pt-8 pb-24">
            <div className="flex items-start gap-2">
              <input
                value={draft.name}
                onChange={(e) => patch({ name: e.target.value })}
                placeholder="任务名称"
                className="w-full min-w-0 bg-transparent text-2xl font-semibold outline-none placeholder:text-muted-foreground/40"
              />
              <div className="mt-1.5 flex shrink-0 items-center gap-1.5">
                {running && (
                  <Badge variant="secondary" className="gap-1">
                    <Loader2 className="w-3 h-3 animate-spin" />
                    运行中
                  </Badge>
                )}
                {liveTask && !liveTask.enabled && (
                  <Badge variant="outline" className="font-normal text-muted-foreground">已停用</Badge>
                )}
              </div>
            </div>

            <div className="mt-1.5 flex items-center gap-3 text-xs text-muted-foreground">
              <span className="min-w-0 truncate" title={triggerSummary}>{triggerSummary}</span>
              {liveTask?.nextRunAt && (
                <span className="shrink-0 tabular-nums">· 下次 {formatRelativeFuture(liveTask.nextRunAt)}</span>
              )}
              <span className="flex-1" />
              {saveState === 'saving' && <span>保存中…</span>}
              {saveState === 'saved' && <span>已保存</span>}
              {saveState === 'error' && (
                <span className="text-destructive" title="内容已保留，下次输入或切走时会重新保存">
                  保存失败
                </span>
              )}
              {task !== 'new' && (
                <Button
                  variant="ghost"
                  size="icon-xs"
                  onClick={() => void handleDelete()}
                  title="删除任务"
                  className="text-destructive hover:text-destructive"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </Button>
              )}
              <Button variant="ghost" size="icon-xs" onClick={onExit} title="返回（Esc）">
                <ArrowLeft className="w-3.5 h-3.5" />
              </Button>
            </div>

            {(error || overlaps) && (
              <div className="mt-4 space-y-2">
                {error && <p className="text-sm text-destructive">{error}</p>}
                {overlaps && (
                  <div className="rounded-md border border-yellow-500/40 bg-yellow-500/10 px-3 py-2 text-sm text-yellow-700 dark:text-yellow-400">
                    规则重叠，某些时刻会触发两次：{overlaps.join('；')}
                  </div>
                )}
              </div>
            )}

            {task !== 'new' && liveTask && (
              <div className="mt-4 flex items-center gap-2">
                {running ? (
                  <Button size="sm" variant="outline" onClick={() => stopTask(task.id)}>
                    <Square className="w-3.5 h-3.5" />
                    停止
                  </Button>
                ) : (
                  <Button size="sm" onClick={() => runTaskNow(task.id)}>
                    <Play className="w-3.5 h-3.5" />
                    立即运行
                  </Button>
                )}
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => void setTaskEnabled(task.id, !liveTask.enabled)}
                >
                  {liveTask.enabled ? '停用' : '启用'}
                </Button>
              </div>
            )}

            <div className="mt-6 grid grid-cols-1 gap-x-8 gap-y-6 @min-[960px]:grid-cols-[minmax(0,1fr)_340px]">
              <section className="flex flex-col gap-1.5 min-w-0">
                <div className="flex items-center gap-2">
                  <label className="text-xs font-medium text-muted-foreground">提示词</label>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-6 px-2 text-xs"
                    onClick={togglePromptEditing}
                  >
                    {promptEditing ? <Check className="size-3.5" /> : <Pencil className="size-3.5" />}
                    {promptEditing ? '完成' : '编辑'}
                  </Button>
                </div>
                {promptEditing ? (
                  <Textarea
                    className="flex-1 min-h-[160px] resize-none overflow-y-auto break-words text-sm font-mono"
                    value={draft.prompt ?? ''}
                    onChange={(e) => patch({ prompt: e.target.value })}
                    onKeyDown={(e) => {
                      if (e.key === 'Escape') {
                        e.stopPropagation();
                        setPromptEditing(false);
                      }
                    }}
                    placeholder="任务的完整提示词，将交给 AI 执行"
                  />
                ) : (
                  <div className="flex-1 min-h-[160px] overflow-y-auto break-words rounded-md border p-3">
                    {(draft.prompt ?? '').trim()
                      ? <MarkdownRenderer content={draft.prompt} />
                      : <p className="text-xs text-muted-foreground">提示词为空，点「编辑」填写</p>}
                  </div>
                )}
              </section>

              <div className="min-w-0 space-y-6">
              <section className="space-y-2">
                <label className="text-xs text-muted-foreground">触发器（任一命中即触发）</label>
                <TriggerListEditor
                  triggers={draft.triggers}
                  onChange={(triggers) => patch({ triggers })}
                  tasks={schedulerTasks.map((t) => ({ id: t.id, name: t.name }))}
                  selfTaskId={draft.id}
                />
              </section>

              <section className="space-y-2">
                <label className="text-xs text-muted-foreground">模型</label>
                <div className="flex gap-2">
                  <div className="flex-1 min-w-0">
                    <ModelSelector
                      settings={settings}
                      value={draft.modelSelection ?? null}
                      onChange={(v) => patch({ modelSelection: v ?? undefined })}
                      allowUnset={true}
                      triggerVariant="block"
                    />
                  </div>
                  <div className="w-32 shrink-0">
                    <EffortSelector
                      variant="block"
                      value={draft.modelSelection?.effort ?? null}
                      unsetLabel="跟随预设"
                      disabled={!draft.modelSelection}
                      effectiveValue={resolveEffectiveEffort(settings, draft.modelSelection ?? null)}
                      onChange={(v) => {
                        const sel = draft.modelSelection;
                        if (!sel) return;
                        const { effort: _dropped, ...rest } = sel;
                        patch({ modelSelection: v === null ? rest : { ...sel, effort: v } });
                      }}
                    />
                  </div>
                </div>
                <p className="text-xs text-muted-foreground">选「不指定」时回退到默认模型</p>
              </section>

              <section className="space-y-2">
                <label className="text-xs text-muted-foreground">工作区</label>
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
                <CustomAbilityMatrix
                  workspaceId={draft.workspaceId}
                  toolPacksOverride={draft.toolPacksOverride}
                  skillsOverride={draft.skillsOverride}
                  onChange={patch}
                />
              )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
