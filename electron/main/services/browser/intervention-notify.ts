import { getRendererHandlers } from '@egoist/tipc/main';
import * as conversationService from '../conversation-service.js';
import { getSessionNotificationService } from '../session-notification-service.js';
import { getMainWindow } from '../../window-factories.js';
import { loadSettings } from '../settings-service.js';
import { mainLogger } from '../../agents/logger.js';
import type { RendererHandlers } from '../../tipc/renderer-handlers.js';
import type { HumanInterventionRequest } from './human-intervention.js';

const logger = mainLogger.child('intervention-notify');

/**
 * 新人工等待出现时的打扰三件套：提示音（intervention cue，前台也响）+ 系统通知（仅应用后台）+
 * 焦点跳转（interventionFocusJump 开关控制：定位独立会话窗口或主窗口并激活，渲染层滚动到卡片）。
 * 无 conversationId 的 raise（伴随面板横幅场景）不打扰。
 */
export async function handleInterventionRaised(request: HumanInterventionRequest): Promise<void> {
  const conversationId = request.conversationId;
  if (!conversationId) return;
  try {
    const service = getSessionNotificationService();
    const lookup = await conversationService.getByIdGlobal(conversationId).catch(() => null);
    if (!lookup) return;
    service.notify({
      kind: 'permission',
      notificationId: request.id,
      conversationId,
      workspaceId: lookup.workspaceId,
      title: lookup.conv.title || '会话',
      body: request.message,
    });
    service.playCue('intervention');
    await focusInterventionCard(request, conversationId, lookup.workspaceId);
  } catch (err) {
    logger.warn('人工等待打扰链路失败:', err);
  }
}

async function focusInterventionCard(
  request: HumanInterventionRequest,
  conversationId: string,
  workspaceId: string,
): Promise<void> {
  const settings = await loadSettings();
  if (settings.ui?.interventionFocusJump === false) return;
  const win = getSessionNotificationService().getSessionWindow(conversationId) ?? getMainWindow();
  if (!win || win.isDestroyed()) return;
  try {
    if (win.isMinimized()) win.restore();
    if (!win.isVisible()) win.show();
    win.focus();
    getRendererHandlers<RendererHandlers>(win.webContents).interventionFocus.send({
      conversationId,
      workspaceId,
      interventionRequestId: request.id,
    });
  } catch (err) {
    logger.warn('焦点跳转失败（不影响提示链路）:', err);
  }
}
