import type { Group } from '@/types/group';
import type { ConversationTreeNode } from '@/lib/conversation-sort';

/** 归档页选中态：话题 + 话题内主会话（Step 3 右侧 digest 视图以此为键） */
export interface ArchiveSelection {
  topicId: string;
  conversationId: string;
}

export type ArchiveSegment = 'topics' | 'trash';

export interface ArchivedTopicData {
  group: Group;
  tree: ConversationTreeNode[];
}

export interface DigestTurn {
  input: string;
  inputAt: number;
  conclusion: string | null;
  concludedAt: number | null;
}

export interface DigestSession {
  conversationId: string;
  title: string;
  turns: DigestTurn[];
}

export interface TopicDigest {
  version: 1;
  archivedAt: number;
  sessions: DigestSession[];
}
