import fs from 'node:fs/promises';
import path from 'node:path';
import * as conversationService from './conversation-service.js';
import * as groupService from './group-service.js';
import * as workspaceService from './workspace-json-service.js';
import { conversationRuntimeService } from './conversation-runtime-service.js';
import { getPiSessionRepository } from '../agents/pi-session/pi-session-repository.js';
import { deleteUsageStrict } from './usage/usage-service.js';
import { getClaudeConfigDir, getSessionJsonlPath } from './memory/session-paths.js';
import { getGroupDir, getGroupsRootDir } from './memory/background-store.js';
import { safeJsonWrite } from './safe-json.js';
import type { ConversationIndex } from './conversation-service.js';

const TOPIC_LIFECYCLE_MIGRATION_VERSION = 1;
const TOPIC_LIFECYCLE_MIGRATION_FILE = 'topic-lifecycle-migration.json';

export type TopicLifecycleResult =
  | { ok: true }
  | { ok: false; error: string };

export interface TopicLifecycleMigrationResult {
  workspacesProcessed: number;
  workspacesSkipped: number;
  conversationsDeleted: number;
  errors: Array<{ workspaceId: string; error: string }>;
}

function fail(error: unknown): TopicLifecycleResult {
  return { ok: false, error: error instanceof Error ? error.message : String(error) };
}

function assertSafeSessionId(sessionId: string): void {
  if (!sessionId || sessionId.includes('..') || sessionId.includes('/') || sessionId.includes('\\')) {
    throw new Error(`不安全的会话 ID: ${sessionId}`);
  }
}

async function removeLegacyHistory(
  conversation: ConversationIndex,
  workspacePath: string | undefined,
): Promise<void> {
  const sessionIds = new Set([conversation.sessionId].filter((id): id is string => !!id));
  for (const sessionId of sessionIds) {
    assertSafeSessionId(sessionId);
    await fs.rm(path.join(getClaudeConfigDir(), `${sessionId}.jsonl`), { force: true });
    if (!workspacePath) continue;
    const sessionPath = getSessionJsonlPath(workspacePath, sessionId);
    await fs.rm(sessionPath, { force: true });
    await fs.rm(path.join(path.dirname(sessionPath), sessionId), { recursive: true, force: true });
  }
}

async function removeConversationArtifacts(
  workspaceId: string,
  conversation: ConversationIndex,
  workspacePath: string | undefined,
): Promise<void> {
  await conversationRuntimeService.closeConversation(conversation.id);
  if (conversation.sessionId) {
    await getPiSessionRepository().delete(workspaceId, conversation.sessionId);
  }
  await removeLegacyHistory(conversation, workspacePath);
  await deleteUsageStrict(conversation.id);
}

async function getWorkspacePath(workspaceId: string): Promise<string | undefined> {
  return (await workspaceService.getById(workspaceId))?.path;
}

async function deleteConversationInternal(
  workspaceId: string,
  conversationId: string,
  cleanupEmptyGroup: boolean,
  workspacePath?: string,
): Promise<{ result: TopicLifecycleResult; deleted: boolean; groupId?: string }> {
  const conversation = await conversationService.getById(workspaceId, conversationId);
  if (!conversation) return { result: { ok: true }, deleted: false };

  try {
    await removeConversationArtifacts(workspaceId, conversation, workspacePath ?? await getWorkspacePath(workspaceId));
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
  const workspacePath = await getWorkspacePath(workspaceId);
  const conversations = await conversationService.getByWorkspaceId(workspaceId, { includeArchived: true });
  for (const conversation of conversations) {
    if (conversation.groupId !== groupId) continue;
    const outcome = await deleteConversationInternal(workspaceId, conversation.id, false, workspacePath);
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

function getMigrationPath(workspaceId: string): string {
  return path.join(conversationService.getWorkspaceDataDir(workspaceId), TOPIC_LIFECYCLE_MIGRATION_FILE);
}

async function isMigrationComplete(workspaceId: string): Promise<boolean> {
  try {
    const raw = await fs.readFile(getMigrationPath(workspaceId), 'utf-8');
    const state = JSON.parse(raw) as { version?: unknown };
    return state.version === TOPIC_LIFECYCLE_MIGRATION_VERSION;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
    throw error;
  }
}

async function markMigrationComplete(workspaceId: string): Promise<void> {
  await safeJsonWrite(getMigrationPath(workspaceId), {
    version: TOPIC_LIFECYCLE_MIGRATION_VERSION,
    completedAt: Date.now(),
  });
}

export async function runTopicLifecycleMigration(): Promise<TopicLifecycleMigrationResult> {
  const result: TopicLifecycleMigrationResult = {
    workspacesProcessed: 0,
    workspacesSkipped: 0,
    conversationsDeleted: 0,
    errors: [],
  };
  const workspaces = await workspaceService.getAll();

  for (const workspace of workspaces) {
    try {
      if (await isMigrationComplete(workspace.id)) {
        result.workspacesSkipped++;
        continue;
      }

      const conversations = await conversationService.getByWorkspaceId(workspace.id, { includeArchived: true });
      for (const conversation of conversations) {
        if (conversation.archivedAt === undefined) continue;
        const outcome = await deleteConversationInternal(workspace.id, conversation.id, false, workspace.path);
        if (!outcome.result.ok) throw new Error(outcome.result.error);
        if (outcome.deleted) result.conversationsDeleted++;
      }

      const cleanup = await cleanupEmptyTopics(workspace.id);
      if (!cleanup.ok) throw new Error(cleanup.error);
      await markMigrationComplete(workspace.id);
      result.workspacesProcessed++;
    } catch (error) {
      result.errors.push({
        workspaceId: workspace.id,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return result;
}
