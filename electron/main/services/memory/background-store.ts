// 话题状态卡存储（background.md，条目化 schema）
// 纯数据/合并逻辑在 state-card.ts；本文件负责 IO + 旧 GroupBackground 接口兼容出口
import fs from 'node:fs/promises';
import path from 'node:path';
import * as conversationService from '../conversation-service.js';
import * as groupService from '../group-service.js';
import { getPiSessionRepository } from '../../agents/pi-session/pi-session-repository.js';
import { broadcastGroupDataChanged } from '../renderer-broadcast-lazy.js';
import { getGroupDir, mergeSourcesSeen, type GroupDigestSourceSeen } from './group-digest-store.js';
import {
  appendPlainEntries,
  appendTopicVersion,
  confirmPendingTopicChange,
  convertLegacyBackground,
  emptyTopicStateCard,
  makeEntry,
  makeVersion,
  mergeIncrement,
  parseTopicStateCard,
  rejectPendingTopicChange,
  serializeTopicStateCard,
  type LegacyBackground,
  type StateIncrement,
  type TopicCardCategory,
  type TopicStateCard,
} from './state-card.js';

// ─── 路径 ───

export function getBackgroundPath(wsId: string, groupId: string): string {
  return path.join(getGroupDir(wsId, groupId), 'background.md');
}

// ─── 状态卡读写 ───

export async function readTopicStateCard(wsId: string, groupId: string): Promise<TopicStateCard | null> {
  try {
    const raw = await fs.readFile(getBackgroundPath(wsId, groupId), 'utf-8');
    return parseTopicStateCard(raw);
  } catch (err: any) {
    if (err?.code === 'ENOENT') return null;
    throw err;
  }
}

export async function saveTopicStateCard(wsId: string, card: TopicStateCard): Promise<void> {
  await fs.mkdir(getGroupDir(wsId, card.groupId), { recursive: true });
  await fs.writeFile(getBackgroundPath(wsId, card.groupId), serializeTopicStateCard(card), 'utf-8');
  broadcastGroupDataChanged(wsId, card.groupId);
}

/** 增量合并 + 落盘：mergeIncrement 纯合并，sourcesSeen 由调用方用 mergeSourcesSeen 先并入 card */
export async function mergeIncrementAndSave(
  wsId: string,
  groupId: string,
  increment: StateIncrement,
  opts: { conversationId: string; dirtySources?: Array<{ conversationId: string; sessionId: string; mtime: number }> },
): Promise<TopicStateCard> {
  const existing = await readTopicStateCard(wsId, groupId);
  const card = existing ?? emptyTopicStateCard(groupId);
  if (opts.dirtySources?.length) {
    card.sourcesSeen = mergeSourcesSeen(card.sourcesSeen, opts.dirtySources);
  }
  const merged = mergeIncrement(card, increment, { conversationId: opts.conversationId });
  await saveTopicStateCard(wsId, merged);
  return merged;
}

// ─── 用户 / 管理入口 ───

export async function appendUserEntry(
  wsId: string,
  groupId: string,
  category: TopicCardCategory,
  text: string,
): Promise<TopicStateCard> {
  if (!text.trim()) throw new Error('条目文本不能为空');
  const existing = await readTopicStateCard(wsId, groupId);
  const card = existing ?? emptyTopicStateCard(groupId);
  const now = new Date().toISOString();
  card.entries[category].push(makeEntry(text, 'user', now));
  card.updatedAt = now;
  await saveTopicStateCard(wsId, card);
  return card;
}

/** 从 pendingTopicChanges 确认/拒绝一条（Step 4 TopicPanel 用）；index 越界返回 null */
export async function resolvePendingTopicChange(
  wsId: string,
  groupId: string,
  index: number,
  accept: boolean,
): Promise<TopicStateCard | null> {
  const card = await readTopicStateCard(wsId, groupId);
  if (!card) return null;
  const next = accept ? confirmPendingTopicChange(card, index) : rejectPendingTopicChange(card, index);
  if (!next) return null;
  next.updatedAt = new Date().toISOString();
  await saveTopicStateCard(wsId, next);
  return next;
}

// ─── staleness ───

export interface StaleConversation {
  conversationId: string;
  sessionId: string;
  mtime: number;
}

/** 状态卡 sourcesSeen 落后的组内 main 会话（新会话 / mtime 前进）；无卡时全量返回 */
export async function getStaleConversations(wsId: string, groupId: string): Promise<StaleConversation[]> {
  const group = await groupService.getGroup(wsId, groupId);
  if (!group || group.archivedAt !== undefined) return [];

  const allConvs = await conversationService.getByWorkspaceId(wsId);
  const mainConvs = allConvs.filter((c) => c.groupId === groupId && c.role !== 'sub' && c.sessionId);

  const current: StaleConversation[] = [];
  for (const conv of mainConvs) {
    try {
      const sessionPath = await getPiSessionRepository().getSessionPath(wsId, conv.sessionId!);
      const stat = await fs.stat(sessionPath);
      current.push({ conversationId: conv.id, sessionId: conv.sessionId!, mtime: stat.mtimeMs });
    } catch {
      continue;
    }
  }

  const card = await readTopicStateCard(wsId, groupId);
  if (!card) return current;
  const seenMap = new Map(card.sourcesSeen.map((s) => [s.sessionId, s.mtime]));
  return current.filter((c) => {
    const seen = seenMap.get(c.sessionId);
    return seen === undefined || c.mtime > seen;
  });
}

// ─── 旧 GroupBackground 接口兼容出口（reference-tools / tipc/group / group-digest-tools 仍依赖）───

export interface GroupBackground {
  groupId: string;
  updatedAt: string;
  topic: string;
  progress: string;
  keyDecisions: string[];
  openQuestions: string[];
}

function toLegacyView(card: TopicStateCard): GroupBackground {
  return {
    groupId: card.groupId,
    updatedAt: card.updatedAt,
    topic: card.topicHistory[card.topicHistory.length - 1]?.text ?? '',
    progress: card.entries.inProgress.map((e) => e.text).join('\n'),
    keyDecisions: card.entries.decisions.map((e) => e.text),
    openQuestions: card.entries.openQuestions.map((e) => e.text),
  };
}

export async function readGroupBackground(wsId: string, groupId: string): Promise<GroupBackground | null> {
  const card = await readTopicStateCard(wsId, groupId);
  if (!card) return null;
  return toLegacyView(card);
}

/**
 * 旧 4 字段整卡写入语义的兼容实现：内部转增量式合并进现有状态卡
 * （条目 source 标 legacy——无 uuid 可追溯；topic 与末位同文本不重复进版本链）
 */
export async function saveGroupBackground(wsId: string, bg: GroupBackground): Promise<void> {
  const existing = await readTopicStateCard(wsId, bg.groupId);
  const card = existing ?? emptyTopicStateCard(bg.groupId);
  const now = new Date().toISOString();
  appendTopicVersion(card, makeVersion(bg.topic, 'legacy', now));
  appendPlainEntries(card, 'inProgress', [bg.progress], 'legacy', now);
  appendPlainEntries(card, 'decisions', bg.keyDecisions, 'legacy', now);
  appendPlainEntries(card, 'openQuestions', bg.openQuestions, 'legacy', now);
  card.updatedAt = now;
  await saveTopicStateCard(wsId, card);
}

/** 旧格式结构化对象 → 状态卡（一次性迁移工具，常规迁移走 parseTopicStateCard 自动路径） */
export function legacyBackgroundToCard(bg: LegacyBackground): TopicStateCard {
  return convertLegacyBackground(bg);
}
