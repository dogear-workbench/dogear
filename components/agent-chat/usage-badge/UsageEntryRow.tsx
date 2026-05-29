import { useState } from 'react';
import { CheckCircle2, AlertTriangle, ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { ConversationUsageEntry } from '@/types/usage';
import { formatTokens, cacheHitRate } from './usage-utils';

function fmtTime(ts: number): string {
  return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function statusInfo(entry: ConversationUsageEntry): { ok: boolean; label?: string } {
  if (entry.isError) return { ok: false, label: entry.apiErrorStatus ? `err ${entry.apiErrorStatus}` : 'error' };
  if (entry.terminalReason && entry.terminalReason !== 'end_turn') {
    return { ok: false, label: entry.terminalReason };
  }
  return { ok: true };
}

export function UsageEntryRow({ entry }: { entry: ConversationUsageEntry }) {
  const [open, setOpen] = useState(false);
  const status = statusInfo(entry);
  const hitRate = Math.round(cacheHitRate(entry.usage) * 100);
  const toolSummary = (entry.toolCalls ?? []).map(t => `${t.name}×${t.count}`).join(' ');

  const cc = entry.usage.cacheCreation;
  const hasDetail =
    !!cc || (entry.subagentCalls?.length ?? 0) > 0 || (entry.permissionDenials?.length ?? 0) > 0;

  return (
    <div className="rounded hover:bg-muted/40">
      <button
        type="button"
        onClick={() => hasDetail && setOpen(o => !o)}
        className="w-full flex items-center gap-2 py-0.5 text-left"
      >
        {hasDetail ? (
          <ChevronRight size={12} className={cn('shrink-0 transition-transform', open && 'rotate-90')} />
        ) : (
          <span className="w-3 shrink-0" />
        )}
        {status.ok ? (
          <CheckCircle2 size={12} className="shrink-0 text-green-600" />
        ) : (
          <AlertTriangle size={12} className="shrink-0 text-amber-500" />
        )}
        <span className="tabular-nums text-muted-foreground shrink-0">#{entry.turnIndex}</span>
        <span className="tabular-nums text-muted-foreground shrink-0">{fmtTime(entry.timestamp)}</span>
        {status.label && <span className="text-amber-600 shrink-0">{status.label}</span>}
        <span className="tabular-nums shrink-0">
          {formatTokens(entry.usage.inputTokens)}↑ {formatTokens(entry.usage.outputTokens)}↓
        </span>
        <span className="tabular-nums text-muted-foreground shrink-0">{hitRate}% cache</span>
        {toolSummary && <span className="truncate text-muted-foreground" title={toolSummary}>{toolSummary}</span>}
      </button>

      {open && hasDetail && (
        <div className="pl-7 pb-1 space-y-0.5 text-muted-foreground">
          {cc && (
            <div className="tabular-nums">
              缓存写入 5m {formatTokens(cc.ephemeral5mInputTokens)} · 1h {formatTokens(cc.ephemeral1hInputTokens)}
            </div>
          )}
          {entry.subagentCalls?.map((s, i) => (
            <div key={i} className="tabular-nums">
              子代理 {s.agentId}：{formatTokens(s.totalTokens)} tokens · {s.totalToolUseCount} 次工具
            </div>
          ))}
          {entry.permissionDenials?.map((d, i) => (
            <div key={i}>拒绝：{d.tool_name}</div>
          ))}
        </div>
      )}
    </div>
  );
}
