import { Hourglass } from 'lucide-react';

interface AwaitingDeliveryIndicatorProps {
  /** 当前仍在运行的直属子会话数量（0 时整个组件不渲染） */
  awaitCount: number;
  doneCount: number;
  issueCount: number;
  /** 点击中断等待；缺省时按钮禁用中断语义（仍展示动效） */
  onAbortWait?: () => void;
}

/**
 * 等待子会话交付动效：挂在聊天区右侧工具轨道（MessageMinimap 同列），
 * 取代原主聊天流 StreamingIndicator 里的等待文案，不与消息流打架。
 * 点击 = 中断等待（原「中断等待」按钮随迁至此）。
 */
export function AwaitingDeliveryIndicator({
  awaitCount,
  doneCount,
  issueCount,
  onAbortWait,
}: AwaitingDeliveryIndicatorProps) {
  if (awaitCount <= 0) return null;

  const title = `等待子会话交付中…（${awaitCount} 个运行中${doneCount > 0 ? `，已交付 ${doneCount}` : ''}${issueCount > 0 ? `，异常 ${issueCount}` : ''}）${onAbortWait ? ' · 点击中断等待' : ''}`;

  return (
    <button
      className="relative w-8 h-8 flex items-center justify-center rounded-md transition-colors hover:bg-muted"
      title={title}
      onClick={onAbortWait}
    >
      <span className="absolute inset-0 rounded-md bg-orange-400/25 animate-ping" />
      <Hourglass size={14} className="relative text-orange-500 animate-pulse" />
    </button>
  );
}
