import { useEffect, useState } from 'react';
import { ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
import { client } from '@/lib/client';
import { rendererEvents } from '@/lib/events';
import { resolveModelLabel } from '@/lib/model-selection';
import { useSettingsStore } from '@/stores/settings-store';
import { useWorkspaceStore } from '@/stores/workspace-store';
import { TurnDetailList } from '@/components/usage/TurnDetailList';
import { formatTokens } from '@/components/agent-chat/usage-badge/usage-utils';
import type { Conversation } from '@/types/electron-api';

function fmtLastActive(ts: number): string {
  const d = new Date(ts);
  if (d.toDateString() === new Date().toDateString()) {
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }
  return d.toLocaleString([], { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
}

export function UsageTab() {
  const workspaceId = useWorkspaceStore((s) => s.workspace?.id ?? null);
  const settings = useSettingsStore((s) => s.settings);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [loading, setLoading] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  useEffect(() => {
    if (!workspaceId) {
      setConversations([]);
      return;
    }
    let cancelled = false;
    const load = (initial: boolean) => {
      if (initial) setLoading(true);
      client
        .getByWorkspaceId({ workspaceId })
        .then((r) => {
          if (!cancelled) setConversations(r.conversations ?? []);
        })
        .catch(() => {})
        .finally(() => {
          if (!cancelled && initial) setLoading(false);
        });
    };
    load(true);
    const unsubList = rendererEvents.conversationListChanged.listen((data) => {
      if (data.workspaceId === workspaceId) load(false);
    });
    const unsubUsage = rendererEvents.usageEntryAdded.listen(() => load(false));
    return () => {
      cancelled = true;
      unsubList();
      unsubUsage();
    };
  }, [workspaceId]);

  const sorted = [...conversations].sort((a, b) => b.updated_at - a.updated_at);

  return (
    <div className="max-w-4xl px-6 py-6">
      <h2 className="mb-1 text-lg font-semibold">用量</h2>
      <p className="mb-6 text-sm text-muted-foreground">
        按会话汇总 token 消耗（计费口径：input + output + 缓存读，跨轮累加）。点击会话展开逐轮明细。
      </p>

      {!workspaceId ? (
        <p className="text-sm text-muted-foreground">未选择工作区</p>
      ) : loading ? (
        <div className="flex items-center justify-center py-12 text-muted-foreground">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
        </div>
      ) : sorted.length === 0 ? (
        <p className="text-sm text-muted-foreground">当前工作区暂无会话</p>
      ) : (
        <div className="space-y-2">
          {sorted.map((conv) => {
            const summary = conv.usageSummary;
            const expanded = expandedId === conv.id;
            const selection = conv.modelSelection ?? settings.ai.defaultModelSelection;
            const modelLabel = selection ? resolveModelLabel(settings, selection) : null;
            const totalTokens = summary
              ? summary.totalInputTokens + summary.totalOutputTokens + summary.totalCacheReadTokens
              : null;

            return (
              <div
                key={conv.id}
                className={cn(
                  'rounded-lg border bg-background transition-colors hover:border-foreground/20',
                  !summary && 'opacity-60',
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
                      {modelLabel && (
                        <Badge variant="subtle" className="shrink-0 px-1.5 py-0 text-[10px] font-normal">
                          {modelLabel}
                        </Badge>
                      )}
                    </div>
                    <div className="mt-0.5 text-xs text-muted-foreground">
                      最后活动 {fmtLastActive(conv.updated_at)}
                      {summary ? ` · ${summary.turnCount} 轮` : ' · 尚无用量'}
                    </div>
                  </div>
                  <span className="shrink-0 tabular-nums text-sm">
                    {totalTokens !== null ? formatTokens(totalTokens) : '—'}
                  </span>
                </button>
                {expanded && (
                  <div className="border-t px-4 py-2">
                    <TurnDetailList conversationId={conv.id} />
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
