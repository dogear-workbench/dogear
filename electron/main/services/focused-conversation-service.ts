/**
 * 全局焦点会话状态（「最近一次被激活的会话」语义，跨窗口共享）
 * 主窗口切 tab / 独立会话窗口激活会话时经 tipc 上报；主进程内存态，值变化广播，
 * 伴随工作台等常驻窗口据此跟随当前活跃会话（含跨工作区跟随）
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
}

export function getFocusedConversation(): FocusedConversation | null {
  return focused;
}
