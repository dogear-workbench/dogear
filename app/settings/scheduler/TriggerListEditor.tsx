import { useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import type { PlanWithNextRun, Trigger } from '@/types/scheduler';
import { WEEKDAY_CHIPS, datetimeLocalToTs, describeTrigger, tsToDatetimeLocal } from './utils';

const TIME_TYPES = [
  { value: 'daily_at', label: '每天固定时刻' },
  { value: 'interval', label: '固定间隔' },
  { value: 'window', label: '时间窗口' },
  { value: 'once', label: '单次时刻' },
] as const;

const COND_TYPES = [
  { value: 'on_app_start', label: '应用启动时' },
  { value: 'on_session_close', label: '会话关闭时' },
  { value: 'on_window_close', label: '窗口关闭时（带时间参数）' },
  { value: 'on_plan_done', label: '其他计划完成后' },
] as const;

const TYPE_LABELS: Record<Trigger['type'], string> = {
  daily_at: '每天时刻',
  interval: '固定间隔',
  window: '时间窗口',
  once: '单次',
  on_app_start: '启动时',
  on_session_close: '关会话',
  on_window_close: '窗口关闭',
  on_plan_done: '链式',
};

const inputCls = 'h-7 px-2 text-xs border rounded-md bg-background focus:outline-none focus:ring-1 focus:ring-ring';

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

interface Props {
  triggers: Trigger[];
  plans: PlanWithNextRun[];
  selfPlanId: string;
  onChange: (triggers: Trigger[]) => void;
}

export function TriggerListEditor({ triggers, plans, selfPlanId, onChange }: Props) {
  const [timeDraft, setTimeDraft] = useState<(typeof TIME_TYPES)[number]['value'] | ''>('');
  const [condDraft, setCondDraft] = useState<(typeof COND_TYPES)[number]['value'] | ''>('');
  const otherPlans = plans.filter((p) => p.id !== selfPlanId);
  const planNameOf = (planId: string) => plans.find((p) => p.id === planId)?.name;

  const patch = (id: string, updates: Partial<Trigger>) => {
    onChange(triggers.map((t) => (t.id === id ? ({ ...t, ...updates } as Trigger) : t)));
  };

  const remove = (id: string) => onChange(triggers.filter((t) => t.id !== id));

  const add = (type: Trigger['type']) => {
    const id = crypto.randomUUID();
    let trigger: Trigger;
    switch (type) {
      case 'daily_at':
        trigger = { id, type: 'daily_at', at: '08:00' };
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
      case 'on_plan_done':
        trigger = { id, type: 'on_plan_done', planId: otherPlans[0]?.id ?? '' };
        break;
    }
    onChange([...triggers, trigger]);
  };

  const renderRow = (t: Trigger) => {
    let controls: React.ReactNode = null;
    switch (t.type) {
      case 'daily_at':
        controls = (
          <>
            <input type="time" className={inputCls} value={t.at}
              onChange={(e) => e.target.value && patch(t.id, { at: e.target.value })} />
            <WeekdayChips value={t.weekdays} onChange={(v) => patch(t.id, { weekdays: v })} />
          </>
        );
        break;
      case 'interval':
        controls = (
          <>
            <input type="number" min={1} className={cn(inputCls, 'w-20')} value={t.minutes || ''}
              onChange={(e) => patch(t.id, { minutes: Number(e.target.value) || 0 })} />
            <span className="text-xs text-muted-foreground">分钟</span>
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
      case 'on_plan_done':
        controls = (
          <select className={cn(inputCls, 'w-48')} value={t.planId}
            onChange={(e) => patch(t.id, { planId: e.target.value })}>
            {otherPlans.length === 0 && <option value="" disabled>暂无其他计划</option>}
            {otherPlans.map((p) => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>
        );
        break;
      default:
        controls = null;
    }
    return (
      <div key={t.id} className="flex flex-wrap items-center gap-2 rounded-md border px-2 py-1.5">
        <Badge variant="outline" className="text-[10px] shrink-0">{TYPE_LABELS[t.type]}</Badge>
        {controls}
        <span className="ml-auto text-xs text-muted-foreground truncate">{describeTrigger(t, planNameOf)}</span>
        <Button variant="ghost" size="sm" className="h-6 w-6 p-0 text-destructive hover:text-destructive shrink-0"
          onClick={() => remove(t.id)} title="删除规则">
          <Trash2 className="w-3.5 h-3.5" />
        </Button>
      </div>
    );
  };

  const timeTriggers = triggers.filter((t) => ['daily_at', 'interval', 'window', 'once'].includes(t.type));
  const condTriggers = triggers.filter((t) => !['daily_at', 'interval', 'window', 'once'].includes(t.type));

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
              <option key={opt.value} value={opt.value}
                disabled={opt.value === 'on_plan_done' && otherPlans.length === 0}>
                {opt.label}{opt.value === 'on_plan_done' && otherPlans.length === 0 ? '（暂无其他计划）' : ''}
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
