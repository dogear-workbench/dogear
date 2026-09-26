import fs from 'node:fs/promises';
import * as conversationService from './conversation-service.js';
import * as groupService from './group-service.js';
import { conversationRuntimeService } from './conversation-runtime-service.js';
import { getPiSessionRepository } from '../agents/pi-session/pi-session-repository.js';
import { deleteUsageStrict } from './usage/usage-service.js';
import { getGroupDir, getGroupsRootDir } from './memory/background-store.js';
import type { ConversationIndex } from './conversation-service.js';

export type TopicLifecycleResult =
  | { ok: true }
  | { ok: false; error: string };

function fail(error: unknown): TopicLifecycleResult {
  return { ok: false, error: error instanceof Error ? error.message : String(error) };
}

async function removeConversationArtifacts(
  workspaceId: string,
  conversation: ConversationIndex,
): Promise<void> {
  await conversationRuntimeService.closeConversation(conversation.id);
  if (conversation.sessionId) {
    await getPiSessionRepository().delete(workspaceId, conversation.sessionId);
  }
  await deleteUsageStrict(conversation.id);
}

async function deleteConversationInternal(
  workspaceId: string,
  conversationId: string,
  cleanupEmptyGroup: boolean,
): Promise<{ result: TopicLifecycleResult; deleted: boolean; groupId?: string }> {
  const conversation = await conversationService.getById(workspaceId, conversationId);
  if (!conversation) return { result: { ok: true }, deleted: false };

  try {
    await removeConversationArtifacts(workspaceId, conversation);
  } catch (error) {
    return { result: fail(error), deleted: false, groupId: conversation.groupId };
  }

  try {
    await conversationService.deleteConversation(workspaceId, conversationId);
  } catch (error) {
    return { result: fail(error), deleted: false, groupId: conversation.groupId };
  }

  if (cleanupEmptyGroup && conversation.groupId) {
    const cleanup = await cleanupEmptyTopic(workspaceId, conversation.groupId);
    if (!cleanup.ok) return { result: cleanup, deleted: true, groupId: conversation.groupId };
  }

  return { result: { ok: true }, deleted: true, groupId: conversation.groupId };
}

export async function deleteConversation(
  workspaceId: string,
  conversationId: string,
): Promise<TopicLifecycleResult> {
  const outcome = await deleteConversationInternal(workspaceId, conversationId, true);
  if (outcome.deleted || !outcome.result.ok) return outcome.result;
  return cleanupEmptyTopics(workspaceId);
}

export async function cleanupEmptyTopic(
  workspaceId: string,
  groupId: string,
): Promise<TopicLifecycleResult> {
  try {
    const conversations = await conversationService.getByWorkspaceId(workspaceId, { includeArchived: true });
    if (conversations.some((conversation) => conversation.groupId === groupId)) return { ok: true };

    await fs.rm(getGroupDir(workspaceId, groupId), { recursive: true, force: true });
    await groupService.deleteGroup(workspaceId, groupId);
    return { ok: true };
  } catch (error) {
    return fail(error);
  }
}

async function collectKnownGroupIds(workspaceId: string): Promise<Set<string>> {
  const [groups, conversations] = await Promise.all([
    groupService.listGroups(workspaceId),
    conversationService.getByWorkspaceId(workspaceId, { includeArchived: true }),
  ]);
  const groupIds = new Set<string>();
  for (const group of groups) groupIds.add(group.id);
  for (const conversation of conversations) {
    if (conversation.groupId) groupIds.add(conversation.groupId);
  }
  try {
    const entries = await fs.readdir(getGroupsRootDir(workspaceId), { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isDirectory()) groupIds.add(entry.name);
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
  return groupIds;
}

export async function cleanupEmptyTopics(workspaceId: string): Promise<TopicLifecycleResult> {
  try {
    const groupIds = await collectKnownGroupIds(workspaceId);
    for (const groupId of groupIds) {
      const result = await cleanupEmptyTopic(workspaceId, groupId);
      if (!result.ok) return result;
    }
    return { ok: true };
  } catch (error) {
    return fail(error);
  }
}

export async function deleteTopic(
  workspaceId: string,
  groupId: string,
): Promise<TopicLifecycleResult> {
  const conversations = await conversationService.getByWorkspaceId(workspaceId, { includeArchived: true });
  for (const conversation of conversations) {
    if (conversation.groupId !== groupId) continue;
    const outcome = await deleteConversationInternal(workspaceId, conversation.id, false);
    if (!outcome.result.ok) return outcome.result;
  }
  return cleanupEmptyTopic(workspaceId, groupId);
}

export interface BatchDeleteArchivedResult {
  deleted: string[];
  failed: Array<{ groupId: string; error: string }>;
}

export async function batchDeleteArchivedTopics(
  workspaceId: string,
  olderThanDays = 30,
): Promise<BatchDeleteArchivedResult> {
  const cutoff = Date.now() - olderThanDays * 86400_000;
  const groups = await groupService.listArchivedGroups(workspaceId);
  const result: BatchDeleteArchivedResult = { deleted: [], failed: [] };
  for (const group of groups) {
    if ((group.archivedAt ?? 0) >= cutoff) continue;
    const outcome = await deleteTopic(workspaceId, group.id);
    if (outcome.ok) result.deleted.push(group.id);
    else result.failed.push({ groupId: group.id, error: outcome.error });
  }
  return result;
}


