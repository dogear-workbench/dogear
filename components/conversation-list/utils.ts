import type { Conversation } from '@/components/ConversationList';
import { useSessionStore } from '@/stores/session-store';
import { useConversationStore } from '@/stores/conversation-store';
import { client } from '@/lib/client';

export function getRelativeTime(timestamp: number): string {
  const now = Date.now();
  const diff = now - timestamp;
  const minutes = Math.floor(diff / 60000);
  const hours = Math.floor(diff / 3600000);
  const days = Math.floor(diff / 86400000);

  if (minutes < 1) return '刚刚';
  if (minutes < 60) return `${minutes}分钟前`;
  if (hours < 24) return `${hours}小时前`;
  if (days < 7) return `${days}天前`;

  const date = new Date(timestamp);
  return date.toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' });
}

export function getConversationTitle(conversation: Conversation): string {
  if (conversation.title && conversation.title !== '新对话') {
    return conversation.title;
  }
  const date = new Date(conversation.created_at);
  const now = new Date();
  const isToday = date.toDateString() === now.toDateString();
  if (isToday) {
    return `对话 ${date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}`;
  }
  return `对话 ${date.toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' })}`;
}

// 「近期」阈值（设计 §4.1：< 5 天）
export const RECENT_DAYS = 5;
export const RECENT_THRESHOLD_MS = RECENT_DAYS * 86400_000;

// 「30 天内 / 更早」阈值（TimeSection 用）
export const TIME_BUCKET_DAYS = 30;
export const TIME_BUCKET_THRESHOLD_MS = TIME_BUCKET_DAYS * 86400_000;

/**
 * 统一打开会话 tab 的入口
 * sessionWindowIds.has(conv.id) 时调 client.openSessionWindow，否则 selectConversation + openTab
 */
export function openOrFocusConversation(conv: Conversation): void {
  const sessionWindowIds = useSessionStore.getState().sessionWindowIds;
  if (sessionWindowIds.has(conv.id)) {
    client.openSessionWindow({ conversationId: conv.id, title: getConversationTitle(conv) });
    return;
  }
  const { selectConversation } = useConversationStore.getState();
  selectConversation(conv);
}

/**
 * 同一 conversationId 在多少处出现（手动文件夹数 + 智能分类数）
 * Phase 16 实现；Phase 14 占位返回 0
 */
export function useAppearanceCount(_conversationId: string): number {
  return 0; // TODO: Phase 16 实现
}
