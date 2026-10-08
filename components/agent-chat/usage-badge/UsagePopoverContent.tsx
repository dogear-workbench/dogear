import type { ConversationUsage, ConversationUsageEntry } from '@/types/usage';
import type { ContextInfo } from './usage-utils';
import { formatTokens, cacheHitRate } from './usage-utils';
import { sumSessionCost, formatCost } from './pricing-utils';
import { useSettingsStore } from '@/stores/settings-store';
import { UsageSummaryHeader } from './UsageSummaryHeader';
import { TurnDetailList } from '@/components/usage/TurnDetailList';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { ChevronRight } from 'lucide-react';

interface Props {
  usage: ConversationUsage;
  context: ContextInfo;
  lastEntry: ConversationUsageEntry;
  isStreaming: boolean;
  conversationId: string | null;
}

function fmtTime(ts: number): string {
  return new Date(ts).toLocaleString([], {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/**
 * 当前轮逐模型分桶：in/out 一行、cache 读/写 + 命中率一行。
 * 命中率按桶内 inputTokens + cacheReadInputTokens 口径计算。
 */
function ModelBucketRows({ entry }: { entry: ConversationUsageEntry }) {
  const buckets = Object.entries(entry.modelUsage ?? {});
  if (buckets.length === 0) {
    return <div className="text-muted-foreground">—</div>;
  }
  return (
    <div className="space-y-1.5">
      {buckets.map(([model, m]) => (
        <div key={model} className="space-y-0.5">
          <div className="flex items-center gap-2">
            <span className="truncate font-medium" title={model}>{model}</span>
            <span className="ml-auto shrink-0 tabular-nums">
              {formatTokens(m.inputTokens)}↑ {formatTokens(m.outputTokens)}↓
            </span>
          </div>
          <div className="tabular-nums text-muted-foreground">
            缓存读 {formatTokens(m.cacheReadInputTokens)} · 写 {formatTokens(m.cacheCreationInputTokens)}
            {' '}· 命中 {Math.round(cacheHitRate(m) * 100)}%
          </div>
        </div>
      ))}
    </div>
  );
}

/** Popover 主容器：头部上下文构成 / 会话累计（计费口径，对齐用量页）/ 当前轮概览 / 每轮明细折叠 */
export function UsagePopoverContent({ usage, context, lastEntry, isStreaming, conversationId }: Props) {
  const settings = useSettingsStore((s) => s.settings);
  const totals = usage.totals;
  const hitRate = Math.round(cacheHitRate(totals) * 100);
  const sessionTotal = totals.inputTokens + totals.outputTokens + totals.cacheReadInputTokens;
  const llmCallCount = usage.entries.reduce((n, e) => n + (e.numTurns || 0), 0);
  const sessionCost = sumSessionCost(usage.entries, settings);

  return (
    <div className="divide-y">
      <UsageSummaryHeader context={context} />
      <div className="p-3 space-y-1.5">
        <div className="flex items-baseline justify-between">
          <span className="text-muted-foreground">会话累计消耗</span>
          <span className="tabular-nums font-medium">{formatTokens(sessionTotal)}</span>
        </div>
        <div className="tabular-nums text-muted-foreground">
          {totals.turnCount} 轮 · {llmCallCount} 次模型调用 · 缓存命中 {hitRate}%
          {sessionCost != null && ` · ${formatCost(sessionCost)}`}
        </div>
        <div className="grid grid-cols-2 gap-x-4 gap-y-0.5 tabular-nums text-muted-foreground">
          <Row label="Input" value={formatTokens(totals.inputTokens)} />
          <Row label="Output" value={formatTokens(totals.outputTokens)} />
          <Row label="缓存读" value={formatTokens(totals.cacheReadInputTokens)} />
          <Row label="缓存写" value={formatTokens(totals.cacheCreationInputTokens)} />
        </div>
      </div>
      <div className="p-3 space-y-1.5">
        <div className="text-muted-foreground mb-1">
          {isStreaming ? '最近完成轮' : '当前轮'}
          <span className="ml-1 tabular-nums">第 {lastEntry.turnIndex + 1} 轮 · {fmtTime(lastEntry.timestamp)}</span>
        </div>
        <ModelBucketRows entry={lastEntry} />
        {isStreaming && (
          <div className="flex items-center gap-1.5 pt-1 text-muted-foreground">
            <span className="relative flex size-2">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-sky-400 opacity-75" />
              <span className="relative inline-flex size-2 rounded-full bg-sky-500" />
            </span>
            本轮进行中
            {context.used !== null && <span className="tabular-nums">· 当前占用 {formatTokens(context.used)}</span>}
          </div>
        )}
      </div>
      {conversationId && (
        <Collapsible>
          <CollapsibleTrigger className="group flex w-full items-center gap-1 p-3 text-muted-foreground hover:text-foreground">
            <ChevronRight size={14} className="transition-transform group-data-[state=open]:rotate-90" />
            每轮明细（{usage.entries.length} 轮）
          </CollapsibleTrigger>
          <CollapsibleContent>
            <div className="max-h-64 overflow-y-auto px-3 pb-3">
              <TurnDetailList conversationId={conversationId} />
            </div>
          </CollapsibleContent>
        </Collapsible>
      )}
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between">
      <span>{label}</span>
      <span>{value}</span>
    </div>
  );
}
