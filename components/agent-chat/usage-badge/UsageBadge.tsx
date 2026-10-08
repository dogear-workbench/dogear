import { Gauge } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Popover, PopoverTrigger, PopoverContent } from '@/components/ui/popover';
import { useConversationUsage } from './useConversationUsage';
import { UsagePopoverContent } from './UsagePopoverContent';
import { formatTokens } from './usage-utils';

/**
 * 输入框工具栏的用量徽章：进度条 + token 文字，点击弹出用量详情。
 * 上下文占用来自主进程写入的快照（context.used）；无快照时只显示统计、不画进度条。
 * 占用超过自动压缩阈值（nearCompact）时变红提示「即将压缩」。
 */
export function UsageBadge({
  conversationId,
  isStreaming = false,
}: {
  conversationId: string | null;
  isStreaming?: boolean;
}) {
  const { usage, context } = useConversationUsage(conversationId);

  const lastEntry = usage?.entries[usage.entries.length - 1];
  if (!usage || !lastEntry) return null;

  const used = context.used;
  const limit = context.limit;
  const hasBar = used !== null && limit > 0;
  const ratio = hasBar ? Math.min(used / limit, 1) : 0;
  const barColor = context.nearCompact || ratio > 0.85
    ? 'bg-red-500'
    : ratio > 0.6 ? 'bg-amber-500' : 'bg-muted-foreground';

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="flex items-center gap-1.5 h-6 px-1.5 rounded text-xs text-muted-foreground hover:text-foreground transition-colors"
          title="上下文用量"
        >
          <Gauge size={14} />
          {hasBar && (
            <span className="relative w-12 h-1.5 rounded-full bg-border overflow-hidden">
              <span
                className={cn('absolute inset-y-0 left-0 rounded-full transition-all', barColor)}
                style={{ width: `${ratio * 100}%` }}
              />
            </span>
          )}
          <span className="tabular-nums">
            {used !== null ? formatTokens(used) : '—'}
            {hasBar ? ` / ${formatTokens(limit)}` : ''}
          </span>
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-[460px] p-0 text-xs">
        <UsagePopoverContent usage={usage} context={context} lastEntry={lastEntry} isStreaming={isStreaming} conversationId={conversationId} />
      </PopoverContent>
    </Popover>
  );
}
