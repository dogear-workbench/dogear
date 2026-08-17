import type { RunHistoryStatus, RunTriggerReason, RunTokens } from '@/types/scheduler';

const pad = (n: number) => String(n).padStart(2, '0');

export function formatDateTimeShort(ts: number): string {
  const d = new Date(ts);
  const base = `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  return d.getFullYear() === new Date().getFullYear() ? base : `${d.getFullYear()}-${base}`;
}

export function formatTimeShort(ts: number): string {
  const d = new Date(ts);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function formatRelativePast(ts: number): string {
  const diff = Date.now() - ts;
  if (diff < 60_000) return '刚刚';
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 60) return `${minutes} 分钟前`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} 小时前`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days} 天前`;
  return '';
}

export function formatDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return '—';
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return `${seconds} 秒`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) {
    const rem = seconds % 60;
    return rem > 0 ? `${minutes} 分 ${rem} 秒` : `${minutes} 分钟`;
  }
  const hours = Math.floor(minutes / 60);
  const remMinutes = minutes % 60;
  return remMinutes > 0 ? `${hours} 小时 ${remMinutes} 分` : `${hours} 小时`;
}

export function formatTokenCount(n: number): string {
  if (n < 1000) return String(n);
  if (n < 1_000_000) return `${(n / 1000).toFixed(n < 10_000 ? 1 : 0)}k`;
  return `${(n / 1_000_000).toFixed(2)}M`;
}

export function describeTokens(tokens: RunTokens): string {
  const parts = [`输入 ${tokens.inputTokens.toLocaleString()}`, `输出 ${tokens.outputTokens.toLocaleString()}`];
  if (tokens.cacheReadInputTokens !== undefined) parts.push(`缓存读 ${tokens.cacheReadInputTokens.toLocaleString()}`);
  if (tokens.cacheCreationInputTokens !== undefined) parts.push(`缓存写 ${tokens.cacheCreationInputTokens.toLocaleString()}`);
  return parts.join(' · ');
}

export const STATUS_META: Record<RunHistoryStatus, { label: string; badgeCls: string }> = {
  completed: {
    label: '成功',
    badgeCls: 'border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400',
  },
  failed: {
    label: '失败',
    badgeCls: 'border-destructive/40 bg-destructive/10 text-destructive',
  },
  cancelled: {
    label: '已取消',
    badgeCls: 'border-border bg-muted text-muted-foreground',
  },
  missed: {
    label: '未运行',
    badgeCls: 'border-border bg-muted text-muted-foreground',
  },
  interrupted: {
    label: '中断',
    badgeCls: 'border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-400',
  },
};

export const TRIGGER_REASON_LABELS: Record<RunTriggerReason, string> = {
  time: '时间',
  condition: '条件',
  manual: '手动',
};
