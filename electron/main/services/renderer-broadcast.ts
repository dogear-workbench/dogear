/**
 * 主进程 → 渲染层事件广播收口
 * 全窗口遍历发送；会话/组列表广播带 immediate / debounced 分档
 */
import electron from 'electron';
import { getRendererHandlers, type RendererHandlersCaller } from '@egoist/tipc/main';
import type { RendererHandlers } from '../tipc/renderer-handlers.js';

/** 遍历所有存活窗口发送事件（窗口销毁竞态静默跳过） */
export function broadcastToWindows(send: (handlers: RendererHandlersCaller<RendererHandlers>) => void): void {
  const bw = (electron as { BrowserWindow?: typeof electron.BrowserWindow }).BrowserWindow;
  if (!bw) return;
  for (const win of bw.getAllWindows()) {
    if (win.isDestroyed()) continue;
    try {
      send(getRendererHandlers<RendererHandlers>(win.webContents));
    } catch {
      // 窗口已销毁，忽略
    }
  }
}

const LIST_DEBOUNCE_MS = 500;
const listTimers = new Map<string, ReturnType<typeof setTimeout>>();

function sendListChanged(workspaceId: string): void {
  broadcastToWindows((h) => h.conversationListChanged.send({ workspaceId }));
}

/**
 * 广播会话/组列表变更。
 * immediate：结构操作（create/delete/归档/移动/改名），立即回环保证无延迟感
 * debounced：touch / autoUpdateTitle / usageSummary 等高频元数据变化，500ms 尾部去抖防列表风暴
 */
export function broadcastConversationListChanged(
  workspaceId: string,
  mode: 'immediate' | 'debounced' = 'immediate',
): void {
  const pending = listTimers.get(workspaceId);
  if (pending) {
    clearTimeout(pending);
    listTimers.delete(workspaceId);
  }
  if (mode === 'immediate') {
    sendListChanged(workspaceId);
    return;
  }
  listTimers.set(workspaceId, setTimeout(() => {
    listTimers.delete(workspaceId);
    sendListChanged(workspaceId);
  }, LIST_DEBOUNCE_MS));
}

/** 广播话题组数据（共享区文件/话题背景/组卡）变更，TopicPanel 匹配当前组后重拉 */
export function broadcastGroupDataChanged(workspaceId: string, groupId: string): void {
  broadcastToWindows((h) => h.groupDataChanged.send({ workspaceId, groupId }));
}

/** 广播存活会话集合（PiSessionManager 内存态派生，全量列表；前端直接整体替换 Set） */
export function broadcastAliveConversations(conversationIds: string[]): void {
  broadcastToWindows((h) => h.aliveConversationsChanged.send({ conversationIds }));
}
