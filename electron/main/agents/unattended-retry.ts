import { isQuotaErrorMessage } from './delegation-terminal.js';
import type { PiSessionTurnResult } from './pi-session/pi-session.js';
import { mainLogger } from './logger.js';
import {
  buildFailoverContinuePrompt,
  clearFailoverTried,
  findNextFailover,
  getFailoverTriedView,
} from './model-failover.js';

// ── 无人值守退避重试 ──────────────────────────────
// 链耗尽且无人值守开启时按 1m/5m/15m 退避重试续跑（重置 tried + 注入 continue，复用 failover 同机制）。
// 计数不因 failover 重新接管清零——重试后链再走完仍计入同一预算，防止「耗尽→重试→切链」循环永不放弃；
// 只有成功续跑（success）/ 用户停止 / 开关关闭才清零。

interface UnattendedRetryState {
  sessionId: string;
  attempts: number;
  timer: NodeJS.Timeout | null;
}

const unattendedRetries = new Map<string, UnattendedRetryState>();

let unattendedRetryBackoffMs = [60_000, 5 * 60_000, 15 * 60_000];

/** 测试注入用：缩短退避间隔验证重试编排，生产路径不调用 */
export function setUnattendedRetryBackoffForTest(ms: number[]): void {
  unattendedRetryBackoffMs = ms;
}

export function clearUnattendedRetry(conversationId: string): void {
  const state = unattendedRetries.get(conversationId);
  if (!state) return;
  if (state.timer) clearTimeout(state.timer);
  unattendedRetries.delete(conversationId);
}

export async function clearUnattendedRetryBySession(sessionId: string): Promise<void> {
  const { getPiSessionManager } = await import('./pi-session/pi-session-manager.js');
  const conversationId = getPiSessionManager().getConversationIdBySession(sessionId);
  if (conversationId) clearUnattendedRetry(conversationId);
}

/** 无人值守关闭时全量取消在途退避：清 timer + 释放保活 hold */
export function releaseAllUnattendedRetries(): void {
  if (unattendedRetries.size === 0) return;
  const sessionIds = new Set<string>();
  for (const [conversationId, state] of unattendedRetries) {
    if (state.timer) clearTimeout(state.timer);
    unattendedRetries.delete(conversationId);
    sessionIds.add(state.sessionId);
  }
  void (async () => {
    const { getPiSessionManager } = await import('./pi-session/pi-session-manager.js');
    const manager = getPiSessionManager();
    for (const sessionId of sessionIds) {
      await manager.releaseHold(sessionId).catch(() => {});
    }
  })();
}

async function notifyUnattendedGiveUp(workspaceId: string, conversationId: string, title?: string): Promise<void> {
  try {
    const { feishuNotifyOutlet } = await import('../services/feishu/feishu-notify-outlet.js');
    await feishuNotifyOutlet.pushDirect({
      conversationId,
      workspaceId,
      title: title || '会话',
      summary: '模型断联，自动重试 3 次均失败，会话已停止，请查看会话详情。',
    });
  } catch (err) {
    mainLogger.warn('[model-failover] 无人值守放弃推送失败:', err);
  }
}

async function runUnattendedRetry(conversationId: string, sessionId: string, attempts: number): Promise<void> {
  const state = unattendedRetries.get(conversationId);
  if (!state || state.sessionId !== sessionId) return;
  state.timer = null;

  const { getPiSessionManager } = await import('./pi-session/pi-session-manager.js');
  const manager = getPiSessionManager();
  try {
    const session = manager.getSession(sessionId);
    if (!session) {
      mainLogger.info(`[model-failover] 会话 ${conversationId} 重试到期时 session 已销毁，放弃重试`);
      clearUnattendedRetry(conversationId);
      return;
    }
    if (session.isRunning()) {
      mainLogger.info(`[model-failover] 会话 ${conversationId} 重试到期时已在运行（用户手动续上），跳过重试`);
      clearUnattendedRetry(conversationId);
      return;
    }

    const { loadSettings } = await import('../services/settings-service.js');
    const settings = await loadSettings();
    const conversationService = await import('../services/conversation-service.js');
    const lookup = await conversationService.getByIdGlobal(conversationId);
    if (!settings.ai.unattended || !settings.failover?.enabled || !lookup) {
      mainLogger.info(`[model-failover] 会话 ${conversationId} 重试到期时开关已关闭，放弃重试`);
      clearUnattendedRetry(conversationId);
      return;
    }

    const profiles = settings.profiles ?? {};
    const currentProfileId = lookup.conv.modelSelection?.profileId ?? '';
    const toLabel = profiles[currentProfileId]?.name ?? currentProfileId;
    clearFailoverTried(conversationId);
    mainLogger.info(`[model-failover] 会话 ${conversationId} 无人值守第 ${attempts} 次重试，注入续跑提示（当前模型 ${toLabel}）`);
    await session.sendMessage(buildFailoverContinuePrompt(toLabel), { injectionTag: 'failover' });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    mainLogger.warn(`[model-failover] 会话 ${conversationId} 无人值守重试失败: ${message}`);
    await maybeRetryUnattendedFailover(sessionId, { subtype: 'failed', error: { kind: 'runtime', message } });
  } finally {
    await manager.releaseHold(sessionId).catch(() => {});
  }
}

/**
 * 无人值守退避重试编排：failover 链耗尽时按退避间隔重试（acquireHold 保活防回收），到期重置
 * tried 并注入 continue 续跑；重试预算耗尽则放弃——维持报错终态并推飞书。
 * 返回 true 表示本次失败已被重试链路接管（调用方跳过失败系统通知）。
 */
export async function maybeRetryUnattendedFailover(sessionId: string, result: PiSessionTurnResult): Promise<boolean> {
  try {
    if (result.subtype !== 'failed') return false;
    if (!result.error?.message || !isQuotaErrorMessage(result.error.message)) return false;

    const { getPiSessionManager } = await import('./pi-session/pi-session-manager.js');
    const manager = getPiSessionManager();
    const conversationId = manager.getConversationIdBySession(sessionId);
    if (!conversationId) return false;

    const conversationService = await import('../services/conversation-service.js');
    const lookup = await conversationService.getByIdGlobal(conversationId);
    if (!lookup || lookup.conv.role !== 'main') return false;

    const { loadSettings } = await import('../services/settings-service.js');
    const settings = await loadSettings();
    if (!settings.ai.unattended) return false;
    if (!settings.failover?.enabled) return false;

    const currentProfileId = lookup.conv.modelSelection?.profileId ?? '';
    const tried = getFailoverTriedView(conversationId);
    if (findNextFailover(settings.failover.chain, currentProfileId, tried)) return false;
    const existing = unattendedRetries.get(conversationId);
    if (!existing && tried.size === 0) return false;

    const attempts = existing?.attempts ?? 0;
    if (attempts >= unattendedRetryBackoffMs.length) {
      clearUnattendedRetry(conversationId);
      mainLogger.warn(`[model-failover] 会话 ${conversationId} 无人值守重试 ${attempts} 次均失败，放弃并推送通知`);
      await notifyUnattendedGiveUp(lookup.workspaceId, conversationId, lookup.conv.title);
      return false;
    }

    if (existing?.timer) {
      clearTimeout(existing.timer);
      existing.timer = null;
    }
    if (!manager.acquireHold(sessionId)) return false;
    const delay = unattendedRetryBackoffMs[attempts];
    const timer = setTimeout(() => {
      void runUnattendedRetry(conversationId, sessionId, attempts + 1).catch((err) => {
        mainLogger.warn(`[model-failover] 会话 ${conversationId} 无人值守重试执行异常:`, err);
      });
    }, delay);
    timer.unref();
    unattendedRetries.set(conversationId, { sessionId, attempts: attempts + 1, timer });
    mainLogger.info(`[model-failover] 会话 ${conversationId} failover 链耗尽，无人值守第 ${attempts + 1} 次退避重试已安排（${Math.round(delay / 1000)}s 后）`);
    return true;
  } catch (err) {
    mainLogger.warn('[model-failover] 无人值守重试编排失败，回落报错链路:', err);
    return false;
  }
}
