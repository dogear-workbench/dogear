import { useEffect, useRef, useState } from 'react';
import { Bell, ClipboardList, MessageSquare, CheckCheck } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Popover, PopoverTrigger, PopoverContent } from '@/components/ui/popover';
import { cn } from '@/lib/utils';
import { client } from '@/lib/client';
import { toast } from 'sonner';
import { openOrFocusConversation } from '@/components/conversation-list/utils';
import type { Conversation } from '@/components/ConversationList';
import type { NotificationCenterEntry } from '@/types/notification';
import { useNotificationStore } from '@/stores/notification-store';
import { useWorkspaceStore } from '@/stores/workspace-store';
import { useSessionStore, NOTES_TAB_ID } from '@/stores/session-store';
import { useConversationStore } from '@/stores/conversation-store';
import { useTaskFocusStore } from '@/stores/task-focus-store';

function formatTime(iso: string): string {
  const ts = Date.parse(iso);
  if (Number.isNaN(ts)) return '';
  const diff = Date.now() - ts;
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return '刚刚';
  if (minutes < 60) return `${minutes} 分钟前`;
  const hours = Math.floor(diff / 3600000);
  if (hours < 24) return `${hours} 小时前`;
  const date = new Date(ts);
  return date.toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' });
}

async function findWorkspace(workspaceId: string) {
  const result = await client.getAll();
  return result.workspaces?.find((w) => w.id === workspaceId) ?? null;
}

async function findConversationById(workspaceId: string, conversationId: string): Promise<Conversation | null> {
  const local = useConversationStore.getState().conversations.find((c) => c.id === conversationId);
  if (local) return local;
  try {
    const result = await client.getByWorkspaceId({ workspaceId });
    return (result.conversations ?? []).find((c) => c.id === conversationId) ?? null;
  } catch {
    return null;
  }
}

export function NotificationCenter() {
  const [open, setOpen] = useState(false);
  const openRef = useRef(false);
  const notifications = useNotificationStore((s) => s.notifications);
  const unreadCount = useNotificationStore((s) => s.unreadCount);
  const loaded = useNotificationStore((s) => s.loaded);
  const loadNotifications = useNotificationStore((s) => s.loadNotifications);
  const markAllRead = useNotificationStore((s) => s.markAllRead);

  openRef.current = open;

  // 窗口加载拉初值（重启恢复未读）+ 变更广播订阅（面板开着重拉、未开只更徽章）
  useEffect(() => {
    if (!loaded) void loadNotifications();
    const unsub = useNotificationStore.getState().subscribeNotificationsChanged(() => openRef.current);
    return () => unsub();
  }, [loaded, loadNotifications]);

  async function openEntry(entry: NotificationCenterEntry) {
    void useNotificationStore.getState().markRead(entry.id);
    if (entry.type === 'task' && entry.taskId && entry.workspaceId) {
      try {
        const ws = await findWorkspace(entry.workspaceId);
        if (!ws) {
          toast.warning('任务所属工作区不存在');
          return;
        }
        const currentWs = useWorkspaceStore.getState().workspace;
        if (currentWs?.id !== ws.id) {
          await useWorkspaceStore.getState().setWorkspace(ws);
        }
        useSessionStore.getState().switchTab(NOTES_TAB_ID);
        useTaskFocusStore.getState().requestTaskFocus(entry.taskId);
      } catch (err) {
        console.error('[notifications] 跳转任务失败:', err);
      }
      return;
    }
    if (entry.type === 'conversation' && entry.owner.kind === 'conversation' && entry.workspaceId) {
      const conv = await findConversationById(entry.workspaceId, entry.owner.conversationId);
      if (!conv) {
        toast.warning('会话不存在或已删除');
        return;
      }
      openOrFocusConversation(conv, conv.groupId ? `topic:${conv.groupId}:${conv.id}` : undefined);
    }
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="sm" className="relative h-8 w-8 p-0" title="消息中心">
          <Bell className="w-4 h-4" />
          {unreadCount > 0 && (
            <span className="absolute -top-0.5 -right-0.5 min-w-[16px] h-4 px-1 rounded-full bg-red-500 text-white text-[10px] leading-4 font-medium text-center">
              {unreadCount > 99 ? '99+' : unreadCount}
            </span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-96 p-0">
        <div className="flex items-center justify-between px-3 py-2 border-b">
          <span className="text-sm font-medium">通知</span>
          {unreadCount > 0 && (
            <Button variant="ghost" size="sm" className="h-7 gap-1 text-xs" onClick={() => void markAllRead()}>
              <CheckCheck className="w-3.5 h-3.5" />
              全部已读
            </Button>
          )}
        </div>
        <div className="max-h-96 overflow-y-auto">
          {notifications.length === 0 ? (
            <div className="py-10 text-center text-sm text-muted-foreground">暂无通知</div>
          ) : (
            notifications.map((entry) => (
              <button
                key={entry.id}
                className={cn(
                  'w-full text-left px-3 py-2.5 flex gap-2.5 border-b last:border-b-0 transition-colors hover:bg-accent/50',
                  !entry.read && 'bg-accent/30',
                )}
                onClick={() => void openEntry(entry)}
              >
                <span className="mt-0.5 shrink-0">
                  {entry.type === 'task' ? (
                    <ClipboardList className="w-4 h-4 text-muted-foreground" />
                  ) : (
                    <MessageSquare className="w-4 h-4 text-muted-foreground" />
                  )}
                </span>
                <span className="flex-1 min-w-0">
                  <span className="flex items-center gap-1.5">
                    {!entry.read && <span className="w-1.5 h-1.5 rounded-full bg-red-500 shrink-0" />}
                    <span className={cn('text-sm truncate', !entry.read ? 'font-medium' : 'text-foreground/80')}>
                      {entry.title}
                    </span>
                    {entry.count > 1 && (
                      <span className="shrink-0 text-[10px] px-1 rounded bg-muted text-muted-foreground">×{entry.count}</span>
                    )}
                  </span>
                  {entry.summary && (
                    <span className="block text-xs text-muted-foreground truncate mt-0.5">{entry.summary}</span>
                  )}
                  <span className="flex items-center gap-2 mt-1 text-[11px] text-muted-foreground/70">
                    <span className="truncate max-w-[180px]">{entry.ownerLabel ?? (entry.type === 'task' ? '系统' : '')}</span>
                    <span className="shrink-0">{formatTime(entry.createdAt)}</span>
                  </span>
                </span>
              </button>
            ))
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
