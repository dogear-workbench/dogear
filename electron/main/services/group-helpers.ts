import type { Group } from '../types.js';
import type { ConversationIndex } from './conversation-service.js';

/** 派生组的显示标题：group.title 优先；否则用组内最近活跃的 main 会话 title + 「等N个」 */
export function deriveGroupTitle(group: Group, conversations: ConversationIndex[]): string {
  if (group.title?.trim()) return group.title;
  const mains = conversations
    .filter((c) => c.groupId === group.id && c.role !== 'sub')
    .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
  if (mains.length === 0) return '(未命名组)';
  const head = mains[0].title || '(未命名)';
  return mains.length > 1 ? `${head} 等${mains.length}个` : head;
}
