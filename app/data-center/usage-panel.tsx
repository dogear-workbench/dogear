import { useEffect, useMemo, useState } from 'react';
import { ChevronRight } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { client } from '@/lib/client';
import { rendererEvents } from '@/lib/events';
import { resolveModelLabel } from '@/lib/model-selection';
import { useSettingsStore } from '@/stores/settings-store';
import { TurnDetailList } from '@/components/usage/TurnDetailList';
import { formatTokens } from '@/components/agent-chat/usage-badge/usage-utils';
import type { Conversation, Workspace } from '@/types/electron-api';

type PeriodKey = 'today' | 'd7' | 'd30' | 'all';

const PERIODS: Array<{ key: PeriodKey; label: string }> = [
  { key: 'today', label: '今日' },
  { key: 'd7', label: '7 天' },
  { key: 'd30', label: '30 天' },
  { key: 'all', label: '全部' },
];

/** 今日按本地自然日 0 点；7 天 / 30 天按滚动窗口 */
function periodSinceMs(period: PeriodKey): number | null {
  const now = Date.now();
  if (period === 'today') return new Date().setHours(0, 0, 0, 0);
  if (period === 'd7') return now - 7 * 86400_000;
  if (period === 'd30') return now - 30 * 86400_000;
  return null;
}

interface PeriodStats {
  conversationId: string;
  workspaceId: string;
  turnCount: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadInputTokens: number;
  lastTimestamp: number;
}

function fmtLastActive(ts: number): string {
  const d = new Date(ts);
  if (d.toDateString() === new Date().toDateString()) {
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }
  return d.toLocaleString([], { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
}

interface UsagePanelProps {
  workspaceId: string | 'all';
  workspaces: Workspace[];
}

export function UsagePanel({ workspaceId, workspaces }: UsagePanelProps) {
  const isAll = workspaceId === 'all';
  const settings = useSettingsStore((s) => s.settings);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [loading, setLoading] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [period, setPeriod] = useState<PeriodKey>('today');
  const [stats, setStats] = useState<PeriodStats[]>([]);
  const [statsLoading, setStatsLoading] = useState(false);

  const isAllPeriod = period === 'all';

  useEffect(() => {
    let cancelled = false;
    const fetchAll = isAll
      ? () => Promise.all(workspaces.map((ws) => client.getByWorkspaceId({ workspaceId: ws.id })))
          .then((rs) => rs.flatMap((r) => r.conversations ?? []))
      : () => client.getByWorkspaceId({ workspaceId }).then((r) => r.conversations ?? []);
    const load = (initial: boolean) => {
      if (initial) setLoading(true);
      fetchAll()
        .then((convs) => {
          if (!cancelled) setConversations(convs);
        })
        .catch((e) => {
          if (initial) toast.error('加载会话失败', { description: String(e) });
        })
        .finally(() => {
          if (!cancelled && initial) setLoading(false);
        });
    };
    load(true);
    const unsubList = rendererEvents.conversationListChanged.listen((data) => {
      if (isAll || data.workspaceId === workspaceId) load(false);
    });
    return () => {
      cancelled = true;
      unsubList();
    };
  }, [isAll, workspaceId, workspaces]);

  useEffect(() => {
    const sinceMs = periodSinceMs(period);
    if (sinceMs == null) {
      setStats([]);
      return;
    }
    let cancelled = false;
    const load = (initial: boolean) => {
      if (initial) setStatsLoading(true);
      client
        .getUsageStats(isAll ? { sinceMs } : { workspaceId, sinceMs })
        .then((r) => {
          if (!cancelled) setStats((r.stats ?? []) as PeriodStats[]);
        })
        .catch((e) => {
          if (initial) toast.error('加载用量失败', { description: String(e) });
        })
        .finally(() => {
          if (!cancelled && initial) setStatsLoading(false);
        });
    };
    load(true);
    const unsubList = rendererEvents.conversationListChanged.listen((data) => {
      if (isAll || data.workspaceId === workspaceId) load(false);
    });
    const unsubUsage = rendererEvents.usageEntryAdded.listen(() => load(false));
    return () => {
      cancelled = true;
      unsubList();
      unsubUsage();
    };
  }, [isAll, workspaceId, period]);

  const convById = useMemo(() => {
    const map = new Map<string, Conversation>();
    for (const c of conversations) map.set(c.id, c);
    return map;
  }, [conversations]);

  const wsNameById = useMemo(
    () => new Map(workspaces.map((w) => [w.id, w.name])),
    [workspaces],
  );

  const rows = useMemo(() => {
    if (isAllPeriod) {
      return [...conversations]
        .sort((a, b) => b.updated_at - a.updated_at)
        .map((conv) => {
          const summary = conv.usageSummary;
          const totalTokens = summary
            ? summary.totalInputTokens + summary.totalOutputTokens + summary.totalCacheReadTokens
            : null;
          return {
            conv,
            tokens: totalTokens,
            turnCount: summary?.turnCount ?? 0,
            lastActive: conv.updated_at,
          };
        });
    }
    return [...stats]
      .sort((a, b) => b.lastTimestamp - a.lastTimestamp)
      .map((s) => {
        const conv = convById.get(s.conversationId);
        if (!conv) return null;
        return {
          conv,
          tokens: s.inputTokens + s.outputTokens + s.cacheReadInputTokens,
          turnCount: s.turnCount,
          lastActive: s.lastTimestamp,
        };
      })
      .filter((r): r is NonNullable<typeof r> => r !== null);
  }, [conversations, stats, convById, isAllPeriod]);

  const summary = useMemo(() => {
    let tokens = 0;
    let turns = 0;
    let sessionCount = 0;
    for (const r of rows) {
      if (r.tokens == null) continue;
      tokens += r.tokens;
      turns += r.turnCount;
      sessionCount += 1;
    }
    return { tokens, turns, sessionCount };
  }, [rows]);

  const showLoading = isAllPeriod ? loading : loading || statsLoading;

  return (
    <div className="max-w-4xl px-6 py-6">
      <h2 className="mb-1 text-lg font-semibold">用量</h2>
      <p className="mb-4 text-sm text-muted-foreground">
        按时段汇总 token 消耗（计费口径：input + output + 缓存读，跨轮累加）。
        时间页显示该时段内的用量，「全部」为会话全量累计；点击会话展开逐轮明细。
      </p>

      <Tabs value={period} onValueChange={(v) => setPeriod(v as PeriodKey)}>
        <TabsList className="mb-4">
          {PERIODS.map((p) => (
            <TabsTrigger key={p.key} value={p.key}>
              {p.label}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>

      {showLoading ? (
        <div className="flex items-center justify-center py-12 text-muted-foreground">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
        </div>
      ) : rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          {isAllPeriod ? '暂无会话' : '该时段暂无用量记录'}
        </p>
      ) : (
        <div className="space-y-2">
          {summary.sessionCount > 0 && (
            <div className="flex items-center gap-3 px-4 py-2 text-xs text-muted-foreground">
              <span>
                合计 <span className="font-medium text-foreground tabular-nums">{formatTokens(summary.tokens)}</span> tokens
              </span>
              <span>· {summary.turns} 轮</span>
              <span>· {summary.sessionCount} 个会话</span>
            </div>
          )}
          {rows.map((row) => {
            const conv = row.conv;
            const expanded = expandedId === conv.id;
            const selection = conv.modelSelection ?? settings.ai.defaultModelSelection;
            const modelLabel = selection ? resolveModelLabel(settings, selection) : null;
            const wsName = wsNameById.get(conv.workspace_id);

            return (
              <div
                key={conv.id}
                className={cn(
                  'rounded-lg border bg-background transition-colors hover:border-foreground/20',
                  row.tokens == null && 'opacity-60',
                )}
              >
                <button
                  type="button"
                  className="flex w-full items-center gap-3 px-4 py-3 text-left"
                  onClick={() => setExpandedId((id) => (id === conv.id ? null : conv.id))}
                >
                  <ChevronRight
                    size={14}
                    className={cn('shrink-0 text-muted-foreground transition-transform', expanded && 'rotate-90')}
                  />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="truncate text-sm font-medium">{conv.title || '未命名会话'}</span>
                      {isAll && wsName && (
                        <Badge variant="subtle" className="shrink-0 px-1.5 py-0 text-[10px] font-normal">
                          {wsName}
                        </Badge>
                      )}
                      {modelLabel && (
                        <Badge variant="subtle" className="shrink-0 px-1.5 py-0 text-[10px] font-normal">
                          {modelLabel}
                        </Badge>
                      )}
                    </div>
                    <div className="mt-0.5 text-xs text-muted-foreground">
                      最后活动 {fmtLastActive(row.lastActive)}
                      {row.tokens != null ? ` · ${row.turnCount} 轮` : ' · 尚无用量'}
                    </div>
                  </div>
                  <span className="shrink-0 tabular-nums text-sm">
                    {row.tokens != null ? formatTokens(row.tokens) : '—'}
                  </span>
                </button>
                {expanded && (
                  <div className="border-t px-4 py-2">
                    <TurnDetailList conversationId={conv.id} sinceMs={isAllPeriod ? undefined : periodSinceMs(period) ?? undefined} />
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
