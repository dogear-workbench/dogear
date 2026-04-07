import { cn } from '@/lib/utils';
import type { WechatMessage } from '@/types/wechat';

interface MessageBubbleProps {
  message: WechatMessage;
  showSender?: boolean; // 群聊时显示发送者
}

function formatTime(timestamp: number): string {
  const d = new Date(timestamp);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

export function MessageBubble({ message, showSender }: MessageBubbleProps) {
  const isOut = message.isOutgoing;

  return (
    <div className={cn('flex gap-2 px-3 py-1', isOut ? 'justify-end' : 'justify-start')}>
      <div className={cn('max-w-[70%] flex flex-col', isOut ? 'items-end' : 'items-start')}>
        {/* 发送者名（群聊收到的消息） */}
        {showSender && !isOut && (
          <span className="text-xs text-muted-foreground mb-0.5 px-1">
            {message.senderName}
          </span>
        )}

        {/* 气泡 */}
        <div
          className={cn(
            'rounded-lg px-3 py-2 text-sm break-words whitespace-pre-wrap',
            isOut
              ? 'bg-primary text-primary-foreground'
              : 'bg-muted',
          )}
        >
          {message.content || `[${message.messageType}]`}
        </div>

        {/* 时间 */}
        <span className="text-[10px] text-muted-foreground mt-0.5 px-1">
          {formatTime(message.timestamp)}
        </span>
      </div>
    </div>
  );
}
