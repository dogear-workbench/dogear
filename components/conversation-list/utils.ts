import type { Conversation } from '@/components/ConversationList';
import { useSessionStore } from '@/stores/session-store';
import { useConversationStore } from '@/stores/conversation-store';
import { client } from '@/lib/client';

export function getRelativeTime(timestamp: string | number): string {
  const time = new Date(timestamp).getTime();
  const now = Date.now();
  const diff = now - time;
  const minutes = Math.floor(diff / 60000);
  const hours = Math.floor(diff / 3600000);
  const days = Math.floor(diff / 86400000);

  if (minutes < 1) return '刚刚';
  if (minutes < 60) return `${minutes}分钟前`;
  if (hours < 24) return `${hours}小时前`;
  if (days < 7) return `${days}天前`;

  const date = new Date(time);
  return date.toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' });
}

export function getConversationTitle(conversation: Conversation): string {
  if (conversation.title && conversation.title !== '新对话') {
    return conversation.title;
  }
  const date = new Date(conversation.createdAt);
  const now = new Date();
  const isToday = date.toDateString() === now.toDateString();
  if (isToday) {
    return `对话 ${date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}`;
  }
  return `对话 ${date.toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' })}`;
}

// 时间分区阈值常量在 group-store（默认展开逻辑共用），此处转发保持导入路径稳定
import { RECENT_THRESHOLD_MS, OLDER_THRESHOLD_MS } from '@/stores/group-store';
export { RECENT_THRESHOLD_MS, OLDER_THRESHOLD_MS };

export const RECENT_DAYS = RECENT_THRESHOLD_MS / 86400_000;
export const OLDER_DAYS = OLDER_THRESHOLD_MS / 86400_000;

/**
 * 节点高亮状态：
 * - isOpen: conversationId 在 tabs 里（淡色背景，可能多节点）
 * - isSelected: 当前活动 tab 的会话（深色背景）；独立窗口打开的会话无 tab，退回「最近点击的节点」
 */
export function useNodeHighlight(conversationId: string, nodeId: string): { isOpen: boolean; isSelected: boolean } {
  const tabs = useSessionStore((s) => s.tabs);
  const activeTabId = useSessionStore((s) => s.activeTabId);
  const sessionWindowIds = useSessionStore((s) => s.sessionWindowIds);
  const lastFocusedNodeId = useSessionStore((s) => s.lastFocusedNodeId);
  const isOpen = tabs.some((t) => t.conversationId === conversationId);
  const isSelected =
    activeTabId === conversationId ||
    (sessionWindowIds.has(conversationId) && lastFocusedNodeId === nodeId);
  return { isOpen, isSelected };
}

/**
 * 统一打开会话 tab 的入口
 * sessionWindowIds.has(conv.id) 时调 client.openSessionWindow，否则 selectConversation + openTab
 */
export function openOrFocusConversation(conv: Conversation, nodeId?: string): void {
  const sessionWindowIds = useSessionStore.getState().sessionWindowIds;
  if (nodeId) useSessionStore.getState().setLastFocusedNodeId(nodeId);
  if (sessionWindowIds.has(conv.id)) {
    client.openSessionWindow({ conversationId: conv.id, title: getConversationTitle(conv) });
    return;
  }
  const { selectConversation } = useConversationStore.getState();
  selectConversation(conv);
  useSessionStore.getState().openTab(conv.id, getConversationTitle(conv), conv.workspaceId);
}

/**
 * personal 临时会话行打开：只开 tab，不写当前工作区分片与组状态（personal 平铺无组概念）
 */
export function openPersonalConversation(conv: Conversation): void {
  const sessionWindowIds = useSessionStore.getState().sessionWindowIds;
  if (sessionWindowIds.has(conv.id)) {
    client.openSessionWindow({ conversationId: conv.id, title: getConversationTitle(conv) });
    return;
  }
  useSessionStore.getState().openTab(conv.id, getConversationTitle(conv), conv.workspaceId);
}

