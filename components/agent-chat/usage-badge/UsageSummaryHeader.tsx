import type { ConversationUsage, ConversationUsageEntry } from '@/types/usage';
import type { ContextInfo } from './usage-utils';
import { formatTokens, cacheHitRate } from './usage-utils';

interface Props {
  usage: ConversationUsage;
  context: ContextInfo;
  lastEntry: ConversationUsageEntry;
}

function fmtMs(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

/**
 * 头部：当前上下文占用（SDK 真实快照）+ 会话级缓存命中率 + 累计轮数/API 用时/首 token + token 合计。
 * 金额不显示。
 */
export function UsageSummaryHeader({ usage, context }: Props) {
  const totals = usage.totals;
  const used = context.used;
  const limit = context.limit;
  const pct = used !== null && limit > 0 ? Math.round(context.percentage) : null;

  // 会话级缓存命中率：整个会话累计输入里有多少命中缓存
  const hitRate = Math.round(cacheHitRate(totals) * 100);

  const apiMs = usage.entries.reduce((s, e) => s + (e.durationApiMs || 0), 0);
  const ttfts = usage.entries.map(e => e.ttftMs).filter((x): x is number => typeof x === 'number');
  const avgTtft = ttfts.length ? ttfts.reduce((a, b) => a + b, 0) / ttfts.length : null;

  return (
    <div className="p-3 space-y-1.5">
      <div className="flex items-baseline justify-between">
        <span className="text-muted-foreground">上下文{context.label && ` · ${context.label}`}</span>
        {used !== null ? (
          <span className="tabular-nums font-medium">
            {used.toLocaleString()}
            {limit > 0 ? ` / ${limit.toLocaleString()}` : ''}
            {pct !== null && <span className="text-muted-foreground"> ({pct}%)</span>}
          </span>
        ) : (
          <span className="text-muted-foreground">暂无（发送一条消息后刷新）</span>
        )}
      </div>
      <div className="text-muted-foreground">
        会话缓存命中率 <span className="tabular-nums text-foreground">{hitRate}%</span>
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
