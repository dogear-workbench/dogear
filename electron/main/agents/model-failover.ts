/**
 * 模型故障转移：quota 类 turn 失败时沿全局 failover 链顺位切换供应商，
 * 销毁重建 session 后发续跑提示从断点继续。切换是会话级 modelSelection 变更（不自动切回），
 * 用户可在模型选择器手动改回。子会话只复用 findNextFailover 做链查找
 * （delegation-bridge decideResume），不经过 maybeFailoverMainSession 编排。
 */

import { isQuotaErrorMessage } from './delegation-terminal.js';
import { broadcastConversationListChanged } from '../services/renderer-broadcast.js';
import type { PiSessionTurnResult } from './pi-session/pi-session.js';
import type { FailoverEntry } from '../services/settings-types.js';
import type { RendererHandlers } from '../tipc/renderer-handlers.js';
import { mainLogger } from './logger.js';

const failoverTried = new Map<string, Set<string>>();
const settling = new Set<string>();

export function findNextFailover(
  chain: FailoverEntry[],
  currentProfileId: string,
  tried: ReadonlySet<string>,
): FailoverEntry | null {
  const start = chain.findIndex((entry) => entry.profileId === currentProfileId);
  const ordered = start >= 0 ? [...chain.slice(start + 1), ...chain.slice(0, start)] : chain;
  return ordered.find((entry) => entry.profileId !== currentProfileId && !tried.has(entry.profileId)) ?? null;
}

export const FAILOVER_CONTINUE_SENTINEL = '[system:failover-continue]';

export function buildFailoverContinuePrompt(toLabel: string): string {
  return `${FAILOVER_CONTINUE_SENTINEL}你因供应商费率限制中断，模型已切换为 ${toLabel}，请检查已完成部分，从中断处继续完成任务（不要重跑已完成的步骤，也不要重复已产生副作用的操作）。`;
}

export function clearFailoverTried(conversationId: string): void {
  failoverTried.delete(conversationId);
}

/** tried 只读视图：无人值守重试判定链耗尽用（Map 归本模块私有） */
export function getFailoverTriedView(conversationId: string): ReadonlySet<string> {
  return failoverTried.get(conversationId) ?? new Set<string>();
}

export async function clearFailoverTriedBySession(sessionId: string): Promise<void> {
  const { getPiSessionManager } = await import('./pi-session/pi-session-manager.js');
  const conversationId = getPiSessionManager().getConversationIdBySession(sessionId);
  if (conversationId) clearFailoverTried(conversationId);
}

async function broadcastFailoverNotice(conversationId: string, fromLabel: string, toLabel: string): Promise<void> {
  try {
    const electron = await import('electron');
    const { getRendererHandlers } = await import('@egoist/tipc/main');
    for (const win of electron.BrowserWindow.getAllWindows()) {
      if (win.isDestroyed()) continue;
      try {
        getRendererHandlers<RendererHandlers>(win.webContents).failoverNotice.send({
          conversationId,
          fromLabel,
          toLabel,
          at: Date.now(),
        });
      } catch { /* 窗口已销毁，忽略 */ }
    }
  } catch (err) {
    mainLogger.warn('[model-failover] failoverNotice 广播失败:', err);
  }
}

/**
 * 主会话 quota 失败的自动切换编排。返回 true 表示已切换并发出续跑提示；
 * false 表示不满足条件或链耗尽，调用方保持原有报错渲染。
 * 失败不抛异常（warn 后回落报错链路），fire-and-forget 续跑提示的失败
 * 由 PiSession 自身的 complete(failed) 事件或下方 catch 递归再次进入本函数。
 */
export async function maybeFailoverMainSession(sessionId: string, result: PiSessionTurnResult): Promise<boolean> {
  try {
    if (result.subtype !== 'failed') return false;
    if (!result.error?.message || !isQuotaErrorMessage(result.error.message)) return false;

    const { getPiSessionManager } = await import('./pi-session/pi-session-manager.js');
    const manager = getPiSessionManager();
    const conversationId = manager.getConversationIdBySession(sessionId);
    if (!conversationId) return false;
    if (settling.has(conversationId)) return false;

    const conversationService = await import('../services/conversation-service.js');
    const lookup = await conversationService.getByIdGlobal(conversationId);
    if (!lookup || lookup.conv.role !== 'main') return false;

    const { loadSettings } = await import('../services/settings-service.js');
    const settings = await loadSettings();
    if (!settings.failover?.enabled) return false;

    const currentProfileId = lookup.conv.modelSelection?.profileId ?? '';
    const tried = failoverTried.get(conversationId) ?? new Set<string>();
    const entry = findNextFailover(settings.failover.chain, currentProfileId, tried);
    if (!entry) return false;

    settling.add(conversationId);
    try {
      tried.add(currentProfileId);
      failoverTried.set(conversationId, tried);

      await conversationService.updateModelSelection(lookup.workspaceId, conversationId, {
        profileId: entry.profileId,
        tier: entry.tier,
      });
      broadcastConversationListChanged(lookup.workspaceId);

      const { conversationRuntimeService } = await import('../services/conversation-runtime-service.js');
      const { count, webContentsId } = conversationRuntimeService.detachByConversationHolder(conversationId, 'desktop', 'forced');
      if (count === 0) {
        mainLogger.warn(`[model-failover] 会话 ${conversationId} 无 desktop attachment，仅更新 modelSelection`);
      }
      const attachment = await conversationRuntimeService.attachConversation(
        conversationId,
        lookup.workspaceId,
        'desktop',
        webContentsId !== undefined ? { webContentsId } : undefined,
      );

      const session = manager.getSession(attachment.sessionId);
      if (!session) {
        throw new Error(`failover 重建 session 失败: ${attachment.sessionId}`);
      }

      const profiles = settings.profiles ?? {};
      const fromLabel = profiles[currentProfileId]?.name ?? currentProfileId;
      const toLabel = profiles[entry.profileId]?.name ?? entry.profileId;
      await broadcastFailoverNotice(conversationId, fromLabel, toLabel);
      mainLogger.info(`[model-failover] 会话 ${conversationId} ${fromLabel} 费率受限，已切换 ${toLabel} 续跑`);

      session.sendMessage(buildFailoverContinuePrompt(toLabel), { injectionTag: 'failover' }).catch((error: unknown) => {
        const message = error instanceof Error ? error.message : String(error);
        mainLogger.warn(`[model-failover] 会话 ${conversationId} 续跑提示发送失败: ${message}`);
        void maybeFailoverMainSession(attachment.sessionId, {
          subtype: 'failed',
          error: { kind: 'runtime', message },
        });
      });
      return true;
    } finally {
      settling.delete(conversationId);
    }
  } catch (err) {
    mainLogger.warn('[model-failover] 主会话 failover 编排失败，回落报错链路:', err);
    return false;
  }
}

