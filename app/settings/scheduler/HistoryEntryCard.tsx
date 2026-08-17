import { useState } from 'react';
import { ChevronDown, Coins } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import type { RunHistoryEntry } from '@/types/scheduler';
import {
  STATUS_META,
  TRIGGER_REASON_LABELS,
  describeTokens,
  formatDateTimeShort,
  formatDuration,
  formatRelativePast,
  formatTimeShort,
  formatTokenCount,
} from './history-utils';

function TimeLine({ entry }: { entry: RunHistoryEntry }) {
  const start = entry.startedAt ?? entry.ts;
  const rel = formatRelativePast(start);
  const title = `${formatDateTimeShort(start)}${entry.endedAt !== undefined ? ` – ${formatDateTimeShort(entry.endedAt)}` : ''}`;
  if (entry.kind === 'missed') {
    return (
      <span className="text-xs text-muted-foreground" title={title}>
        计划时刻 {formatDateTimeShort(start)}{rel ? `（${rel}）` : ''}
      </span>
    );
  }
  const parts = [formatDateTimeShort(start)];
  if (entry.endedAt !== undefined) {
    const sameDay = new Date(entry.endedAt).toDateString() === new Date(start).toDateString();
    parts.push(sameDay ? formatTimeShort(entry.endedAt) : formatDateTimeShort(entry.endedAt));
    const duration = formatDuration(entry.endedAt - start);
    return (
      <span className="text-xs text-muted-foreground" title={title}>
        {parts.join(' – ')} · 耗时 {duration}{rel ? ` · ${rel}` : ''}
      </span>
    );
  }
  return (
    <span className="text-xs text-muted-foreground" title={title}>
      {parts[0]}{rel ? `（${rel}）` : ''}
    </span>
  );
}

function TokenUsage({ entry }: { entry: RunHistoryEntry }) {
  if (!entry.tokens) return null;
  const t = entry.tokens;
  const title = describeTokens(t);
  return (
    <span className="inline-flex items-center gap-1 text-xs text-muted-foreground" title={title}>
      <Coins className="w-3 h-3" />
      ↑ {formatTokenCount(t.inputTokens)} / ↓ {formatTokenCount(t.outputTokens)}
    </span>
  );
}

export function HistoryEntryCard({ entry }: { entry: RunHistoryEntry }) {
  const [expanded, setExpanded] = useState(false);
  const meta = STATUS_META[entry.status];
  const expandable = Boolean(entry.summary || entry.error);

  return (
    <div
      className={cn(
        'rounded-md border p-3',
        entry.status === 'failed' && 'border-destructive/30',
      )}
    >
      <div className="flex items-start gap-2">
        <Badge variant="outline" className={cn('shrink-0 font-normal', meta.badgeCls)}>
          {meta.label}
        </Badge>
        <div className="flex-1 min-w-0 space-y-1">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-medium truncate" title={entry.planName}>
              {entry.planName}
            </span>
            {entry.kind === 'task' && entry.taskName && (
              <span className="text-xs text-muted-foreground truncate">{entry.taskName}</span>
            )}
            <Badge
              variant="outline"
              className="font-normal text-muted-foreground"
              title={entry.triggerDesc ?? TRIGGER_REASON_LABELS[entry.triggerReason]}
            >
              {TRIGGER_REASON_LABELS[entry.triggerReason]}
            </Badge>
            <TokenUsage entry={entry} />
          </div>
          <TimeLine entry={entry} />
        </div>
        {expandable && (
          <Button
            variant="ghost"
            size="sm"
            className="h-7 w-7 shrink-0 p-0"
            aria-expanded={expanded}
            onClick={() => setExpanded((v) => !v)}
            title={expanded ? '收起详情' : '展开详情'}
          >
            <ChevronDown className={cn('w-4 h-4 transition-transform', expanded && 'rotate-180')} />
          </Button>
        )}
      </div>
      {expanded && expandable && (
        <div className="mt-2 pl-1 space-y-1.5">
          {entry.error && (
            <p className="text-xs whitespace-pre-wrap break-words text-destructive">{entry.error}</p>
          )}
          {entry.summary && (
            <p className="text-xs whitespace-pre-wrap break-words text-muted-foreground">{entry.summary}</p>
          )}
        </div>
      )}
    </div>
  );
}
