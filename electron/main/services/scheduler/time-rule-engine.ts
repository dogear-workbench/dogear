import type { ScheduledTask, Trigger, WindowSpec } from './types.js';

const MINUTE_MS = 60_000;

export interface MissedTrigger {
  triggerId: string;
  missedAt: number;
  desc: string;
}

const HHMM_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;

function parseHHmm(v: string): number | null {
  if (typeof v !== 'string') return null;
  const m = HHMM_RE.exec(v);
  if (!m) return null;
  return Number(m[1]) * 60 + Number(m[2]);
}

function minutesOfDay(ts: number): number {
  const d = new Date(ts);
  return d.getHours() * 60 + d.getMinutes();
}

function occurrenceOnDay(refTs: number, dayOffset: number, minutes: number): number {
  const d = new Date(refTs);
  d.setDate(d.getDate() + dayOffset);
  d.setHours(Math.floor(minutes / 60), minutes % 60, 0, 0);
  return d.getTime();
}

function dayOfWeekOnDay(refTs: number, dayOffset: number): number {
  const d = new Date(refTs);
  d.setDate(d.getDate() + dayOffset);
  return d.getDay();
}

function weekdayOk(weekdays: number[] | undefined, dow: number): boolean {
  if (!weekdays) return true;
  return weekdays.includes(dow);
}

function alignToMinute(ts: number): number {
  return Math.floor(ts / MINUTE_MS) * MINUTE_MS;
}

function windowSpecOf(trigger: Trigger): WindowSpec | null {
  if (trigger.type === 'window') return { start: trigger.start, end: trigger.end, weekdays: trigger.weekdays };
  if (trigger.type === 'on_window_close') return trigger.window;
  return null;
}

function nextDailyOccurrence(
  minutes: number,
  weekdays: number[] | undefined,
  now: number,
  anchor: number | null,
): number | null {
  if (anchor === null) {
    for (let off = 0; off <= 8; off++) {
      if (!weekdayOk(weekdays, dayOfWeekOnDay(now, off))) continue;
      const occ = occurrenceOnDay(now, off, minutes);
      if (occ >= now) return occ;
    }
    return null;
  }
  for (let off = -7; off <= 8; off++) {
    if (!weekdayOk(weekdays, dayOfWeekOnDay(now, off))) continue;
    const occ = occurrenceOnDay(now, off, minutes);
    if (occ > anchor) return occ;
  }
  return null;
}

function isLastDayOfMonth(ts: number): boolean {
  const d = new Date(ts);
  d.setDate(d.getDate() + 1);
  return d.getDate() === 1;
}

function monthlyDayOk(daysOfMonth: (number | 'last')[], ts: number): boolean {
  const d = new Date(ts);
  if (daysOfMonth.includes(d.getDate())) return true;
  return daysOfMonth.includes('last') && isLastDayOfMonth(ts);
}

function nextMonthlyOccurrence(
  minutes: number,
  daysOfMonth: (number | 'last')[],
  now: number,
  anchor: number | null,
): number | null {
  if (anchor === null) {
    for (let off = 0; off <= 62; off++) {
      const occ = occurrenceOnDay(now, off, minutes);
      if (!monthlyDayOk(daysOfMonth, occ)) continue;
      if (occ >= now) return occ;
    }
    return null;
  }
  for (let off = -62; off <= 62; off++) {
    const occ = occurrenceOnDay(now, off, minutes);
    if (!monthlyDayOk(daysOfMonth, occ)) continue;
    if (occ > anchor) return occ;
  }
  return null;
}

function missedDailyAt(at: string, weekdays: number[] | undefined, anchor: number | null, bootAt: number): number | null {
  const m = parseHHmm(at);
  if (m === null) return null;
  for (let off = 0; off >= -7; off--) {
    if (!weekdayOk(weekdays, dayOfWeekOnDay(bootAt, off))) continue;
    const occ = occurrenceOnDay(bootAt, off, m);
    if (occ > bootAt) continue;
    if (anchor !== null && occ <= anchor) return null;
    return occ;
  }
  return null;
}

function shiftIntervalToWeekday(due: number, weekdays: number[] | undefined): number {
  if (!weekdays) return due;
  for (let off = 0; off <= 7; off++) {
    if (!weekdayOk(weekdays, dayOfWeekOnDay(due, off))) continue;
    return occurrenceOnDay(due, off, minutesOfDay(due));
  }
  return due;
}

function missedMonthlyAt(
  daysOfMonth: (number | 'last')[],
  at: string,
  anchor: number | null,
  bootAt: number,
): number | null {
  const m = parseHHmm(at);
  if (m === null) return null;
  for (let off = 0; off >= -62; off--) {
    const occ = occurrenceOnDay(bootAt, off, m);
    if (!monthlyDayOk(daysOfMonth, occ)) continue;
    if (occ > bootAt) continue;
    if (anchor !== null && occ <= anchor) return null;
    return occ;
  }
  return null;
}

function missedIntervalAt(
  minutes: number,
  weekdays: number[] | undefined,
  anchor: number | null,
  bootAt: number,
): number | null {
  if (anchor === null || !Number.isFinite(minutes) || minutes <= 0) return null;
  const step = minutes * MINUTE_MS;
  const span = bootAt - anchor;
  if (span < step) return null;
  const k = Math.floor(span / step);
  const shifted = shiftIntervalToWeekday(anchor + k * step, weekdays);
  return shifted <= bootAt ? shifted : null;
}

function missedWindowCloseAt(spec: WindowSpec, anchor: number | null, bootAt: number): number | null {
  const startMin = parseHHmm(spec.start);
  const endMin = parseHHmm(spec.end);
  if (startMin === null || endMin === null || startMin === endMin) return null;
  const cross = startMin > endMin;
  for (let off = 0; off >= -7; off--) {
    if (!weekdayOk(spec.weekdays, dayOfWeekOnDay(bootAt, off))) continue;
    const close = occurrenceOnDay(bootAt, cross ? off + 1 : off, endMin);
    if (close > bootAt) continue;
    if (anchor !== null && close <= anchor) return null;
    return close;
  }
  return null;
}

const WEEKDAY_LABELS = ['日', '一', '二', '三', '四', '五', '六'];

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

function daysOfMonthLabel(daysOfMonth: (number | 'last')[]): string {
  const hasLast = daysOfMonth.includes('last');
  const nums = [...new Set(daysOfMonth.filter((d): d is number => typeof d === 'number'))].sort((a, b) => a - b);
  if (hasLast && nums.length === 0) return '每月末';
  const parts = nums.map(String);
  if (hasLast) parts.push('末');
  return `每月 ${parts.join('/')} 号`;
}

export function describeTrigger(
  trigger: Trigger,
  taskNameOf?: (taskId: string) => string | undefined,
): string {
  switch (trigger.type) {
    case 'daily_at':
      return `${weekdaysLabel(trigger.weekdays)} ${trigger.at}`;
    case 'monthly_at':
      return `${daysOfMonthLabel(trigger.daysOfMonth)} ${trigger.at}`;
    case 'interval': {
      const days = weekdaysLabel(trigger.weekdays);
      return days === '每天' ? `每 ${trigger.minutes} 分钟` : `${days}每 ${trigger.minutes} 分钟`;
    }
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

export function nextDueAt(trigger: Trigger, now: number): number | null {
  const anchor = trigger.lastFiredAt ?? null;
  switch (trigger.type) {
    case 'daily_at': {
      const m = parseHHmm(trigger.at);
      if (m === null) return null;
      return nextDailyOccurrence(m, trigger.weekdays, now, anchor);
    }
    case 'monthly_at': {
      const m = parseHHmm(trigger.at);
      if (m === null) return null;
      return nextMonthlyOccurrence(m, trigger.daysOfMonth, now, anchor);
    }
    case 'interval': {
      if (!Number.isFinite(trigger.minutes) || trigger.minutes <= 0) return null;
      const aligned = alignToMinute(now);
      if (anchor === null) return shiftIntervalToWeekday(aligned, trigger.weekdays);
      return shiftIntervalToWeekday(Math.max(anchor + trigger.minutes * MINUTE_MS, aligned), trigger.weekdays);
    }
    case 'once':
      return trigger.fired ? null : trigger.at;
    default:
      return null;
  }
}

export function windowOpen(trigger: Trigger, now: number): boolean {
  const spec = windowSpecOf(trigger);
  if (!spec) return false;
  const startMin = parseHHmm(spec.start);
  const endMin = parseHHmm(spec.end);
  if (startMin === null || endMin === null || startMin === endMin) return false;
  const nowMin = minutesOfDay(now);
  const dow = new Date(now).getDay();
  if (startMin < endMin) {
    return nowMin >= startMin && nowMin < endMin && weekdayOk(spec.weekdays, dow);
  }
  // 跨午夜：start > end 时前半夜按当天判定，后半夜按前一天（窗口起始日）判定
  const prevDow = (dow + 6) % 7;
  return (
    (nowMin >= startMin && weekdayOk(spec.weekdays, dow)) ||
    (nowMin < endMin && weekdayOk(spec.weekdays, prevDow))
  );
}

export function windowCloseAt(trigger: Trigger, now: number): number | null {
  const spec = windowSpecOf(trigger);
  if (!spec) return null;
  const startMin = parseHHmm(spec.start);
  const endMin = parseHHmm(spec.end);
  if (startMin === null || endMin === null || startMin === endMin) return null;
  const cross = startMin > endMin;
  for (let off = -1; off <= 8; off++) {
    if (!weekdayOk(spec.weekdays, dayOfWeekOnDay(now, off))) continue;
    const close = occurrenceOnDay(now, cross ? off + 1 : off, endMin);
    if (close >= now) return close;
  }
  return null;
}

export function windowStartAt(trigger: Trigger, now: number): number | null {
  const spec = windowSpecOf(trigger);
  if (!spec) return null;
  const startMin = parseHHmm(spec.start);
  if (startMin === null) return null;
  for (let off = 0; off <= 8; off++) {
    if (!weekdayOk(spec.weekdays, dayOfWeekOnDay(now, off))) continue;
    const start = occurrenceOnDay(now, off, startMin);
    if (start > now) return start;
  }
  return null;
}

export function minNextDueAt(task: ScheduledTask, now: number): number | null {
  const candidates: number[] = [];
  for (const t of task.triggers) {
    switch (t.type) {
      case 'daily_at': {
        const m = parseHHmm(t.at);
        if (m === null) break;
        const occ = nextDailyOccurrence(m, t.weekdays, now, null);
        if (occ !== null) candidates.push(occ);
        break;
      }
      case 'monthly_at': {
        const m = parseHHmm(t.at);
        if (m === null) break;
        const occ = nextMonthlyOccurrence(m, t.daysOfMonth, now, null);
        if (occ !== null) candidates.push(occ);
        break;
      }
      case 'interval': {
        if (!Number.isFinite(t.minutes) || t.minutes <= 0) break;
        const base = t.lastFiredAt != null ? t.lastFiredAt + t.minutes * MINUTE_MS : null;
        const due = base != null && base > now ? base : alignToMinute(now);
        candidates.push(shiftIntervalToWeekday(due, t.weekdays));
        break;
      }
      case 'once': {
        if (!t.fired) candidates.push(t.at > now ? t.at : alignToMinute(now));
        break;
      }
      case 'window': {
        const s = windowStartAt(t, now);
        if (s !== null) candidates.push(s);
        break;
      }
      case 'on_window_close': {
        const c = windowCloseAt(t, now);
        if (c !== null) candidates.push(c);
        break;
      }
      default:
        break;
    }
  }
  if (candidates.length === 0) return null;
  return Math.min(...candidates);
}

export function detectMissed(
  triggers: Trigger[],
  lastFiredMap: Record<string, number | undefined>,
  bootAt: number,
): MissedTrigger[] {
  const out: MissedTrigger[] = [];
  for (const t of triggers) {
    const anchor = lastFiredMap[t.id] ?? t.lastFiredAt ?? null;
    let missedAt: number | null = null;
    if (t.type === 'daily_at') {
      missedAt = missedDailyAt(t.at, t.weekdays, anchor, bootAt);
    } else if (t.type === 'monthly_at') {
      missedAt = missedMonthlyAt(t.daysOfMonth, t.at, anchor, bootAt);
    } else if (t.type === 'interval') {
      missedAt = missedIntervalAt(t.minutes, t.weekdays, anchor, bootAt);
    } else if (t.type === 'once') {
      if (!t.fired && t.at <= bootAt) missedAt = t.at;
    } else if (t.type === 'on_window_close') {
      missedAt = missedWindowCloseAt(t.window, anchor, bootAt);
    }
    if (missedAt !== null) out.push({ triggerId: t.id, missedAt, desc: describeTrigger(t) });
  }
  return out;
}

function validWeekdays(weekdays?: number[]): string | null {
  if (weekdays === undefined) return null;
  if (!Array.isArray(weekdays) || weekdays.length === 0) return 'weekdays 不能为空';
  for (const d of weekdays) {
    if (!Number.isInteger(d) || d < 0 || d > 6) return 'weekdays 取值须为 0-6';
  }
  return null;
}

function validWindowTimes(start: string, end: string): string | null {
  if (parseHHmm(start) === null || parseHHmm(end) === null) return '时间格式须为 HH:mm';
  if (start === end) return '窗口起止时间不能相同';
  return null;
}

export function validateTrigger(trigger: Trigger): string | null {
  if (!trigger || typeof trigger.id !== 'string' || trigger.id.length === 0) return '缺少触发器 id';
  switch (trigger.type) {
    case 'daily_at': {
      if (parseHHmm(trigger.at) === null) return '时间格式须为 HH:mm';
      return validWeekdays(trigger.weekdays);
    }
    case 'monthly_at': {
      if (parseHHmm(trigger.at) === null) return '时间格式须为 HH:mm';
      if (!Array.isArray(trigger.daysOfMonth) || trigger.daysOfMonth.length === 0) {
        return 'daysOfMonth 不能为空';
      }
      const seen = new Set<string>();
      for (const d of trigger.daysOfMonth) {
        if (d !== 'last' && (!Number.isInteger(d) || d < 1 || d > 31)) {
          return 'daysOfMonth 取值须为 1-31 或 last';
        }
        const key = String(d);
        if (seen.has(key)) return 'daysOfMonth 不能重复';
        seen.add(key);
      }
      return null;
    }
    case 'interval': {
      if (!Number.isInteger(trigger.minutes) || trigger.minutes <= 0) return '间隔分钟数须为正整数';
      return validWeekdays(trigger.weekdays);
    }
    case 'window': {
      const err = validWindowTimes(trigger.start, trigger.end);
      if (err) return err;
      return validWeekdays(trigger.weekdays);
    }
    case 'once': {
      if (!Number.isFinite(trigger.at) || trigger.at <= 0) return '单次触发时间无效';
      return null;
    }
    case 'on_window_close': {
      const err = validWindowTimes(trigger.window.start, trigger.window.end);
      if (err) return err;
      return validWeekdays(trigger.window.weekdays);
    }
    case 'on_app_start':
    case 'on_session_close':
      return null;
    case 'on_task_done': {
      if (typeof trigger.taskId !== 'string' || trigger.taskId.length === 0) return '缺少目标任务';
      return null;
    }
    default:
      return '未知触发器类型';
  }
}
