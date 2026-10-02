import { mainLogger } from '../../agents/logger.js';
import { getPiSessionManager } from '../../agents/pi-session/pi-session-manager.js';
import type { PiSession } from '../../agents/pi-session/pi-session.js';
import type { PageHandoffMessage } from './nm-protocol.js';
import * as conversationService from '../conversation-service.js';
import { getNotificationCenterService } from '../notification-center-service.js';

const log = mainLogger.child('extension-handoff');

interface HandoffTarget {
  conversationId: string;
  title: string;
  workspaceId: string;
  session: PiSession;
}

/** 路由拍板「最近活跃会话直达」：存活 pi 会话（sendMessage 需内存 session）中 updatedAt 最新者 */
async function latestAliveConversation(): Promise<HandoffTarget | null> {
  const manager = getPiSessionManager();
  const candidates: Array<HandoffTarget & { updatedAt: number }> = [];
  for (const conversationId of manager.getAliveConversationIds()) {
    const sessionId = manager.getSessionIdByConversation(conversationId);
    const session = sessionId ? manager.getSession(sessionId) : undefined;
    if (!session) continue;
    const found = await conversationService.getByIdGlobal(conversationId);
    if (!found) continue;
    candidates.push({
      conversationId,
      title: found.conv.title,
      workspaceId: found.workspaceId,
      session,
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

function buildHandoffText(handoff: PageHandoffMessage): string {
  const lines = [
    '来自浏览器一键移交：',
    `标题：${handoff.title || '(无标题)'}`,
    `URL：${handoff.url}`,
  ];
  if (handoff.selectionText) lines.push(`选中内容：\n${handoff.selectionText}`);
  if (handoff.textExcerpt) lines.push(`正文快照：\n${handoff.textExcerpt}`);
  return lines.join('\n');
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
  await target.session.sendMessage(buildHandoffText(handoff));
  await notifications.add({
    type: 'conversation',
    dedupeKey: `handoff:${target.conversationId}`,
    title: `已发送到会话 ${target.title}`,
    summary: handoffSummary(handoff),
    owner: { kind: 'conversation', conversationId: target.conversationId },
    workspaceId: target.workspaceId,
    ownerLabel: target.title,
  });
  log.info('移交已注入会话', target.conversationId, handoff.url);
}
