import { useState } from 'react';
import { Gauge } from 'lucide-react';
import { cn } from '@/lib/utils';
import { HoverCard, HoverCardTrigger, HoverCardContent } from '@/components/ui/hover-card';
import { useConversationUsage } from './useConversationUsage';
import { UsageHoverCard } from './UsageHoverCard';
import { formatTokens } from './usage-utils';

/**
 * 输入框工具栏的用量徽章：进度条 + token 文字，hover/click 展开详情卡片。
 * 上下文占用来自 SDK 真实快照（context.used）；无快照时只显示统计、不画进度条。
 */
export function UsageBadge({ conversationId }: { conversationId: string | null }) {
  const { usage, enable1MContext, context } = useConversationUsage(conversationId);
  const [open, setOpen] = useState(false);
  const [pinned, setPinned] = useState(false);

  const lastEntry = usage?.entries[usage.entries.length - 1];
  if (!usage || !lastEntry) return null;

  const used = context.used;
  const limit = context.limit;
  const hasBar = used !== null && limit > 0;
  const ratio = hasBar ? Math.min(used / limit, 1) : 0;
  const barColor = ratio > 0.85 ? 'bg-red-500' : ratio > 0.6 ? 'bg-amber-500' : 'bg-muted-foreground';

  // 固定（pinned）时拦截 hover 关闭，只能再次点击徽章解除
  const handleOpenChange = (o: boolean) => {
    if (!pinned) setOpen(o);
  };
  const togglePin = () => {
    setPinned(p => {
      const next = !p;
      setOpen(next);
      return next;
    });
  };

  return (
    <HoverCard open={open} onOpenChange={handleOpenChange} openDelay={300}>
      <HoverCardTrigger asChild>
        <button
          type="button"
          onClick={togglePin}
          className={cn(
            'flex items-center gap-1.5 h-6 px-1.5 rounded text-xs text-muted-foreground hover:text-foreground transition-colors',
            pinned && 'text-foreground',
          )}
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
          {enable1MContext && (
            <span className="px-1 py-0.5 rounded bg-muted text-[10px] leading-none">1M</span>
          )}
        </button>
      </HoverCardTrigger>
      <HoverCardContent align="end" className="w-[560px] p-0 text-xs">
        <UsageHoverCard usage={usage} context={context} lastEntry={lastEntry} />
      </HoverCardContent>
    </HoverCard>
  );
}
