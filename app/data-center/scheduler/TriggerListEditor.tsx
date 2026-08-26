import { useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import type { Trigger } from '@/types/scheduler';
import { WEEKDAY_CHIPS, datetimeLocalToTs, describeTrigger, tsToDatetimeLocal } from './utils';

const TIME_TYPES = [
  { value: 'daily_at', label: '每天定点' },
  { value: 'weekly_at_entry', label: '每周定点' },
  { value: 'monthly_at', label: '每月定点' },
  { value: 'interval', label: '固定间隔' },
  { value: 'window', label: '时间窗口' },
  { value: 'once', label: '单次时刻' },
] as const;

const TIME_TRIGGER_TYPES: readonly Trigger['type'][] = ['daily_at', 'monthly_at', 'interval', 'window', 'once'];

const COND_TYPES = [
  { value: 'on_app_start', label: '应用启动时' },
  { value: 'on_session_close', label: '会话关闭时' },
  { value: 'on_window_close', label: '窗口关闭时（带时间参数）' },
  { value: 'on_task_done', label: '其他任务完成后' },
] as const;

const TYPE_LABELS: Record<Trigger['type'], string> = {
  daily_at: '每天时刻',
  monthly_at: '每月时刻',
  interval: '固定间隔',
  window: '时间窗口',
  once: '单次',
  on_app_start: '启动时',
  on_session_close: '关会话',
  on_window_close: '窗口关闭',
  on_task_done: '任务完成',
};

const inputCls = 'h-7 px-2 text-xs border rounded-md bg-background focus:outline-none focus:ring-1 focus:ring-ring';

const MONTH_GRID: (number | 'last')[] = [...Array.from({ length: 31 }, (_, i) => i + 1), 'last'];

function sameWeekdays(a: number[] | undefined, b: number[]): boolean {
  if (!a || a.length !== b.length) return false;
  const sorted = [...a].sort((x, y) => x - y);
  return sorted.every((v, i) => v === b[i]);
}

function WeekdayChips({ value, onChange }: { value: number[] | undefined; onChange: (v: number[] | undefined) => void }) {
  const selected = value ?? [0, 1, 2, 3, 4, 5, 6];
  const toggle = (d: number) => {
    let next: number[];
    if (selected.includes(d)) {
      if (selected.length <= 1) return;
      next = selected.filter((x) => x !== d);
    } else {
      next = [...selected, d].sort((a, b) => a - b);
    }
    onChange(next.length === 7 ? undefined : next);
  };
  return (
    <div className="flex items-center gap-1">
      {WEEKDAY_CHIPS.map((chip) => (
        <button
          key={chip.value}
          type="button"
          className={cn(
            'h-6 w-6 rounded-full text-xs border transition-colors',
            selected.includes(chip.value)
              ? 'bg-primary text-primary-foreground border-primary'
              : 'text-muted-foreground hover:bg-muted',
          )}
          onClick={() => toggle(chip.value)}
        >
          {chip.label}
        </button>
      ))}
    </div>
  );
}

interface PresetOption {
  label: string;
  active: boolean;
  onClick: () => void;
}

function PresetChips({ options }: { options: PresetOption[] }) {
  return (
    <div className="flex items-center gap-1">
      {options.map((opt) => (
        <button
          key={opt.label}
          type="button"
          className={cn(
            'h-6 rounded-full border px-2 text-xs transition-colors',
            opt.active
              ? 'bg-primary text-primary-foreground border-primary'
              : 'text-muted-foreground hover:bg-muted',
          )}
          onClick={opt.onClick}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}

interface Props {
  triggers: Trigger[];
  onChange: (triggers: Trigger[]) => void;
  tasks: { id: string; name: string }[];
  selfTaskId?: string;
}

export function TriggerListEditor({ triggers, onChange, tasks, selfTaskId }: Props) {
  const [timeDraft, setTimeDraft] = useState<(typeof TIME_TYPES)[number]['value'] | ''>('');
  const [condDraft, setCondDraft] = useState<(typeof COND_TYPES)[number]['value'] | ''>('');

  const patch = (id: string, updates: Partial<Trigger>) => {
    onChange(triggers.map((t) => (t.id === id ? ({ ...t, ...updates } as Trigger) : t)));
  };

  const remove = (id: string) => onChange(triggers.filter((t) => t.id !== id));

  const taskCandidates = tasks.filter((t) => t.id !== selfTaskId);
  const taskNameOf = (id: string) => tasks.find((t) => t.id === id)?.name;

  const add = (type: (typeof TIME_TYPES)[number]['value'] | (typeof COND_TYPES)[number]['value']) => {
    const id = crypto.randomUUID();
    let trigger: Trigger;
    switch (type) {
      case 'daily_at':
        trigger = { id, type: 'daily_at', at: '08:00' };
        break;
      case 'weekly_at_entry':
        trigger = { id, type: 'daily_at', at: '08:00', weekdays: [1] };
        break;
      case 'monthly_at':
        trigger = { id, type: 'monthly_at', at: '08:00', daysOfMonth: [1] };
        break;
      case 'interval':
        trigger = { id, type: 'interval', minutes: 60 };
        break;
      case 'window':
        trigger = { id, type: 'window', start: '03:00', end: '05:00' };
        break;
      case 'once':
        trigger = { id, type: 'once', at: Date.now() + 60 * 60_000 };
        break;
      case 'on_app_start':
        trigger = { id, type: 'on_app_start' };
        break;
      case 'on_session_close':
        trigger = { id, type: 'on_session_close' };
        break;
      case 'on_window_close':
        trigger = { id, type: 'on_window_close', window: { start: '03:00', end: '05:00' } };
        break;
      case 'on_task_done':
        trigger = { id, type: 'on_task_done', taskId: taskCandidates[0]?.id ?? '' };
        break;
    }
    onChange([...triggers, trigger]);
  };

  const dailyPresetOptions = (t: Extract<Trigger, { type: 'daily_at' }>): PresetOption[] => [
    { label: '每天', active: !t.weekdays || t.weekdays.length === 0, onClick: () => patch(t.id, { weekdays: undefined }) },
    { label: '工作日', active: sameWeekdays(t.weekdays, [1, 2, 3, 4, 5]), onClick: () => patch(t.id, { weekdays: [1, 2, 3, 4, 5] }) },
    { label: '周末', active: sameWeekdays(t.weekdays, [0, 6]), onClick: () => patch(t.id, { weekdays: [0, 6] }) },
  ];

  const monthlyPresetOptions = (t: Extract<Trigger, { type: 'monthly_at' }>): PresetOption[] => [
    { label: '月初', active: t.daysOfMonth.length === 1 && t.daysOfMonth[0] === 1, onClick: () => patch(t.id, { daysOfMonth: [1] }) },
    { label: '月中', active: t.daysOfMonth.length === 1 && t.daysOfMonth[0] === 15, onClick: () => patch(t.id, { daysOfMonth: [15] }) },
    { label: '月末', active: t.daysOfMonth.length === 1 && t.daysOfMonth[0] === 'last', onClick: () => patch(t.id, { daysOfMonth: ['last'] }) },
  ];

  const toggleDayOfMonth = (t: Extract<Trigger, { type: 'monthly_at' }>, d: number | 'last') => {
    const cur = t.daysOfMonth;
    if (cur.includes(d)) {
      if (cur.length <= 1) return;
      patch(t.id, { daysOfMonth: cur.filter((x) => x !== d) });
      return;
    }
    const nums = cur.filter((x): x is number => typeof x === 'number');
    if (typeof d === 'number') nums.push(d);
    nums.sort((a, b) => a - b);
    patch(t.id, { daysOfMonth: cur.includes('last') ? [...nums, 'last'] : nums });
  };

  const renderRow = (t: Trigger) => {
    let controls: React.ReactNode = null;
    switch (t.type) {
      case 'daily_at':
        controls = (
          <>
            <input type="time" className={inputCls} value={t.at}
              onChange={(e) => e.target.value && patch(t.id, { at: e.target.value })} />
            <PresetChips options={dailyPresetOptions(t)} />
            <WeekdayChips value={t.weekdays} onChange={(v) => patch(t.id, { weekdays: v })} />
          </>
        );
        break;
      case 'monthly_at':
        controls = (
          <>
            <input type="time" className={inputCls} value={t.at}
              onChange={(e) => e.target.value && patch(t.id, { at: e.target.value })} />
            <PresetChips options={monthlyPresetOptions(t)} />
            <div className="grid w-48 grid-cols-7 gap-1">
              {MONTH_GRID.map((d) => (
                <button
                  key={String(d)}
                  type="button"
                  className={cn(
                    'h-6 rounded-md border text-xs transition-colors',
                    t.daysOfMonth.includes(d)
                      ? 'bg-primary text-primary-foreground border-primary'
                      : 'text-muted-foreground hover:bg-muted',
                  )}
                  onClick={() => toggleDayOfMonth(t, d)}
                >
                  {d === 'last' ? '末' : d}
                </button>
              ))}
            </div>
          </>
        );
        break;
      case 'interval':
        controls = (
          <>
            <input type="number" min={1} className={cn(inputCls, 'w-20')} value={t.minutes || ''}
              onChange={(e) => patch(t.id, { minutes: Number(e.target.value) || 0 })} />
            <span className="text-xs text-muted-foreground">分钟</span>
            <WeekdayChips value={t.weekdays} onChange={(v) => patch(t.id, { weekdays: v })} />
          </>
        );
        break;
      case 'window':
        controls = (
          <>
            <input type="time" className={inputCls} value={t.start}
              onChange={(e) => e.target.value && patch(t.id, { start: e.target.value })} />
            <span className="text-xs text-muted-foreground">–</span>
            <input type="time" className={inputCls} value={t.end}
              onChange={(e) => e.target.value && patch(t.id, { end: e.target.value })} />
            <WeekdayChips value={t.weekdays} onChange={(v) => patch(t.id, { weekdays: v })} />
          </>
        );
        break;
      case 'once':
        controls = (
          <>
            <input type="datetime-local" className={inputCls} value={t.at > 0 ? tsToDatetimeLocal(t.at) : ''}
              onChange={(e) => patch(t.id, { at: e.target.value ? datetimeLocalToTs(e.target.value) : 0 })} />
            {t.fired && <Badge variant="secondary" className="text-[10px]">已触发</Badge>}
          </>
        );
        break;
      case 'on_window_close':
        controls = (
          <>
            <input type="time" className={inputCls} value={t.window.start}
              onChange={(e) => e.target.value && patch(t.id, { window: { ...t.window, start: e.target.value } })} />
            <span className="text-xs text-muted-foreground">–</span>
            <input type="time" className={inputCls} value={t.window.end}
              onChange={(e) => e.target.value && patch(t.id, { window: { ...t.window, end: e.target.value } })} />
            <WeekdayChips value={t.window.weekdays} onChange={(v) => patch(t.id, { window: { ...t.window, weekdays: v } })} />
          </>
        );
        break;
      case 'on_task_done': {
        const known = taskCandidates.some((c) => c.id === t.taskId);
        controls = (
          <select
            className={cn(inputCls, 'w-44')}
            value={known ? t.taskId : ''}
            onChange={(e) => patch(t.id, { taskId: e.target.value })}
          >
            {!known && <option value="" disabled>请选择任务</option>}
            {taskCandidates.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
        );
        break;
      }
      default:
        controls = null;
    }
    return (
      <div key={t.id} className="flex flex-wrap items-center gap-2 rounded-md border px-2 py-1.5">
        <Badge variant="outline" className="text-[10px] shrink-0">{TYPE_LABELS[t.type]}</Badge>
        {controls}
        <span className="ml-auto text-xs text-muted-foreground truncate">{describeTrigger(t, taskNameOf)}</span>
        <Button variant="ghost" size="sm" className="h-6 w-6 p-0 text-destructive hover:text-destructive shrink-0"
          onClick={() => remove(t.id)} title="删除规则">
          <Trash2 className="w-3.5 h-3.5" />
        </Button>
      </div>
    );
  };

  const timeTriggers = triggers.filter((t) => TIME_TRIGGER_TYPES.includes(t.type));
  const condTriggers = triggers.filter((t) => !TIME_TRIGGER_TYPES.includes(t.type));

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <div className="text-xs font-medium text-muted-foreground">时间规则（到点触发）</div>
        {timeTriggers.map(renderRow)}
        <div className="flex items-center gap-2">
          <select className={cn(inputCls, 'w-44')} value={timeDraft}
            onChange={(e) => setTimeDraft(e.target.value as (typeof TIME_TYPES)[number]['value'] | '')}>
            <option value="" disabled>选择规则类型…</option>
            {TIME_TYPES.map((opt) => (
              <option key={opt.value} value={opt.value}>{opt.label}</option>
            ))}
          </select>
          <Button variant="outline" size="sm" disabled={!timeDraft}
            onClick={() => { if (timeDraft) { add(timeDraft); setTimeDraft(''); } }}>
            <Plus className="w-3.5 h-3.5 mr-1" />
            添加
          </Button>
        </div>
      </div>

      <div className="space-y-2">
        <div className="text-xs font-medium text-muted-foreground">条件规则（事件触发）</div>
        {condTriggers.map(renderRow)}
        <div className="flex items-center gap-2">
          <select className={cn(inputCls, 'w-56')} value={condDraft}
            onChange={(e) => setCondDraft(e.target.value as (typeof COND_TYPES)[number]['value'] | '')}>
            <option value="" disabled>选择规则类型…</option>
            {COND_TYPES.map((opt) => (
              <option key={opt.value} value={opt.value} disabled={opt.value === 'on_task_done' && taskCandidates.length === 0}>
                {opt.value === 'on_task_done' && taskCandidates.length === 0 ? `${opt.label}（暂无可选任务）` : opt.label}
              </option>
            ))}
          </select>
          <Button variant="outline" size="sm" disabled={!condDraft}
            onClick={() => { if (condDraft) { add(condDraft); setCondDraft(''); } }}>
            <Plus className="w-3.5 h-3.5 mr-1" />
            添加
          </Button>
        </div>
      </div>
    </div>
  );
}
