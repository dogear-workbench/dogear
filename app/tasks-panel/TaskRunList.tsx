import { Fragment, useCallback, useState } from 'react';
import { Loader2, MessageSquare } from 'lucide-react';
import { client } from '@/lib/client';
import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
import {
  ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuTrigger,
} from '@/components/ui/context-menu';
import { useVisiblePolling } from '@/hooks/use-visible-polling';
import { useSchedulerStore } from '@/stores/scheduler-store';
import { resolveTaskWorkspaceId, useTasksPanelStore } from '@/stores/tasks-panel-store';
import { referenceConversationToMain } from './reference-to-main';
import { ChildSessionFold } from './ChildSessionList';
import type { RunHistoryEntry, SchedulerRunningPlan } from '@/types/scheduler';
import { STATUS_META, formatTokenCount } from './history-utils';
import { formatDateTimeShort, formatDuration } from '@/app/data-center/history-utils';

const PAGE_LIMIT = 20;

function totalTokens(entry: RunHistoryEntry): string {
  if (!entry.tokens) return '';
  return formatTokenCount(entry.tokens.inputTokens + entry.tokens.outputTokens + (entry.tokens.cacheReadInputTokens ?? 0));
}

function entryTitle(entry: RunHistoryEntry): string {
  const start = entry.startedAt ?? entry.ts;
  if (entry.kind === 'missed') return `计划时刻 ${formatDateTimeShort(start)}，任务未运行`;
  const parts = [formatDateTimeShort(start)];
  if (entry.endedAt !== undefined) parts.push(`耗时 ${formatDuration(entry.endedAt - start)}`);
  if (entry.summary) parts.push(entry.summary);
  if (entry.error) parts.push(entry.error);
  return parts.join('\n');
}

function referenceMenu(conversationId: string, conversationWorkspaceId: string) {
  return (
    <ContextMenuContent onCloseAutoFocus={(event) => event.preventDefault()}>
      <ContextMenuItem
        onClick={() => void referenceConversationToMain(conversationId, conversationWorkspaceId)}
      >
        引用到主会话
      </ContextMenuItem>
    </ContextMenuContent>
  );
}

interface Props {
  planId: string;
  running: SchedulerRunningPlan | undefined;
}

/** 定时任务展开的下挂运行记录（最新在上；运行中任务轮询刷新，结束即拉到终态条目） */
export function TaskRunList({ planId, running }: Props) {
  const [entries, setEntries] = useState<RunHistoryEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const task = useSchedulerStore((s) => s.tasks.find((t) => t.id === planId));
  const workspaces = useTasksPanelStore((s) => s.workspaces);
  const openHistory = useTasksPanelStore((s) => s.openHistory);

  const viewFor = useCallback((conversationId: string) => {
    const workspaceId = resolveTaskWorkspaceId(task?.workspaceId, workspaces);
    if (!workspaceId || !task) return;
    openHistory({ conversationId, workspaceId, source: 'scheduled', taskId: task.id });
  }, [task, workspaces, openHistory]);

  const wsId = resolveTaskWorkspaceId(task?.workspaceId, workspaces);

  const load = useCallback(async () => {
    try {
      const r = await client.listRunHistory({ planId, limit: PAGE_LIMIT });
      if ('error' in r) {
        setError(r.error);
        return;
      }
      setEntries(r.entries);
      setError(null);
      setNow(Date.now());
    } catch (e) {
      setError(String(e));
    }
  }, [planId]);

  useVisiblePolling(load, running ? 10_000 : 120_000);

  return (
    <div className="border-y bg-muted/20 py-1">
      {running && running.conversationId && wsId ? (
        <ChildSessionFold
          parentConversationId={running.conversationId}
          workspaceId={wsId}
          onOpen={viewFor}
        >
          {(toggle) => (
            <ContextMenu>
              <ContextMenuTrigger asChild>
                <button
                  type="button"
                  onClick={() => viewFor(running.conversationId!)}
                  title="查看运行过程"
                  className="flex items-center gap-2 w-full px-3 py-1.5 pl-6 text-xs text-muted-foreground text-left hover:bg-muted/60 transition-colors"
                >
                  {toggle}
                  <Loader2 className="w-3 h-3 animate-spin shrink-0" />
                  <span>运行中</span>
                  <span className="ml-auto tabular-nums">{formatDuration(now - running.startedAt)}</span>
                  <MessageSquare className="w-3 h-3 shrink-0 text-muted-foreground/60" />
                </button>
              </ContextMenuTrigger>
              {referenceMenu(running.conversationId!, wsId)}
            </ContextMenu>
          )}
        </ChildSessionFold>
      ) : (
        running && (
          <div
            title="运行会话创建中…"
            className="flex items-center gap-2 w-full px-3 py-1.5 pl-6 text-xs text-muted-foreground text-left"
          >
            <Loader2 className="w-3 h-3 animate-spin shrink-0" />
            <span>运行中</span>
            <span className="ml-auto tabular-nums">{formatDuration(now - running.startedAt)}</span>
          </div>
        )
      )}
      {error && <p className="px-3 py-1.5 pl-6 text-xs text-destructive">{error}</p>}
      {!error && entries?.length === 0 && !running && (
        <p className="px-3 py-1.5 pl-6 text-xs text-muted-foreground">还没有运行记录</p>
      )}
      {entries?.map((entry) => {
        const meta = STATUS_META[entry.status];
        const row = (
          <>
            <Badge variant="outline" className={cn('shrink-0 font-normal px-1.5', meta.badgeCls)}>
              {meta.label}
            </Badge>
            <span className="text-muted-foreground tabular-nums shrink-0">{formatDateTimeShort(entry.startedAt ?? entry.ts)}</span>
            {totalTokens(entry) && (
              <span className="ml-auto min-w-0 truncate text-muted-foreground tabular-nums">{totalTokens(entry)} tokens</span>
            )}
            {entry.conversationId && (
              <span title="查看运行过程" className="shrink-0 inline-flex">
                <MessageSquare className="w-3 h-3 text-muted-foreground/60" />
              </span>
            )}
          </>
        );
        return (
          <Fragment key={entry.id}>
            {entry.conversationId && wsId ? (
              <ChildSessionFold
                parentConversationId={entry.conversationId}
                workspaceId={wsId}
                onOpen={viewFor}
              >
                {(toggle) => (
                  <ContextMenu>
                    <ContextMenuTrigger asChild>
                      <div
                        title={entryTitle(entry)}
                        onClick={() => viewFor(entry.conversationId!)}
                        className="flex items-center gap-2 px-3 py-1.5 pl-6 text-xs cursor-pointer hover:bg-muted/60 transition-colors"
                      >
                        {toggle}
                        {row}
                      </div>
                    </ContextMenuTrigger>
                    {referenceMenu(entry.conversationId!, wsId)}
                  </ContextMenu>
                )}
              </ChildSessionFold>
            ) : (
              <div
                title={entryTitle(entry)}
                onClick={() => entry.conversationId && viewFor(entry.conversationId)}
                className="flex items-center gap-2 px-3 py-1.5 pl-6 text-xs"
              >
                {row}
              </div>
            )}
          </Fragment>
        );
      })}
    </div>
  );
}
