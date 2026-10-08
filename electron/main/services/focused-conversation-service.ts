/**
 * 全局焦点会话状态（「最近一次被激活的会话」语义，跨窗口共享）
 * 主窗口切 tab / 独立会话窗口激活会话时经 tipc 上报；主进程内存态，值变化广播，
 * 工作台等常驻窗口据此跟随当前活跃会话（含跨工作区跟随）
 */
import { broadcastToWindows } from './renderer-broadcast.js';

export interface FocusedConversation {
  conversationId: string;
  workspaceId: string;
}

let focused: FocusedConversation | null = null;

export function setFocusedConversation(next: FocusedConversation): void {
  if (focused?.conversationId === next.conversationId) return;
  focused = next;
  broadcastToWindows((h) => h.focusedConversationChanged.send(next));
  void clearTaskNotificationsForFocus(next.conversationId);
}

async function clearTaskNotificationsForFocus(conversationId: string): Promise<void> {
  try {
    const { getNotificationCenterService } = await import('./notification-center-service.js');
    await getNotificationCenterService().markReadByExecSession(conversationId);
  } catch {
    // 联动失败静默：条目残留由点开面板/点条目的已读路径兜底
  }
}

export function getFocusedConversation(): FocusedConversation | null {
  return focused;
}
