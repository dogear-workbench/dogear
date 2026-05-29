import type { ConversationUsage, ConversationUsageEntry } from '@/types/usage';
import { formatTokens, currentContextSize, cacheHitRate } from './usage-utils';

interface Props {
  usage: ConversationUsage;
  contextLimit: { limit: number; label: string };
  lastEntry: ConversationUsageEntry;
}

function fmtMs(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

/** 头部：上下文进度大字 + 上次输入/缓存命中 + 累计轮数/API 用时/首 token + token 合计。金额不显示。 */
export function UsageSummaryHeader({ usage, contextLimit, lastEntry }: Props) {
  const used = currentContextSize(lastEntry.usage);
  const limit = contextLimit.limit;
  const pct = limit > 0 ? Math.round((used / limit) * 100) : null;
  const hitRate = Math.round(cacheHitRate(lastEntry.usage) * 100);

  const totals = usage.totals;
  const apiMs = usage.entries.reduce((s, e) => s + (e.durationApiMs || 0), 0);
  const ttfts = usage.entries.map(e => e.ttftMs).filter((x): x is number => typeof x === 'number');
  const avgTtft = ttfts.length ? ttfts.reduce((a, b) => a + b, 0) / ttfts.length : null;

  return (
    <div className="p-3 space-y-1.5">
      <div className="flex items-baseline justify-between">
        <span className="text-muted-foreground">上下文{contextLimit.label && ` · ${contextLimit.label}`}</span>
        <span className="tabular-nums font-medium">
          {used.toLocaleString()}
          {limit > 0 ? ` / ${limit.toLocaleString()}` : ''}
          {pct !== null && <span className="text-muted-foreground"> ({pct}%)</span>}
        </span>
      </div>
      <div className="flex items-center gap-4 text-muted-foreground">
        <span>上次输入 <span className="tabular-nums text-foreground">{lastEntry.usage.inputTokens.toLocaleString()}</span></span>
        <span>缓存命中 <span className="tabular-nums text-foreground">{lastEntry.usage.cacheReadInputTokens.toLocaleString()} ({hitRate}%)</span></span>
      </div>

      <div className="pt-1 text-muted-foreground">
        累计 {totals.turnCount} 轮 · API 用时 {fmtMs(apiMs)}
        {avgTtft !== null && ` · 首 token 平均 ${fmtMs(avgTtft)}`}
      </div>
      <div className="grid grid-cols-2 gap-x-4 gap-y-0.5 tabular-nums">
        <Row label="Input total" value={formatTokens(totals.inputTokens)} />
        <Row label="Cache reads" value={formatTokens(totals.cacheReadInputTokens)} />
        <Row label="Output total" value={formatTokens(totals.outputTokens)} />
        <Row label="Cache writes" value={formatTokens(totals.cacheCreationInputTokens)} />
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between">
      <span className="text-muted-foreground">{label}</span>
      <span>{value}</span>
    </div>
  );
}
