import type { ConversationUsage, ConversationUsageEntry } from '@/types/usage';
import type { ContextInfo } from './usage-utils';
import { formatTokens, cacheHitRate } from './usage-utils';
import { UsageSummaryHeader } from './UsageSummaryHeader';
import { UsageByTool } from './UsageByTool';

interface Props {
  usage: ConversationUsage;
  context: ContextInfo;
  lastEntry: ConversationUsageEntry;
  isStreaming: boolean;
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

/** Popover 主容器：头部上下文 / 当前轮概览 / 流式中提示 / 按工具折叠区 / 会话累计小字 */
export function UsagePopoverContent({ usage, context, lastEntry, isStreaming }: Props) {
  const totals = usage.totals;
  const hitRate = Math.round(cacheHitRate(totals) * 100);

  return (
    <div className="divide-y">
      <UsageSummaryHeader context={context} />
      <div className="p-3 space-y-1.5">
        <div className="text-muted-foreground mb-1">
          {isStreaming ? '最近完成轮' : '当前轮'}
          <span className="ml-1 tabular-nums">#{lastEntry.turnIndex} · {fmtTime(lastEntry.timestamp)}</span>
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
      <UsageByTool usage={usage} />
      <div className="p-3 space-y-1 text-[11px] text-muted-foreground">
        <div>
          会话累计 {totals.turnCount} 轮 · 缓存命中率 <span className="tabular-nums">{hitRate}%</span>
        </div>
        <div className="grid grid-cols-2 gap-x-4 gap-y-0.5 tabular-nums">
          <Row label="Input total" value={formatTokens(totals.inputTokens)} />
          <Row label="Cache reads" value={formatTokens(totals.cacheReadInputTokens)} />
          <Row label="Output total" value={formatTokens(totals.outputTokens)} />
          <Row label="Cache writes" value={formatTokens(totals.cacheCreationInputTokens)} />
        </div>
      </div>
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
