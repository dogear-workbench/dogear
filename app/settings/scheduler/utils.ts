import type { Trigger } from '@/types/scheduler';

const WEEKDAY_LABELS = ['日', '一', '二', '三', '四', '五', '六'];

export interface WeekdayChip {
  value: number;
  label: string;
}

export const WEEKDAY_CHIPS: WeekdayChip[] = WEEKDAY_LABELS.map((label, value) => ({ value, label }));

function weekdaysLabel(weekdays?: number[]): string {
  if (!weekdays || weekdays.length === 0) return '每天';
  const sorted = [...new Set(weekdays)].sort((a, b) => a - b);
  if (sorted.length === 7) return '每天';
  if (sorted.length === 5 && !sorted.includes(0) && !sorted.includes(6)) return '工作日';
  if (sorted.length === 2 && sorted.includes(0) && sorted.includes(6)) return '周末';
  return sorted.map((d) => `周${WEEKDAY_LABELS[d]}`).join('/');
}

function formatDateTime(ts: number): string {
  const d = new Date(ts);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function describeTrigger(
  trigger: Trigger,
  taskNameOf?: (taskId: string) => string | undefined,
): string {
  switch (trigger.type) {
    case 'daily_at':
      return `${weekdaysLabel(trigger.weekdays)} ${trigger.at}`;
    case 'interval':
      return `每 ${trigger.minutes} 分钟`;
    case 'window':
      return `${weekdaysLabel(trigger.weekdays)}窗口 ${trigger.start}–${trigger.end}`;
    case 'once':
      return `单次 ${formatDateTime(trigger.at)}`;
    case 'on_window_close':
      return `${weekdaysLabel(trigger.window.weekdays)}窗口 ${trigger.window.start}–${trigger.window.end} 关闭时`;
    case 'on_app_start':
      return '应用启动时';
    case 'on_session_close':
      return '会话关闭时';
    case 'on_task_done': {
      const name = taskNameOf?.(trigger.taskId);
      return name ? `任务「${name}」完成后` : '任务完成后';
    }
  }
}

export function formatRelativeFuture(ts: number): string {
  const diff = ts - Date.now();
  if (diff <= 60_000) return '即将运行';
  const minutes = Math.round(diff / 60_000);
  if (minutes < 60) return `${minutes} 分钟后`;
  const hours = Math.floor(minutes / 60);
  const rem = minutes % 60;
  if (hours < 24) return rem > 0 ? `${hours} 小时 ${rem} 分后` : `${hours} 小时后`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days} 天后`;
  const d = new Date(ts);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getMonth() + 1}/${d.getDate()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function tsToDatetimeLocal(ts: number): string {
  const d = new Date(ts);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function datetimeLocalToTs(v: string): number {
  const ts = new Date(v).getTime();
  return Number.isFinite(ts) ? ts : 0;
}

export interface WorkspaceOption {
  id: string;
  name: string;
}
