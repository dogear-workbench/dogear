import type { Group } from '@/types/group';
import type { Conversation } from '@/components/ConversationList';
import { getConversationTitle } from '@/components/conversation-list/utils';

export function deriveGroupTitle(group: Group, conversations: Conversation[]): string {
  if (group.title && group.title.trim() && group.title !== '新对话') return group.title;
  if (conversations.length === 0) return '空话题';
  const first = getConversationTitle(conversations[0]);
  if (conversations.length === 1) return first;
  return `${first} 等 ${conversations.length} 个`;
}
