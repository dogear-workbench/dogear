import { useState } from 'react';
import {
  CalendarClock,
  CalendarDays,
  CalendarRange,
  Clock,
  Hourglass,
  Link,
  LogOut,
  MousePointerClick,
  Plus,
  Timer,
  Zap,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import type { Trigger } from '@/types/scheduler';
import { TriggerRow } from './TriggerRow';

type AddableType =
  | 'daily_at' | 'weekly_at_entry' | 'monthly_at' | 'interval' | 'window' | 'once'
  | 'on_app_start' | 'on_session_close' | 'on_window_close' | 'on_task_done';

interface AddOption {
  value: AddableType;
  label: string;
  desc: string;
  icon: LucideIcon;
}

const TIME_ADD_OPTIONS: AddOption[] = [
  { value: 'daily_at', label: '每天定点', desc: '固定时刻触发，可选工作日/周末', icon: Clock },
  { value: 'weekly_at_entry', label: '每周定点', desc: '指定星期几的固定时刻', icon: CalendarRange },
  { value: 'monthly_at', label: '每月定点', desc: '指定每月几号的固定时刻', icon: CalendarDays },
  { value: 'interval', label: '固定间隔', desc: '每隔 N 分钟触发一次', icon: Timer },
  { value: 'window', label: '时间窗口', desc: '窗口开始时触发、结束时自动停止', icon: Hourglass },
  { value: 'once', label: '单次时刻', desc: '仅在指定时间触发一次', icon: CalendarClock },
];

const COND_ADD_OPTIONS: AddOption[] = [
  { value: 'on_app_start', label: '应用启动时', desc: '每次应用启动后触发', icon: Zap },
  { value: 'on_session_close', label: '会话关闭时', desc: '任一会话结束时触发', icon: LogOut },
  { value: 'on_window_close', label: '窗口关闭时', desc: '指定时段内窗口关闭时触发', icon: MousePointerClick },
  { value: 'on_task_done', label: '其他任务完成后', desc: '选定的上游任务完成后触发', icon: Link },
];

interface Props {
  triggers: Trigger[];
  onChange: (triggers: Trigger[]) => void;
  tasks: { id: string; name: string }[];
  selfTaskId?: string;
}

export function TriggerListEditor({ triggers, onChange, tasks, selfTaskId }: Props) {
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const patch = (id: string, updates: Partial<Trigger>) => {
    onChange(triggers.map((t) => (t.id === id ? ({ ...t, ...updates } as Trigger) : t)));
  };

  const remove = (id: string) => onChange(triggers.filter((t) => t.id !== id));

  const taskCandidates = tasks.filter((t) => t.id !== selfTaskId);
  const taskNameOf = (id: string) => tasks.find((t) => t.id === id)?.name;

  const add = (type: AddableType) => {
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
    setExpandedId(id);
  };

  return (
    <div className="space-y-2">
      {triggers.length === 0 && (
        <p className="text-xs text-muted-foreground">暂无规则，从下方添加</p>
      )}
      {triggers.map((t) => (
        <TriggerRow
          key={t.id}
          trigger={t}
          open={expandedId === t.id}
          onOpenChange={(open) => setExpandedId(open ? t.id : null)}
          patch={(updates) => patch(t.id, updates)}
          onRemove={() => remove(t.id)}
          taskCandidates={taskCandidates}
          taskNameOf={taskNameOf}
        />
      ))}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="outline" size="sm" className="w-full">
            <Plus className="size-3.5" />
            添加规则
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-64">
          <DropdownMenuLabel className="text-xs">时间规则</DropdownMenuLabel>
          {TIME_ADD_OPTIONS.map((opt) => (
            <DropdownMenuItem key={opt.value} onSelect={() => add(opt.value)}>
              <opt.icon />
              <div className="flex flex-col gap-0.5">
                <span>{opt.label}</span>
                <span className="text-xs text-muted-foreground">{opt.desc}</span>
              </div>
            </DropdownMenuItem>
          ))}
          <DropdownMenuSeparator />
          <DropdownMenuLabel className="text-xs">条件事件</DropdownMenuLabel>
          {COND_ADD_OPTIONS.map((opt) => (
            <DropdownMenuItem
              key={opt.value}
              onSelect={() => add(opt.value)}
              disabled={opt.value === 'on_task_done' && taskCandidates.length === 0}
            >
              <opt.icon />
              <div className="flex flex-col gap-0.5">
                <span>{opt.label}</span>
                <span className="text-xs text-muted-foreground">{opt.desc}</span>
              </div>
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
