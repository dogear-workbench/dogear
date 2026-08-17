import { useEffect, useMemo, useState } from 'react';
import { Loader2, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetTitle,
} from '@/components/ui/sheet';
import { cn } from '@/lib/utils';
import { useSchedulerStore } from '@/stores/scheduler-store';
import type { RunHistoryStatus } from '@/types/scheduler';
import { HistoryEntryCard } from './HistoryEntryCard';
import { STATUS_META, formatDuration } from './history-utils';

const selectCls = 'h-8 px-2 text-xs border rounded-md bg-background focus:outline-none focus:ring-1 focus:ring-ring';

const STATUS_OPTIONS: { value: RunHistoryStatus | ''; label: string }[] = [
  { value: '', label: '全部状态' },
  ...(['completed', 'failed', 'cancelled', 'interrupted', 'missed'] as const).map((s) => ({
    value: s,
    label: STATUS_META[s].label,
  })),
];

function RunningSection() {
  const activity = useSchedulerStore((s) => s.activity);
  const running = activity?.running ?? [];
  if (running.length === 0) return null;
  return (
    <section className="rounded-md border p-3 space-y-2">
      <div className="text-xs font-medium text-muted-foreground">正在运行</div>
      {running.map((r) => (
        <div key={r.planId} className="flex items-center gap-2 min-w-0">
          <Loader2 className="w-3.5 h-3.5 animate-spin text-muted-foreground shrink-0" />
          <span className="text-sm font-medium truncate">{r.planName}</span>
          {r.currentTaskName && (
            <span className="text-xs text-muted-foreground truncate">{r.currentTaskName}</span>
          )}
          <span className="ml-auto text-xs text-muted-foreground shrink-0 whitespace-nowrap">
            已运行 {formatDuration(Date.now() - r.startedAt)}
          </span>
        </div>
      ))}
    </section>
  );
}

interface HistorySheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function HistorySheet({ open, onOpenChange }: HistorySheetProps) {
  const plans = useSchedulerStore((s) => s.plans);
  const history = useSchedulerStore((s) => s.history);
  const historyLoading = useSchedulerStore((s) => s.historyLoading);
  const historyError = useSchedulerStore((s) => s.historyError);
  const historyCursor = useSchedulerStore((s) => s.historyCursor);
  const loadingMore = useSchedulerStore((s) => s.loadingMore);
  const loadHistory = useSchedulerStore((s) => s.loadHistory);
  const loadMoreHistory = useSchedulerStore((s) => s.loadMoreHistory);
  const refreshActivity = useSchedulerStore((s) => s.refreshActivity);

  const [planFilter, setPlanFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState<RunHistoryStatus | ''>('');
  const [, setDisplayTick] = useState(0);

  useEffect(() => {
    if (!open) return;
    setPlanFilter('');
    setStatusFilter('');
    loadHistory();
  }, [open, loadHistory]);

  useEffect(() => {
    if (!open) return;
    const id = setInterval(() => setDisplayTick((t) => t + 1), 60_000);
    return () => clearInterval(id);
  }, [open]);

  const handlePlanFilterChange = (value: string) => {
    setPlanFilter(value);
    loadHistory(value || undefined);
  };

  const handleRefresh = () => {
    loadHistory(planFilter || undefined);
    refreshActivity();
  };

  const visible = useMemo(
    () => (statusFilter ? history.filter((e) => e.status === statusFilter) : history),
    [history, statusFilter],
  );

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="gap-0 p-0 sm:max-w-2xl">
        <div className="flex items-center gap-3 p-4 pr-12 border-b flex-shrink-0">
          <SheetTitle className="text-base">执行历史</SheetTitle>
          <div className="flex items-center gap-2 ml-auto">
            <select
              className={selectCls}
              value={planFilter}
              onChange={(e) => handlePlanFilterChange(e.target.value)}
              aria-label="按计划筛选"
            >
              <option value="">全部计划</option>
              {plans.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
            <select
              className={selectCls}
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value as RunHistoryStatus | '')}
              aria-label="按状态筛选"
            >
              {STATUS_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
            <Button variant="ghost" size="sm" onClick={handleRefresh} title="刷新">
              <RefreshCw className={cn('w-3.5 h-3.5', historyLoading && 'animate-spin')} />
            </Button>
          </div>
        </div>
        <SheetDescription className="sr-only">定时计划执行记录</SheetDescription>

        <div className="flex-1 overflow-y-auto">
          <div className="p-4 space-y-3">
            <RunningSection />

            {historyLoading && history.length === 0 && (
              <div className="flex items-center justify-center gap-2 py-12 text-sm text-muted-foreground">
                <Loader2 className="w-4 h-4 animate-spin" />
                加载执行历史…
              </div>
            )}
            {!historyLoading && historyError && (
              <div className="text-center py-12 space-y-2">
                <p className="text-sm text-destructive">{historyError}</p>
                <Button variant="outline" size="sm" onClick={handleRefresh}>
                  重试
                </Button>
              </div>
            )}
            {!historyLoading && !historyError && visible.length === 0 && (
              <p className="text-sm text-muted-foreground py-12 text-center">
                {statusFilter ? '当前已加载的记录中没有符合筛选的状态' : '暂无执行历史'}
              </p>
            )}

            <div className="space-y-2">
              {visible.map((entry) => (
                <HistoryEntryCard key={entry.id} entry={entry} />
              ))}
            </div>

            {visible.length > 0 && historyCursor !== undefined && (
              <Button
                variant="outline"
                className="w-full"
                disabled={loadingMore}
                onClick={() => loadMoreHistory()}
              >
                {loadingMore && <Loader2 className="w-4 h-4 mr-1 animate-spin" />}
                加载更多
              </Button>
            )}
            {visible.length > 0 && historyCursor === undefined && !statusFilter && (
              <p className="text-xs text-muted-foreground text-center py-2">没有更多了</p>
            )}
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
