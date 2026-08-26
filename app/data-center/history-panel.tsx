import { useEffect, useMemo, useState } from 'react';
import { Loader2, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { cn } from '@/lib/utils';
import { useVisiblePolling } from '@/hooks/use-visible-polling';
import { useSchedulerStore } from '@/stores/scheduler-store';
import type { RunHistoryStatus } from '@/types/scheduler';
import { HistoryEntryCard } from './HistoryEntryCard';
import { STATUS_META, formatDuration } from './history-utils';

const ACTIVITY_POLL_MS = 10_000;

const STATUS_OPTIONS: { value: RunHistoryStatus | 'all'; label: string }[] = [
  { value: 'all', label: '全部状态' },
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
        <div key={r.taskId} className="flex items-center gap-2 min-w-0">
          <Loader2 className="w-3.5 h-3.5 animate-spin text-muted-foreground shrink-0" />
          <span className="text-sm font-medium truncate">{r.taskName}</span>
          <span className="ml-auto text-xs text-muted-foreground shrink-0 whitespace-nowrap">
            已运行 {formatDuration(Date.now() - r.startedAt)}
          </span>
        </div>
      ))}
    </section>
  );
}

export function HistoryPanel() {
  const tasks = useSchedulerStore((s) => s.tasks);
  const history = useSchedulerStore((s) => s.history);
  const historyLoading = useSchedulerStore((s) => s.historyLoading);
  const historyError = useSchedulerStore((s) => s.historyError);
  const historyCursor = useSchedulerStore((s) => s.historyCursor);
  const loadingMore = useSchedulerStore((s) => s.loadingMore);
  const loadTasks = useSchedulerStore((s) => s.loadTasks);
  const loadHistory = useSchedulerStore((s) => s.loadHistory);
  const loadMoreHistory = useSchedulerStore((s) => s.loadMoreHistory);
  const refreshActivity = useSchedulerStore((s) => s.refreshActivity);

  const [taskFilter, setTaskFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState<RunHistoryStatus | 'all'>('all');
  const [, setDisplayTick] = useState(0);

  useEffect(() => {
    loadTasks();
    loadHistory();
  }, [loadTasks, loadHistory]);

  useVisiblePolling(() => refreshActivity(), ACTIVITY_POLL_MS);

  useEffect(() => {
    const id = setInterval(() => setDisplayTick((t) => t + 1), 60_000);
    return () => clearInterval(id);
  }, []);

  const handleTaskFilterChange = (value: string) => {
    setTaskFilter(value);
    loadHistory(value === 'all' ? undefined : value);
  };

  const handleRefresh = () => {
    loadHistory(taskFilter === 'all' ? undefined : taskFilter);
    refreshActivity();
  };

  const visible = useMemo(
    () => (statusFilter !== 'all' ? history.filter((e) => e.status === statusFilter) : history),
    [history, statusFilter],
  );

  return (
    <div className="max-w-4xl px-6 py-6 space-y-3">
      <div className="flex items-center gap-3 mb-3">
        <h2 className="text-lg font-semibold">执行历史</h2>
        <div className="flex items-center gap-2 ml-auto">
          <Select value={taskFilter} onValueChange={handleTaskFilterChange}>
            <SelectTrigger size="sm" className="w-[180px]" aria-label="按任务筛选">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">全部任务</SelectItem>
              {tasks.map((t) => (
                <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={statusFilter} onValueChange={(v) => setStatusFilter(v as RunHistoryStatus | 'all')}>
            <SelectTrigger size="sm" className="w-[140px]" aria-label="按状态筛选">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {STATUS_OPTIONS.map((o) => (
                <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button variant="ghost" size="sm" onClick={handleRefresh} title="刷新">
            <RefreshCw className={cn('w-3.5 h-3.5', historyLoading && 'animate-spin')} />
          </Button>
        </div>
      </div>

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
          {statusFilter !== 'all' ? '当前已加载的记录中没有符合筛选的状态' : '暂无执行历史'}
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
      {visible.length > 0 && historyCursor === undefined && statusFilter === 'all' && (
        <p className="text-xs text-muted-foreground text-center py-2">没有更多了</p>
      )}
    </div>
  );
}
