import { useState, useRef, useEffect } from 'react';
import { Send } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { MessageBubble } from './MessageBubble';
import type { WechatMessage, WechatContact } from '@/types/wechat';

interface MessagePanelProps {
  contact: WechatContact | null;
  messages: WechatMessage[];
  loading: boolean;
  sending: boolean;
  onSend: (content: string) => void;
}

/** 消息间是否需要插入日期分隔线 */
function needDateSeparator(prev: WechatMessage | undefined, curr: WechatMessage): boolean {
  if (!prev) return true;
  const prevDate = new Date(prev.timestamp).toDateString();
  const currDate = new Date(curr.timestamp).toDateString();
  return prevDate !== currDate;
}

function formatDate(timestamp: number): string {
  const d = new Date(timestamp);
  const now = new Date();
  if (d.toDateString() === now.toDateString()) return '今天';
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (d.toDateString() === yesterday.toDateString()) return '昨天';
  return `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()}`;
}

export function MessagePanel({ contact, messages, loading, sending, onSend }: MessagePanelProps) {
  const [input, setInput] = useState('');
  const scrollRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  // 消息变化时滚动到底部
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages.length]);

  const handleSend = () => {
    const text = input.trim();
    if (!text) return;
    onSend(text);
    setInput('');
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  if (!contact) {
    return (
      <div className="flex-1 flex items-center justify-center text-sm text-muted-foreground">
        选择一个联系人开始查看消息
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col h-full">
      {/* 联系人名称 */}
      <div className="h-10 border-b flex items-center px-4 shrink-0">
        <span className="text-sm font-medium">{contact.name}</span>
        {contact.isGroup && <span className="text-xs text-muted-foreground ml-1">(群聊)</span>}
      </div>

      {/* 消息区域 */}
      <ScrollArea className="flex-1 py-2" ref={scrollRef}>
        {loading && messages.length === 0 ? (
          <div className="flex items-center justify-center h-20 text-sm text-muted-foreground">
            加载中...
          </div>
        ) : messages.length === 0 ? (
          <div className="flex items-center justify-center h-20 text-sm text-muted-foreground">
            暂无消息
          </div>
        ) : (
          <>
            {messages.map((msg, i) => (
              <div key={msg.id}>
                {needDateSeparator(messages[i - 1], msg) && (
                  <div className="text-center text-[10px] text-muted-foreground py-2">
                    {formatDate(msg.timestamp)}
                  </div>
                )}
                <MessageBubble message={msg} showSender={contact.isGroup} />
              </div>
            ))}
          </>
        )}
        <div ref={bottomRef} />
      </ScrollArea>

      {/* 输入区域 */}
      <div className="border-t p-3 flex gap-2 shrink-0">
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={contact.contextToken ? '输入消息...' : '需要先收到对方消息才能回复'}
          disabled={!contact.contextToken}
          rows={1}
          className="flex-1 resize-none bg-muted rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-ring disabled:opacity-50 disabled:cursor-not-allowed"
        />
        <Button
          size="icon"
          onClick={handleSend}
          disabled={!input.trim() || sending || !contact.contextToken}
        >
          <Send className="w-4 h-4" />
        </Button>
      </div>
    </div>
  );
}
