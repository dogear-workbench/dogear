import { Users, User } from 'lucide-react';
import { cn } from '@/lib/utils';
import { ScrollArea } from '@/components/ui/scroll-area';
import type { WechatContact } from '@/types/wechat';

interface ContactListProps {
  contacts: WechatContact[];
  selectedId: string | null;
  loading: boolean;
  onSelect: (contactId: string) => void;
}

function formatTime(timestamp?: number): string {
  if (!timestamp) return '';
  const d = new Date(timestamp);
  const now = new Date();
  // 今天：显示时间
  if (d.toDateString() === now.toDateString()) {
    return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  }
  // 其他：显示日期
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

export function ContactList({ contacts, selectedId, loading, onSelect }: ContactListProps) {
  if (loading && contacts.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center text-sm text-muted-foreground">
        加载中...
      </div>
    );
  }

  if (contacts.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center text-sm text-muted-foreground px-4 text-center">
        暂无联系人，等待收到微信消息...
      </div>
    );
  }

  return (
    <ScrollArea className="flex-1">
      {contacts.map((contact) => (
        <button
          key={contact.id}
          onClick={() => onSelect(contact.id)}
          className={cn(
            'w-full flex items-start gap-2.5 px-3 py-2.5 text-left hover:bg-accent transition-colors',
            selectedId === contact.id && 'bg-accent',
          )}
        >
          {/* 头像占位 */}
          <div className="w-9 h-9 rounded-full bg-muted flex items-center justify-center shrink-0 mt-0.5">
            {contact.isGroup
              ? <Users className="w-4 h-4 text-muted-foreground" />
              : <User className="w-4 h-4 text-muted-foreground" />
            }
          </div>

          {/* 名称 + 最后消息 */}
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-1">
              <span className="text-sm font-medium truncate flex-1">
                {contact.name}
              </span>
              <span className="text-[10px] text-muted-foreground shrink-0">
                {formatTime(contact.lastMessageAt)}
              </span>
            </div>
            <div className="flex items-center gap-1 mt-0.5">
              <span className="text-xs text-muted-foreground truncate flex-1">
                {contact.lastMessage || ''}
              </span>
              {contact.unreadCount > 0 && (
                <span className="shrink-0 min-w-[18px] h-[18px] rounded-full bg-destructive text-destructive-foreground text-[10px] flex items-center justify-center px-1">
                  {contact.unreadCount > 99 ? '99+' : contact.unreadCount}
                </span>
              )}
            </div>
          </div>
        </button>
      ))}
    </ScrollArea>
  );
}
