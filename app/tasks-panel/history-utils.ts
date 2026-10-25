import type { RunHistoryStatus } from '@/types/scheduler';

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

export function formatTokenCount(n: number): string {
  if (n < 1000) return String(n);
  if (n < 1_000_000) return `${(n / 1000).toFixed(n < 10_000 ? 1 : 0)}k`;
  return `${(n / 1_000_000).toFixed(2)}M`;
}
