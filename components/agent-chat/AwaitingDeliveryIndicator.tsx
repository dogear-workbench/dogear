import { Loader2 } from 'lucide-react';

interface AwaitingDeliveryIndicatorProps {
  /** 当前仍在运行的直属子会话数量（0 时整个组件不渲染） */
  awaitCount: number;
  doneCount: number;
  issueCount: number;
}

/**
 * 等待子会话交付动效：挂在聊天区右侧工具轨道（MessageMinimap 同列），
 * 取代原主聊天流 StreamingIndicator 里的等待文案，不与消息流打架。
 */
export function AwaitingDeliveryIndicator({
  awaitCount,
  doneCount,
  issueCount,
}: AwaitingDeliveryIndicatorProps) {
  if (awaitCount <= 0) return null;

  const title = `等待子会话交付中…（${awaitCount} 个运行中${doneCount > 0 ? `，已交付 ${doneCount}` : ''}${issueCount > 0 ? `，异常 ${issueCount}` : ''}）`;

  return (
    <div
      className="w-8 h-8 flex items-center justify-center rounded-md"
      title={title}
    >
      <Loader2 size={14} className="text-orange-500 animate-spin" />
    </div>
  );
}
