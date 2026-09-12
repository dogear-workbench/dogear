/**
 * 消息中心条目（镜像 electron/main/services/notification-center-service.ts）
 */
export type NotificationOwner =
  | { kind: 'system' }
  | { kind: 'conversation'; conversationId: string };

export interface NotificationCenterEntry {
  id: string;
  type: 'task' | 'conversation';
  dedupeKey: string;
  title: string;
  summary?: string;
  createdAt: string;
  read: boolean;
  count: number;
  owner: NotificationOwner;
  taskId?: string;
  workspaceId?: string;
  ownerLabel?: string;
}
