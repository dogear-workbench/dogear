import { BrowserWindow, type Rectangle } from 'electron';
import { tipc } from '@egoist/tipc/main';
import { broadcastToWindows } from '../services/renderer-broadcast.js';
import {
  getBrowserActionHistory,
  getBrowserStreamStatus,
  recordBrowserAction,
  setBrowserActionBroadcaster,
  setBrowserStreamLaunchedProvider,
} from '../services/browser/browser-action-stream.js';
import { getEmbeddedBrowserManager } from '../services/browser/embedded/embedded-browser-manager.js';
import {
  dismissPresentedTab,
  getPresentationForWindow,
  presentTab,
  reportPageViewBounds,
  setPresentationBroadcaster,
} from '../services/browser/embedded/presentation.js';
import {
  listPendingHumanInterventions,
  resolveHumanIntervention,
  setHumanInterventionBroadcaster,
} from '../services/browser/human-intervention.js';
import {
  getExtensionStatus,
  setExtensionStatusBroadcaster,
} from '../services/browser/browser-gateway.js';
import { setBrowserToolsActionListener, type BrowserToolsActionEvent } from '../agents/tools/browser-tool-shared.js';

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
  setBrowserStreamLaunchedProvider(() => getEmbeddedBrowserManager().listTabs().length > 0);
  setBrowserActionBroadcaster((event) => {
    broadcastToWindows((h) => h.browserActionAdded.send(event));
  });
  setPresentationBroadcaster((data) => {
    broadcastToWindows((h) => h.pagePresentationChanged.send(data));
  });
  setHumanInterventionBroadcaster((pending) => {
    broadcastToWindows((h) => h.humanInterventionChanged.send({ pending }));
  });
  setBrowserToolsActionListener((event: BrowserToolsActionEvent) => {
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

/** 扩展状态广播接线（registerTipcHandlers 调用一次） */
export function registerExtensionStatusBridge(): void {
  setExtensionStatusBroadcaster((status) => {
    broadcastToWindows((h) => h.extensionStatusChanged.send(status));
  });
}

function windowFromContext(sender: Electron.WebContents): BrowserWindow | null {
  const win = BrowserWindow.fromWebContents(sender);
  return win && !win.isDestroyed() ? win : null;
}

export const browserRouter = {
  getExtensionStatus: t.procedure.action(async () => getExtensionStatus()),

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

  getSelfWindowId: t.procedure.action(async ({ context }) => windowFromContext(context.sender)?.id ?? null),

  listEmbeddedTabs: t.procedure.action(async () => getEmbeddedBrowserManager().listTabs()),

  /** 页面视图区状态：tab 列表 + 本窗口当前呈现 tab + 本窗口是否上报过视图区 bounds */
  getPageViewState: t.procedure.action(async ({ context }) => {
    const win = windowFromContext(context.sender);
    const presentation = win ? getPresentationForWindow(win) : null;
    return {
      tabs: getEmbeddedBrowserManager().listTabs(),
      selfWindowId: win?.id ?? null,
      presentedTabId: presentation?.tabId ?? null,
      hasPageView: presentation?.hasPageView ?? false,
    };
  }),

  reportPageViewBounds: t.procedure
    .input<{ bounds: Rectangle | null }>()
    .action(async ({ input, context }) => {
      const win = windowFromContext(context.sender);
      if (!win) return;
      reportPageViewBounds(win, input.bounds);
    }),

  /** 渲染层「呈现」按钮与 agent present 工具共用后端；渲染层无会话语义，holder 固定 */
  presentEmbeddedTab: t.procedure
    .input<{ tabId?: string; url?: string; workspaceId?: string }>()
    .action(async ({ input, context }) => {
      if (input.tabId) {
        return presentTab(getEmbeddedBrowserManager(), { tabId: input.tabId });
      }
      if (input.url) {
        const win = windowFromContext(context.sender);
        return presentTab(getEmbeddedBrowserManager(), {
          url: input.url,
          workspaceId: input.workspaceId ?? (win ? `window-${win.id}` : 'companion-present'),
          holderId: 'companion-present',
        });
      }
      return { ok: false as const, message: 'tabId 与 url 至少提供一个' };
    }),

  dismissPresentedTab: t.procedure
    .input<{ tabId?: string }>()
    .action(async ({ input, context }) => {
      const win = windowFromContext(context.sender);
      if (!win) return;
      dismissPresentedTab(win, input.tabId);
    }),

  listHumanInterventions: t.procedure.action(async () => listPendingHumanInterventions()),

  resolveHumanIntervention: t.procedure
    .input<{ id: string }>()
    .action(async ({ input }) => ({ resolved: resolveHumanIntervention(input.id, 'user') })),
};
