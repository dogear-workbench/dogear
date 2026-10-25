/**
 * 执行会话承载组迁移（一次性索引迁移，幂等）：会话物理文件零移动，只改 conversations.json 的 groupId。
 *
 * - 存量 executor 会话（executor===true 且 schedulerTaskId==null，即任务队列执行会话）及
 *   其 agent 派出链迁挂 hidden「任务」承载组；定时运行会话（schedulerTaskId 非空）不迁
 * - 子会话判定与 buildConversationTree 同口径：contractMetadata.createdBy==='agent' 且
 *   parentSessionId 指向已收集会话的 sessionId；缺 contractMetadata 的老数据视为无父普通会话（不迁）
 * - 派出链按 sessionId 传递闭包整体迁组（含孙层），保证「任务」组内会话树完整
 * - hidden「任务运行」承载组更名「定时」（组 id 不变、组内会话零移动）
 */

import fs from 'fs/promises';
import path from 'path';
import * as conversationService from './conversation-service.js';
import * as groupService from './group-service.js';
import { broadcastConversationListChanged } from './renderer-broadcast-lazy.js';
import { mainLogger, getConfigDir } from '../agents/logger.js';

const logger = mainLogger.child('ExecutorSessionMigrator');

const TASK_CARRIER_TITLE = '任务';
const SCHEDULER_CARRIER_TITLE = '定时';
const LEGACY_SCHEDULER_TITLE = '任务运行';

async function renameLegacySchedulerGroup(workspaceId: string): Promise<void> {
  const groups = await groupService.listGroups(workspaceId);
  const legacy = groups.find((group) => group.hidden === true && group.title === LEGACY_SCHEDULER_TITLE);
  if (!legacy) return;
  await groupService.updateGroup(workspaceId, legacy.id, { title: SCHEDULER_CARRIER_TITLE });
  logger.info(
    `工作区 ${workspaceId} 定时承载组更名「${LEGACY_SCHEDULER_TITLE}」→「${SCHEDULER_CARRIER_TITLE}」（${legacy.id}，组内会话零移动）`,
  );
}

/** 迁移集 = executor 会话 + agent 派出链传递闭包；返回待迁 conversation id 列表 */
function collectMigratableIds(conversations: conversationService.ConversationIndex[]): string[] {
  const migratedIds = new Set<string>();
  const carrierSessionIds = new Set<string>();
  for (const conv of conversations) {
    if (conv.executor !== true || conv.schedulerTaskId !== undefined) continue;
    migratedIds.add(conv.id);
    if (conv.sessionId) carrierSessionIds.add(conv.sessionId);
  }
  let grew = true;
  while (grew) {
    grew = false;
    for (const conv of conversations) {
      if (migratedIds.has(conv.id)) continue;
      const meta = conv.contractMetadata;
      if (meta?.createdBy !== 'agent' || !carrierSessionIds.has(meta.parentSessionId)) continue;
      migratedIds.add(conv.id);
      if (conv.sessionId) carrierSessionIds.add(conv.sessionId);
      grew = true;
    }
  }
  return [...migratedIds];
}

async function migrateWorkspace(workspaceId: string): Promise<void> {
  await renameLegacySchedulerGroup(workspaceId);

  const conversations = await conversationService.getByWorkspaceId(workspaceId, { includeArchived: true });
  const migratedIds = collectMigratableIds(conversations);
  if (migratedIds.length === 0) return;

  const carrierGroup = await groupService.getOrCreateHiddenGroup(workspaceId, TASK_CARRIER_TITLE);
  const byId = new Map(conversations.map((conv) => [conv.id, conv]));
  const toMove = migratedIds
    .map((id) => byId.get(id))
    .filter((conv): conv is conversationService.ConversationIndex =>
      !!conv && conv.groupId !== carrierGroup.id);
  if (toMove.length === 0) return;

  const movedIds = new Set(toMove.map((conv) => conv.id));
  await conversationService.withConversationsTxn(workspaceId, async (file) => {
    for (const id of movedIds) {
      const conv = file.conversations[id];
      if (!conv) continue;
      conv.groupId = carrierGroup.id;
    }
  });
  broadcastConversationListChanged(workspaceId);
  logger.info(`工作区 ${workspaceId} 迁移 ${toMove.length} 个执行会话及派出链到「${TASK_CARRIER_TITLE}」承载组（${carrierGroup.id}）`);
}

export async function migrateExecutorSessionsAcrossWorkspaces(): Promise<void> {
  const workspacesDir = path.join(getConfigDir(), 'workspaces');
  let entries: string[];
  try {
    entries = (await fs.readdir(workspacesDir, { withFileTypes: true }))
      .filter((e) => e.isDirectory())
      .map((e) => e.name);
  } catch {
    return;
  }
  for (const workspaceId of entries) {
    try {
      await migrateWorkspace(workspaceId);
    } catch (err) {
      logger.error(`工作区 ${workspaceId} 执行会话迁移失败:`, err);
    }
  }
}
