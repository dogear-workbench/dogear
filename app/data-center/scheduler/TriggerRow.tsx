import {
  CalendarClock,
  CalendarDays,
  ChevronDown,
  Clock,
  Hourglass,
  Link,
  LogOut,
  MousePointerClick,
  Timer,
  Trash2,
  Zap,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { cn } from '@/lib/utils';
import type { Trigger } from '@/types/scheduler';
import { datetimeLocalToTs, describeTrigger, tsToDatetimeLocal } from './utils';
import { Field, inputCls, MONTH_GRID, PresetChips, sameWeekdays, WeekdayChips } from './TriggerControls';

const TYPE_ICONS: Record<Trigger['type'], LucideIcon> = {
  daily_at: Clock,
  monthly_at: CalendarDays,
  interval: Timer,
  window: Hourglass,
  once: CalendarClock,
  on_app_start: Zap,
  on_session_close: LogOut,
  on_window_close: MousePointerClick,
  on_task_done: Link,
};

interface Props {
  trigger: Trigger;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  patch: (updates: Partial<Trigger>) => void;
  onRemove: () => void;
  taskCandidates: { id: string; name: string }[];
  taskNameOf: (taskId: string) => string | undefined;
}

export function TriggerRow({ trigger: t, open, onOpenChange, patch, onRemove, taskCandidates, taskNameOf }: Props) {
  const Icon = TYPE_ICONS[t.type];
  return (
    <Collapsible open={open} onOpenChange={onOpenChange}>
      <div className="rounded-md border">
        <div className="flex items-center">
          <CollapsibleTrigger asChild>
            <button type="button" className="flex h-8 min-w-0 flex-1 items-center gap-2 px-2 text-left">
              <Icon className="size-3.5 shrink-0 text-muted-foreground" />
              <span className="min-w-0 flex-1 truncate text-xs">{describeTrigger(t, taskNameOf)}</span>
              <ChevronDown
                className={cn('size-3.5 shrink-0 text-muted-foreground transition-transform', open && 'rotate-180')}
              />
            </button>
          </CollapsibleTrigger>
          <Button
            variant="ghost"
            size="sm"
            className="h-6 w-6 shrink-0 p-0 text-destructive hover:text-destructive"
            onClick={onRemove}
            title="删除规则"
          >
            <Trash2 className="size-3.5" />
          </Button>
        </div>
        <CollapsibleContent>
          <div className="space-y-2.5 border-t px-2 py-2">
            <RowForm trigger={t} patch={patch} taskCandidates={taskCandidates} />
          </div>
        </CollapsibleContent>
      </div>
    </Collapsible>
  );
}

interface RowFormProps {
  trigger: Trigger;
  patch: (updates: Partial<Trigger>) => void;
  taskCandidates: { id: string; name: string }[];
}

function RowForm({ trigger: t, patch, taskCandidates }: RowFormProps) {
  switch (t.type) {
    case 'daily_at':
      return (
        <>
          <Field label="触发时间">
            <input type="time" className={inputCls} value={t.at}
              onChange={(e) => e.target.value && patch({ at: e.target.value })} />
          </Field>
          <Field label="重复日">
            <div className="space-y-1">
              <PresetChips options={[
                { label: '每天', active: !t.weekdays || t.weekdays.length === 0, onClick: () => patch({ weekdays: undefined }) },
                { label: '工作日', active: sameWeekdays(t.weekdays, [1, 2, 3, 4, 5]), onClick: () => patch({ weekdays: [1, 2, 3, 4, 5] }) },
                { label: '周末', active: sameWeekdays(t.weekdays, [0, 6]), onClick: () => patch({ weekdays: [0, 6] }) },
              ]} />
              <WeekdayChips value={t.weekdays} onChange={(v) => patch({ weekdays: v })} />
            </div>
          </Field>
        </>
      );
    case 'monthly_at':
      return (
        <>
          <Field label="触发时间">
            <input type="time" className={inputCls} value={t.at}
              onChange={(e) => e.target.value && patch({ at: e.target.value })} />
          </Field>
          <Field label="日期预设">
            <PresetChips options={[
              { label: '月初', active: t.daysOfMonth.length === 1 && t.daysOfMonth[0] === 1, onClick: () => patch({ daysOfMonth: [1] }) },
              { label: '月中', active: t.daysOfMonth.length === 1 && t.daysOfMonth[0] === 15, onClick: () => patch({ daysOfMonth: [15] }) },
              { label: '月末', active: t.daysOfMonth.length === 1 && t.daysOfMonth[0] === 'last', onClick: () => patch({ daysOfMonth: ['last'] }) },
            ]} />
          </Field>
          <Field label="选择日期">
            <div className="grid grid-cols-7 gap-1">
              {MONTH_GRID.map((d) => (
                <button
                  key={String(d)}
                  type="button"
                  className={cn(
                    'h-6 rounded-md border text-xs transition-colors',
                    t.daysOfMonth.includes(d)
                      ? 'border-primary bg-primary text-primary-foreground'
                      : 'text-muted-foreground hover:bg-muted',
                  )}
                  onClick={() => {
                    const cur = t.daysOfMonth;
                    if (cur.includes(d)) {
                      if (cur.length <= 1) return;
                      patch({ daysOfMonth: cur.filter((x) => x !== d) });
                      return;
                    }
                    const nums = cur.filter((x): x is number => typeof x === 'number');
                    if (typeof d === 'number') nums.push(d);
                    nums.sort((a, b) => a - b);
                    patch({ daysOfMonth: cur.includes('last') ? [...nums, 'last'] : nums });
                  }}
                >
                  {d === 'last' ? '末' : d}
                </button>
              ))}
            </div>
          </Field>
        </>
      );
    case 'interval':
      return (
        <>
          <Field label="间隔分钟">
            <input type="number" min={1} className={inputCls} value={t.minutes || ''}
              onChange={(e) => patch({ minutes: Number(e.target.value) || 0 })} />
          </Field>
          <Field label="生效日">
            <WeekdayChips value={t.weekdays} onChange={(v) => patch({ weekdays: v })} />
          </Field>
        </>
      );
    case 'window':
      return (
        <>
          <Field label="窗口时段">
            <div className="flex items-center gap-1.5">
              <input type="time" className={cn(inputCls, 'flex-1')} value={t.start}
                onChange={(e) => e.target.value && patch({ start: e.target.value })} />
              <span className="text-xs text-muted-foreground">–</span>
              <input type="time" className={cn(inputCls, 'flex-1')} value={t.end}
                onChange={(e) => e.target.value && patch({ end: e.target.value })} />
            </div>
          </Field>
          <Field label="生效日">
            <WeekdayChips value={t.weekdays} onChange={(v) => patch({ weekdays: v })} />
          </Field>
        </>
      );
    case 'once':
      return (
        <>
          <Field label="触发时刻">
            <input type="datetime-local" className={inputCls} value={t.at > 0 ? tsToDatetimeLocal(t.at) : ''}
              onChange={(e) => patch({ at: e.target.value ? datetimeLocalToTs(e.target.value) : 0 })} />
          </Field>
          {t.fired && <Badge variant="secondary" className="text-[10px]">已触发</Badge>}
        </>
      );
    case 'on_window_close':
      return (
        <>
          <Field label="窗口时段">
            <div className="flex items-center gap-1.5">
              <input type="time" className={cn(inputCls, 'flex-1')} value={t.window.start}
                onChange={(e) => e.target.value && patch({ window: { ...t.window, start: e.target.value } })} />
              <span className="text-xs text-muted-foreground">–</span>
              <input type="time" className={cn(inputCls, 'flex-1')} value={t.window.end}
                onChange={(e) => e.target.value && patch({ window: { ...t.window, end: e.target.value } })} />
            </div>
          </Field>
          <Field label="生效日">
            <WeekdayChips value={t.window.weekdays} onChange={(v) => patch({ window: { ...t.window, weekdays: v } })} />
          </Field>
        </>
      );
    case 'on_task_done': {
      const known = taskCandidates.some((c) => c.id === t.taskId);
      return (
        <Field label="上游任务">
          <Select
            value={known ? t.taskId : undefined}
            onValueChange={(v) => patch({ taskId: v })}
            disabled={taskCandidates.length === 0}
          >
            <SelectTrigger size="sm" className="h-7 w-full text-xs">
              <SelectValue placeholder={taskCandidates.length === 0 ? '暂无可选任务' : '请选择任务'} />
            </SelectTrigger>
            <SelectContent>
              {taskCandidates.length === 0 ? (
                <SelectItem value="none" disabled>暂无可选任务</SelectItem>
              ) : (
                taskCandidates.map((c) => (
                  <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                ))
              )}
            </SelectContent>
          </Select>
        </Field>
      );
    }
    default:
      return <p className="text-xs text-muted-foreground">事件规则，无可配置参数</p>;
  }
}
