// 组级脏检查：判断组内 main 会话是否有更新（Phase 3 Step 1）
import fs from 'node:fs/promises';
import * as conversationService from '../conversation-service.js';
import * as workspaceService from '../workspace-json-service.js';
import * as groupService from '../group-service.js';
import { getPiSessionRepository } from '../../agents/pi-session/pi-session-repository.js';
import { readGroupDigest, type GroupDigestCard } from './group-digest-store.js';

export interface DirtyGroupConversation {
  conversationId: string;
  sessionId: string;
  mtime: number;
}

export interface DirtyGroup {
  workspaceId: string;
  workspacePath: string;
  groupId: string;
  dirtyConversations: DirtyGroupConversation[];
  hasExistingCard: boolean;
}

/**
 * 纯函数：当前 main 会话与 sourcesSeen 不一致即 dirty
 * - 无 groupCard → dirty
 * - currentMainConvs 有 sessionId 不在 sourcesSeen → dirty（新会话加入）
 * - currentMainConvs 中任一 mtime > sourcesSeen 对应 mtime → dirty（有新消息）
 * - sourcesSeen 中 sessionId 不在 currentMainConvs → dirty（会话被删除/移出组）
 */
export function isGroupDirty(
  card: GroupDigestCard | null,
  currentMainConvs: Array<{ sessionId: string; mtime: number }>,
): boolean {
  if (!card) return true;
  const seenMap = new Map(card.sourcesSeen.map((s) => [s.sessionId, s.mtime]));
  const currentIds = new Set(currentMainConvs.map((c) => c.sessionId));

  // 有 sourcesSeen 里的 sessionId 已不在当前集合（被删除/移出组）
  for (const s of card.sourcesSeen) {
    if (!currentIds.has(s.sessionId)) return true;
  }

  // 有新会话或 mtime 变化
  for (const c of currentMainConvs) {
    const seenMtime = seenMap.get(c.sessionId);
    if (seenMtime === undefined) return true;       // 新会话加入
    if (c.mtime > seenMtime) return true;           // 有新消息
  }

  return false;
}

/**
 * 返回 mtime 变化的 + 新加入的 dirty 会话。
 * 无 groupCard → 返回所有 currentMainConvs（全量 dirty）。
 * 删除场景（sourcesSeen 中没了的）由 isGroupDirty 处理，此函数不返回它们，
 * 但 agent 拿到已有组卡后会看到 sourcesSeen 里有多余条目，自然重整合。
 */
export function findDirtyConversationsInGroup(
  card: GroupDigestCard | null,
  currentMainConvs: Array<{ conversationId: string; sessionId: string; mtime: number }>,
): DirtyGroupConversation[] {
  if (!card) return currentMainConvs.map((c) => ({ ...c }));

  const seenMap = new Map(card.sourcesSeen.map((s) => [s.sessionId, s.mtime]));
  return currentMainConvs.filter((c) => {
    const seenMtime = seenMap.get(c.sessionId);
    return seenMtime === undefined || c.mtime > seenMtime;
  }).map((c) => ({ ...c }));
}

/** 扫描单个工作区，返回所有 dirty 的组 */
export async function findDirtyGroups(wsId: string, wsPath: string): Promise<DirtyGroup[]> {
  const groups = await groupService.listGroups(wsId);
  const allConvs = await conversationService.getByWorkspaceId(wsId);
  const result: DirtyGroup[] = [];

  for (const group of groups) {
    // 只看 main 会话（排除 sub），且必须有 sdkSessionId
    const mainConvs = allConvs.filter(
      (c) => c.groupId === group.id && c.role !== 'sub' && c.sdkSessionId,
    );
    if (mainConvs.length === 0) continue;

    // stat 每个 Harness session 文件，stat 失败则跳过该会话
    const currentMainConvs: Array<{ conversationId: string; sessionId: string; mtime: number }> = [];
    for (const conv of mainConvs) {
      try {
        const sessionPath = await getPiSessionRepository().getSessionPath(wsId, conv.sdkSessionId!);
        const stat = await fs.stat(sessionPath);
        currentMainConvs.push({
          conversationId: conv.id,
          sessionId: conv.sdkSessionId!,
          mtime: stat.mtimeMs,
        });
      } catch {
        // session 不存在或无法访问，跳过该会话
      }
    }
    if (currentMainConvs.length === 0) continue;

    const card = await readGroupDigest(wsId, group.id);
    const seenOnly = currentMainConvs.map((c) => ({ sessionId: c.sessionId, mtime: c.mtime }));

    if (!isGroupDirty(card, seenOnly)) continue;

    result.push({
      workspaceId: wsId,
      workspacePath: wsPath,
      groupId: group.id,
      dirtyConversations: findDirtyConversationsInGroup(card, currentMainConvs),
      hasExistingCard: card !== null,
    });
  }

  return result;
}

/**
 * 单 group 脏检查（仅给该 group 算 dirty）。triggerByConversation/triggerByGroup 用。
 * force=true 跳过脏判定并返回全量 main 会话——手动「重新提炼」是明知不脏也要重看一遍。
 */
export async function findDirtyGroup(
  wsId: string, wsPath: string, groupId: string, force = false,
): Promise<DirtyGroup | null> {
  const allConvs = await conversationService.getByWorkspaceId(wsId);
  const mainConvs = allConvs.filter(
    (c) => c.groupId === groupId && c.role !== 'sub' && c.sdkSessionId,
  );
  if (mainConvs.length === 0) return null;

  const currentMainConvs: Array<{ conversationId: string; sessionId: string; mtime: number }> = [];
  for (const conv of mainConvs) {
    try {
      const sessionPath = await getPiSessionRepository().getSessionPath(wsId, conv.sdkSessionId!);
      const stat = await fs.stat(sessionPath);
      currentMainConvs.push({
        conversationId: conv.id,
        sessionId: conv.sdkSessionId!,
        mtime: stat.mtimeMs,
      });
    } catch {
      // session 不存在，跳过
    }
  }
  if (currentMainConvs.length === 0) return null;

  const card = await readGroupDigest(wsId, groupId);
  if (!force) {
    const seenOnly = currentMainConvs.map((c) => ({ sessionId: c.sessionId, mtime: c.mtime }));
    if (!isGroupDirty(card, seenOnly)) return null;
  }

  return {
    workspaceId: wsId,
    workspacePath: wsPath,
    groupId,
    dirtyConversations: force
      ? currentMainConvs.map((c) => ({ ...c }))
      : findDirtyConversationsInGroup(card, currentMainConvs),
    hasExistingCard: card !== null,
  };
}

/** 遍历所有工作区做脏检查 */
export async function scanAllWorkspaces(): Promise<DirtyGroup[]> {
  const all = await workspaceService.getAll();
  const out: DirtyGroup[] = [];
  for (const ws of all) {
    out.push(...await findDirtyGroups(ws.id, ws.path));
  }
  return out;
}
