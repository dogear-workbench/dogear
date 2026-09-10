import { Loader2, OctagonX, Hourglass } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { PendingState } from './hooks/usePendingState';

interface StreamingIndicatorProps {
  pendingState: PendingState;
  pendingCount: number;
  lastBlockType?: string;
  /** 当前主会话仍在等待的子会话数量（>0 时文案改为「等待 N 个子会话交付」） */
  awaitCount?: number;
  /** 已完成的子会话数量（与 awaitCount 合并展示） */
  doneCount?: number;
  issueCount?: number;
  /** run settled（非 running/paused）但仍有 running 直属子会话：派生展示态「等待子会话交付中」，不阻塞输入 */
  awaitingDelivery?: boolean;
  /** 点击「🛑 中断等待」时调用（仅 awaitCount>0 才会出现） */
  onAbortWait?: () => void;
}

/** 运行状态指示器：在消息流底部显示当前 Agent 状态 */
export function StreamingIndicator({
  pendingState,
  pendingCount,
  lastBlockType,
  awaitCount = 0,
  doneCount = 0,
  issueCount = 0,
  awaitingDelivery = false,
  onAbortWait,
}: StreamingIndicatorProps) {
  const isAwaiting = pendingState === 'running' && awaitCount > 0;
  const isWaitingDelivery = pendingState === 'idle' && awaitingDelivery && awaitCount > 0;
  if (pendingState === 'idle' && !isAwaiting && !isWaitingDelivery) return null;

  const label = isAwaiting
    ? `等待 ${awaitCount} 个子会话交付…（已交付 ${doneCount}${issueCount > 0 ? `，异常 ${issueCount}` : ''}）`
    : isWaitingDelivery
      ? `等待子会话交付中…（${awaitCount} 个运行中${doneCount > 0 ? `，已交付 ${doneCount}` : ''}${issueCount > 0 ? `，异常 ${issueCount}` : ''}）`
      : pendingState === 'flushing'
        ? `队列还有 ${pendingCount} 条插话待回复…`
        : lastBlockType === 'thinking'
          ? '正在思考...'
          : lastBlockType === 'tool_use'
            ? '正在执行工具...'
            : '正在生成...';

  return (
    <div className="flex items-center justify-center gap-2 py-4 text-sm text-muted-foreground animate-pulse">
      {isWaitingDelivery
        ? <Hourglass className="w-4 h-4" />
        : <Loader2 className="w-4 h-4 animate-spin" />}
      <span>{label}</span>
      {(isAwaiting || isWaitingDelivery) && onAbortWait && (
        <Button
          variant="outline"
          size="sm"
          className="ml-2 h-6 text-xs gap-1"
          onClick={onAbortWait}
        >
          <OctagonX className="w-3 h-3" />
          中断等待
        </Button>
      )}
    </div>
  );
}
