import { mainLogger } from '../../agents/logger.js';
import { getPiSessionManager } from '../../agents/pi-session/pi-session-manager.js';
import type { PageHandoffMessage } from './nm-protocol.js';
import * as conversationService from '../conversation-service.js';
import { getNotificationCenterService } from '../notification-center-service.js';

const log = mainLogger.child('extension-handoff');

/** 广播给渲染层挂草稿的 payload（handoff 帧字段 + 目标会话） */
export interface HandoffDraftBroadcast {
  conversationId: string;
  url: string;
  title: string;
  selectionText?: string;
  textExcerpt?: string;
}

type HandoffDraftBroadcaster = (payload: HandoffDraftBroadcast) => void;

let handoffDraftBroadcaster: HandoffDraftBroadcaster | null = null;

export function setHandoffDraftBroadcaster(fn: HandoffDraftBroadcaster | null): void {
  handoffDraftBroadcaster = fn;
}

interface HandoffTarget {
  conversationId: string;
  title: string;
  workspaceId: string;
}

/** 路由拍板「最近活跃会话直达」：存活 pi 会话（需内存 session 在册）中 updatedAt 最新者 */
async function latestAliveConversation(): Promise<HandoffTarget | null> {
  const manager = getPiSessionManager();
  const candidates: Array<HandoffTarget & { updatedAt: number }> = [];
  for (const conversationId of manager.getAliveConversationIds()) {
    const sessionId = manager.getSessionIdByConversation(conversationId);
    if (!sessionId || !manager.getSession(sessionId)) continue;
    const found = await conversationService.getByIdGlobal(conversationId);
    if (!found) continue;
    candidates.push({
      conversationId,
      title: found.conv.title,
      workspaceId: found.workspaceId,
      updatedAt: Date.parse(found.conv.updatedAt),
    });
  }
  if (candidates.length === 0) return null;
  candidates.sort((a, b) => b.updatedAt - a.updatedAt);
  return candidates[0];
}

function handoffSummary(handoff: PageHandoffMessage): string {
  return handoff.title ? `${handoff.title}（${handoff.url}）` : handoff.url;
}

export async function routeBrowserHandoff(handoff: PageHandoffMessage): Promise<void> {
  const notifications = getNotificationCenterService();
  const target = await latestAliveConversation();
  if (!target) {
    await notifications.add({
      type: 'task',
      dedupeKey: 'handoff:no-session',
      title: 'Dogear 未找到可接收的会话',
      summary: handoffSummary(handoff),
      owner: { kind: 'system' },
      ownerLabel: '浏览器移交',
    });
    log.info('移交丢弃：无存活会话', handoff.url);
    return;
  }
  if (!handoffDraftBroadcaster) {
    log.warn('移交丢弃：渲染层草稿广播未接线', handoff.url);
    return;
  }
  handoffDraftBroadcaster({
    conversationId: target.conversationId,
    url: handoff.url,
    title: handoff.title,
    ...(handoff.selectionText ? { selectionText: handoff.selectionText } : {}),
    ...(handoff.textExcerpt ? { textExcerpt: handoff.textExcerpt } : {}),
  });
  await notifications.add({
    type: 'conversation',
    dedupeKey: `handoff:${target.conversationId}`,
    title: `浏览器移交待编辑：${handoff.title || handoff.url}`,
    summary: handoffSummary(handoff),
    owner: { kind: 'conversation', conversationId: target.conversationId },
    workspaceId: target.workspaceId,
    ownerLabel: target.title,
  });
  log.info('移交已挂起草稿待编辑', target.conversationId, handoff.url);
}
