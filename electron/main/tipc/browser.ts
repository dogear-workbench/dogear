import { tipc } from '@egoist/tipc/main';
import { broadcastToWindows } from '../services/renderer-broadcast.js';
import {
  getBrowserActionHistory,
  getBrowserStreamStatus,
  recordBrowserAction,
  setBrowserActionBroadcaster,
} from '../services/browser/browser-action-stream.js';
import { setBrowserDownloadBroadcaster } from '../services/browser/browser-download-service.js';
import { setBrowserToolsActionListener } from '../agents/tools/browser-tools.js';

const t = tipc.create();

let bridgeRegistered = false;

/**
 * 动作流统一接线（registerTipcHandlers 调用一次）：
 * - Agent 工具动作源：browser-tools 模块级 hook → recordBrowserAction
 * - 主进程 → 渲染层：增量广播 browserActionAdded
 * 手动解析动作源（kind 'article'）在 tipc/article.ts 调 readArticleWithBrowser 时传 onAction 接入。
 */
export function registerBrowserActionBridge(): void {
  if (bridgeRegistered) return;
  bridgeRegistered = true;
  setBrowserActionBroadcaster((event) => {
    broadcastToWindows((h) => h.browserActionAdded.send(event));
  });
  setBrowserDownloadBroadcaster((event) => {
    broadcastToWindows((h) => h.browserDownloadProgress.send(event));
  });
  setBrowserToolsActionListener((event) => {
    recordBrowserAction({
      source: event.source,
      taskMeta: event.taskMeta,
      action: event.action,
      url: event.url,
      detail: event.detail,
      result: event.result,
    });
  });
}

export const browserRouter = {
  getBrowserActions: t.procedure
    .input<{ limit?: number }>()
    .action(async ({ input }) => {
      const history = getBrowserActionHistory();
      const limit = Math.max(0, Math.min(input?.limit ?? history.length, history.length));
      return {
        events: limit < history.length ? history.slice(history.length - limit) : history,
        status: getBrowserStreamStatus(),
      };
    }),
};
