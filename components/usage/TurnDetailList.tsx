import { useState } from 'react';
import { AlertTriangle, CheckCircle2, ChevronRight, RotateCcw, XCircle } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
import type { CompactMarker, ConversationUsage, ConversationUsageEntry } from '@/types/usage';
import { useConversationUsage } from '@/components/agent-chat/usage-badge/useConversationUsage';
import { cacheHitRate, formatTokens } from '@/components/agent-chat/usage-badge/usage-utils';

const SEGMENT_GAP_MS = 30 * 60 * 1000;

type TimelineItem =
  | { kind: 'entry'; entry: ConversationUsageEntry; segmented: boolean }
  | { kind: 'compact'; marker: CompactMarker };

function itemTimestamp(item: TimelineItem): number {
  return item.kind === 'entry' ? item.entry.timestamp : item.marker.timestamp;
}

/** 按文件序（时间序）排布，不依赖 turnIndex 排序键；turnIndex 回跳或时间大间隔处插分段线 */
function buildTimeline(usage: ConversationUsage): TimelineItem[] {
  const merged: TimelineItem[] = [
    ...usage.entries.map((entry) => ({ kind: 'entry' as const, entry, segmented: false })),
    ...usage.compactMarkers.map((marker) => ({ kind: 'compact' as const, marker })),
  ].sort((a, b) => itemTimestamp(a) - itemTimestamp(b));

  let prev: ConversationUsageEntry | undefined;
  for (const item of merged) {
    if (item.kind !== 'entry') continue;
    if (
      prev &&
      (item.entry.turnIndex <= prev.turnIndex || item.entry.timestamp - prev.timestamp > SEGMENT_GAP_MS)
    ) {
      item.segmented = true;
    }
    prev = item.entry;
  }
  return merged;
}

function statusOf(entry: ConversationUsageEntry): { level: 'ok' | 'warn' | 'error'; label: string } {
  if (entry.isError || entry.terminalReason === 'error') {
    return { level: 'error', label: entry.apiErrorStatus ? `error ${entry.apiErrorStatus}` : 'error' };
  }
  if (entry.terminalReason === 'aborted' || entry.terminalReason === 'max_turns') {
    return { level: 'warn', label: entry.terminalReason };
  }
  return { level: 'ok', label: entry.terminalReason ?? 'completed' };
}

function fmtTime(ts: number): string {
  return new Date(ts).toLocaleString([], {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function TurnRow({ entry, segmented }: { entry: ConversationUsageEntry; segmented: boolean }) {
  const [open, setOpen] = useState(false);
  const status = statusOf(entry);
  const hitRate = Math.round(cacheHitRate(entry.usage) * 100);
  const models = Object.keys(entry.modelUsage ?? {});
  const calls = entry.toolActivity?.calls ?? [];
  const readFiles = calls.find((c) => c.name === 'Read')?.files ?? [];

  return (
    <div>
      {segmented && (
        <div className="flex items-center gap-2 py-1.5 text-[11px] text-muted-foreground/80">
          <span className="h-px flex-1 bg-border" />
          <span>会话重启 / 切换</span>
          <span className="h-px flex-1 bg-border" />
        </div>
      )}
      <div className="rounded hover:bg-muted/40">
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          className="flex w-full flex-wrap items-center gap-x-3 gap-y-1 px-1 py-1 text-left text-xs"
        >
          <ChevronRight size={12} className={cn('shrink-0 text-muted-foreground transition-transform', open && 'rotate-90')} />
          {status.level === 'error' ? (
            <XCircle size={12} className="shrink-0 text-red-500" />
          ) : status.level === 'warn' ? (
            <AlertTriangle size={12} className="shrink-0 text-amber-500" />
          ) : (
            <CheckCircle2 size={12} className="shrink-0 text-green-600" />
          )}
          <span className="shrink-0 tabular-nums text-muted-foreground">#{entry.turnIndex}</span>
          <span className="shrink-0 tabular-nums text-muted-foreground">{fmtTime(entry.timestamp)}</span>
          {models.map((m) => (
            <Badge key={m} variant="subtle" className="max-w-40 truncate px-1.5 py-0 text-[10px] font-normal" title={m}>
              {m}
            </Badge>
          ))}
          <span className="shrink-0 tabular-nums">
            {formatTokens(entry.usage.inputTokens)}↑ {formatTokens(entry.usage.outputTokens)}↓
          </span>
          <span className="shrink-0 tabular-nums text-muted-foreground">
            缓存读 {formatTokens(entry.usage.cacheReadInputTokens)} / 写 {formatTokens(entry.usage.cacheCreationInputTokens)}
          </span>
          <span className="shrink-0 tabular-nums text-muted-foreground">命中 {hitRate}%</span>
          <span className="shrink-0 text-muted-foreground">工具 {entry.toolActivity?.totalCalls ?? 0}</span>
        </button>

        {open && (
          <div className="space-y-1 pb-1.5 pl-6 text-[11px] text-muted-foreground">
            <div>
              LLM 调用 {entry.numTurns} 次 · 结束原因 {status.label}
              {entry.lastContextTokens != null && ` · 轮末上下文 ${formatTokens(entry.lastContextTokens)}`}
            </div>
            {calls.length > 0 ? (
              calls.map((call) => (
                <div key={call.name}>
                  <span className="font-mono">{call.name}</span> × {call.count}
                </div>
              ))
            ) : (
              <div>本轮无工具调用</div>
            )}
            {readFiles.length > 0 && (
              <div className="space-y-0.5 pl-3">
                {readFiles.map((f) => (
                  <div key={f} className="truncate font-mono" title={f}>
                    {f}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function CompactBoundaryRow({ marker }: { marker: CompactMarker }) {
  return (
    <div className="flex items-center gap-2 py-1 text-[11px] text-muted-foreground">
      <RotateCcw size={12} className="shrink-0" />
      <span>
        {marker.trigger === 'manual' ? '手动压缩' : '自动压缩'}
        {marker.preTokens > 0 && `（压缩前 ${formatTokens(marker.preTokens)}）`}
      </span>
      <span className="tabular-nums">{fmtTime(marker.timestamp)}</span>
    </div>
  );
}

export function TurnDetailList({ conversationId, sinceMs }: { conversationId: string; sinceMs?: number }) {
  const { usage } = useConversationUsage(conversationId);

  if (!usage) {
    return <p className="py-2 text-xs text-muted-foreground">加载用量明细…</p>;
  }

  const scoped: ConversationUsage = sinceMs != null
    ? {
        ...usage,
        entries: usage.entries.filter((e) => e.timestamp >= sinceMs!),
        compactMarkers: usage.compactMarkers.filter((m) => m.timestamp >= sinceMs!),
      }
    : usage;

  if (scoped.entries.length === 0 && scoped.compactMarkers.length === 0) {
    return <p className="py-2 text-xs text-muted-foreground">暂无用量记录</p>;
  }

  return (
    <div className="space-y-0.5">
      {buildTimeline(scoped).map((item) =>
        item.kind === 'entry' ? (
          <TurnRow key={item.entry.uuid} entry={item.entry} segmented={item.segmented} />
        ) : (
          <CompactBoundaryRow key={item.marker.uuid} marker={item.marker} />
        ),
      )}
    </div>
  );
}
