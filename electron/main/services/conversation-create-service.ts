import * as conversationService from './conversation-service.js';
import * as groupService from './group-service.js';
import { loadSettings } from './settings-service.js';
import type { Group } from '../types.js';

export async function getOrCreateGroupByName(workspaceId: string, title: string): Promise<Group> {
  const existing = await groupService.getGroupByTitle(workspaceId, title);
  if (existing) return existing;
  return groupService.createGroup(workspaceId, { title });
}

export async function createConversationWithDefaults(
  workspaceId: string,
  init?: { title?: string; groupId?: string },
): Promise<{ groupId: string; conversationId: string }> {
  const settings = await loadSettings();
  const title = init?.title || '新对话';
  const groupId = init?.groupId ?? (await groupService.createGroup(workspaceId, { title })).id;
  const conversationId = await conversationService.create(
    workspaceId,
    groupId,
    title,
    settings.ai.defaultModelSelection,
    { userInitiated: true },
  );
  return { groupId, conversationId };
}
