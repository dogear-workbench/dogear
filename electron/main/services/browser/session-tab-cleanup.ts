/**
 * 会话收尾自动清理：直接关闭 agent 专属窗口（窗口内全部 tab 连带关闭），并释放通道独占。
 *
 * 挂载点在 PiSessionManager._destroySession（会话销毁唯一收口）；仅通道当前归属者触发
 * （多会话串行共用一通道，非归属者不动窗口）；扩展断连或协议过旧时静默跳过。
 * 用户移交的 tab 留在用户窗口原地，不在 agent 窗口内，天然不受影响。
 */

import { mainLogger } from '../../agents/logger.js';
import { getExtensionStatus, sendExtensionCommand } from './browser-gateway.js';
import { getChannelOwner, releaseChannel } from './extension-ownership.js';
import { recordBrowserAction } from './browser-action-stream.js';

const CLEANUP_COMMAND_TIMEOUT_MS = 5000;

const logger = mainLogger.child('session-tab-cleanup');

export function cleanupSessionTabs(conversationId: string): void {
  void (async () => {
    const status = getExtensionStatus();
    if (status.status !== 'connected') {
      logger.info(`会话收尾清理跳过（扩展未连接）: conv=${conversationId}`);
      return;
    }
    if (getChannelOwner() !== conversationId) {
      logger.info(`会话收尾清理跳过（非扩展通道归属者）: conv=${conversationId}`);
      return;
    }
    try {
      const result = await sendExtensionCommand('close_agent_window', {}, CLEANUP_COMMAND_TIMEOUT_MS);
      const data = (result.data ?? {}) as { closedTabIds?: unknown };
      const closedTabIds = Array.isArray(data.closedTabIds)
        ? data.closedTabIds.filter((v): v is number => typeof v === 'number')
        : [];
      if (closedTabIds.length === 0) {
        logger.info(`会话收尾清理：agent 窗口为空，无标签页可清理: conv=${conversationId}`);
        return;
      }
      logger.info(`会话收尾清理 ${closedTabIds.length} 个标签页: conv=${conversationId}`);
      recordBrowserAction({
        source: 'extension',
        taskMeta: { kind: 'agent', conversationId },
        action: 'cleanup',
        detail: `收尾清理 ${closedTabIds.length} 个标签页`,
        result: 'closed',
      });
    } finally {
      // 会话已销毁，清理成败都释放独占：残留 ownership 只会让后来者空等 10 分钟空闲过期
      releaseChannel(conversationId);
      logger.info(`会话收尾释放扩展通道独占: conv=${conversationId}`);
    }
  })().catch((err: unknown) => {
    const e = (err ?? null) as { errorCode?: unknown } | null;
    const errorCode = typeof e?.errorCode === 'string' ? e.errorCode : '';
    if (errorCode === 'not_connected' || errorCode === 'disconnected') {
      logger.info(`会话收尾清理跳过（扩展连接已断开）: conv=${conversationId}`);
      return;
    }
    logger.warn(`会话收尾清理失败（已忽略）: conv=${conversationId} errorCode=${errorCode || 'unknown'}`);
  });
}
