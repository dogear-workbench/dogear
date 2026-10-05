/**
 * 会话收尾自动清理：关闭扩展通道 Dogear 组内「agent 持有且未移交」的 tab，并释放通道独占。
 *
 * 挂载点在 PiSessionManager._destroySession（会话销毁唯一收口）；仅通道当前归属者触发
 * （多会话串行共用一组，非归属者不动组内 tab）；扩展断连或协议过旧时静默跳过。
 * 一键移交过的 tabId 在豁免集合内（page_handoff 帧上报，随 gateway 生命周期），保留不关。
 */

import { mainLogger } from '../../agents/logger.js';
import { getExtensionStatus, getHandoffExemptTabIds, sendExtensionCommand } from './browser-gateway.js';
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
    const exemptTabIds = getHandoffExemptTabIds();
    try {
      const result = await sendExtensionCommand(
        'close_group_tabs',
        exemptTabIds.length > 0 ? { exemptTabIds } : {},
        CLEANUP_COMMAND_TIMEOUT_MS,
      );
      const data = (result.data ?? {}) as { closedTabIds?: unknown };
      const closedTabIds = Array.isArray(data.closedTabIds)
        ? data.closedTabIds.filter((v): v is number => typeof v === 'number')
        : [];
      if (closedTabIds.length === 0) {
        logger.info(`会话收尾清理：组内无可清理标签页: conv=${conversationId}`);
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
