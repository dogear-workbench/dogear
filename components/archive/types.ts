import type { Group } from '@/types/group';
import type { ConversationTreeNode } from '@/lib/conversation-sort';

/** 归档页选中态：话题 + 话题内主会话（Step 3 右侧 digest 视图以此为键） */
export interface ArchiveSelection {
  topicId: string;
  conversationId: string;
}

export interface ArchivedTopicData {
  group: Group;
  tree: ConversationTreeNode[];
}
