import { app, BrowserWindow, type Rectangle } from 'electron';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
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
  setOverlayHidden,
  setPresentationBroadcaster,
} from '../services/browser/embedded/presentation.js';
import {
  closeWebAiTab,
  getWebAiState,
  openWebAiSite,
  reportWebAiBounds,
  setWebAiOverlayHidden,
} from '../services/browser/embedded/webai.js';
import {
  listPendingHumanInterventions,
  outcomeForActionKey,
  resolveHumanIntervention,
  resolveInterventionsForTab,
  setHumanInterventionBroadcaster,
  type InterventionResult,
} from '../services/browser/human-intervention.js';
import { ACTION_LEVEL_NOTES, builtinPaymentBlockedHosts, paymentBlockedHosts } from '../services/browser/site-policy.js';
import { mainLogger } from '../agents/logger.js';

const interventionLogger = mainLogger.child('intervention-tipc');
import {
  getExtensionStatus,
  sendExtensionCommand,
  setExtensionStatusBroadcaster,
  setHandoffHandler,
  setInterventionResolvedHandler,
} from '../services/browser/browser-gateway.js';
import { routeBrowserHandoff, setHandoffDraftBroadcaster } from '../services/browser/extension-handoff.js';
import {
  registerNmHost as registerNmHostService,
  unregisterNmHost as unregisterNmHostService,
} from '../services/browser/nm-host-register.js';
import {
  detectBrowsers,
  detectBrowser,
  launchTaskBrowser,
  TASK_BROWSER_LABELS,
} from '../services/browser/browser-launcher.js';
import { loadSettings, saveSettings } from '../services/settings-service.js';
import { normalizeTaskBrowser, type AppSettings, type TaskBrowserConfig } from '../services/settings-types.js';
import { setBrowserToolsActionListener, type BrowserToolsActionEvent } from '../agents/tools/browser-tool-shared.js';
import { getPiSessionManager } from '../agents/pi-session/pi-session-manager.js';
import { handleInterventionRaised } from '../services/browser/intervention-notify.js';

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
  setHumanInterventionBroadcaster((pending, resolved) => {
    broadcastToWindows((h) => h.humanInterventionChanged.send({ pending, resolved }));
    if (resolved) {
      lastPendingInterventionIds = new Set(pending.map((p) => p.id));
      return;
    }
    const fresh = pending.filter((p) => !lastPendingInterventionIds.has(p.id));
    lastPendingInterventionIds = new Set(pending.map((p) => p.id));
    if (fresh.length === 0) return;
    void handleInterventionRaised(fresh[fresh.length - 1]);
  });
  getEmbeddedBrowserManager().setTakeoverChangeListener(() => {
    broadcastToWindows((h) => h.tabTakeoverChanged.send({ takeovers: getEmbeddedBrowserManager().listTakeovers() }));
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

/** 扩展登录自动检测回推接线（registerTipcHandlers 调用一次）：watch tab 恢复 ready → 自动解除该 tab 挂起的人工等待 */
export function registerExtensionInterventionBridge(): void {
  setInterventionResolvedHandler((tabId) => {
    resolveInterventionsForTab(`ext-${tabId}`);
  });
}

/** 浏览器一键移交接线（registerTipcHandlers 调用一次）：gateway 帧 → 渲染层草稿广播 + 通知中心待编辑提醒 */
export function registerExtensionHandoffBridge(): void {
  setHandoffDraftBroadcaster((payload) => {
    broadcastToWindows((h) => h.browserHandoffReceived.send(payload));
  });
  setHandoffHandler((handoff) => {
    routeBrowserHandoff(handoff).catch((err) => {
      console.error('[browser] 页面移交路由失败:', err);
    });
  });
}

/** 扩展目录定位：prod = extraResources 打包产物，dev = 项目根源码目录；供设置页安装引导展示 */
function extensionDirPath(): string {
  return app.isPackaged
    ? join(process.resourcesPath, 'extension')
    : join(app.getAppPath(), 'extension');
}

function windowFromContext(sender: Electron.WebContents): BrowserWindow | null {
  const win = BrowserWindow.fromWebContents(sender);
  return win && !win.isDestroyed() ? win : null;
}

/** taskBrowser 写入唯一口：落盘 + 广播设置变更（设置页 store 热更） */
async function patchTaskBrowser(settings: AppSettings, config: TaskBrowserConfig | null): Promise<void> {
  const next = structuredClone(settings) as AppSettings;
  if (config === null) delete next.taskBrowser;
  else next.taskBrowser = config;
  await saveSettings(next);
  const { broadcastSettingsChanged } = await import('../main-app.js');
  broadcastSettingsChanged();
}

let lastPendingInterventionIds = new Set<string>();

function parseExtTabId(tabId: string | undefined): number | null {
  const match = /^ext-(\d+)$/.exec(tabId ?? '');
  return match ? Number(match[1]) : null;
}

/** 「前往该网页」副作用：激活等待中的 tab 并前置窗口；失败不解除等待（用户可手动切换） */
async function focusInterventionTab(id: string): Promise<void> {
  const request = listPendingHumanInterventions().find((r) => r.id === id);
  const tabId = parseExtTabId(request?.tabId);
  if (tabId === null) {
    interventionLogger.warn(`go_page 无法解析目标 tabId: id=${id}`);
    return;
  }
  try {
    await sendExtensionCommand('focus_tab', { tabId }, undefined, { tabId });
    interventionLogger.warn(`前往该网页: id=${id} tabId=${tabId}`);
  } catch (err) {
    const detail = (err as { error?: string } | null)?.error ?? String(err);
    interventionLogger.warn(`前往该网页失败，卡片保持等待: id=${id} tabId=${tabId} error=${detail}`);
  }
}

/** 唤醒链路唯一入口：services 层不 import agents，等待人工解除与接管交还都走这里 */
function resumeConversation(conversationId: string, message: string): void {
  const manager = getPiSessionManager();
  const sessionId = manager.getSessionIdByConversation(conversationId);
  const session = sessionId ? manager.getSession(sessionId) : undefined;
  if (!session) {
    console.warn('[browser] 唤醒跳过：会话不存在或已关闭:', conversationId);
    return;
  }
  session.sendMessage(message).catch((err) => {
    console.error('[browser] 唤醒会话失败:', conversationId, err);
  });
}

export const browserRouter = {
  getExtensionStatus: t.procedure.action(async () => getExtensionStatus()),

  /** 目录缺失（打包遗漏/安装损坏）返回 null，前端显示占位而非幽灵路径 */
  getExtensionDirPath: t.procedure.action(async () => {
    const dir = extensionDirPath();
    return { path: existsSync(dir) ? dir : null };
  }),

  registerNmHost: t.procedure.action(async () => registerNmHostService()),

  unregisterNmHost: t.procedure.action(async () => unregisterNmHostService()),

  /** 任务浏览器探测 + 当前配置；已配置项失效（浏览器卸载/账户被删）时清空并返回 cleared 标记 */
  listTaskBrowsers: t.procedure.action(async () => {
    const browsers = await detectBrowsers();
    const settings = await loadSettings();
    const current = settings.taskBrowser ?? null;
    const matched = current ? browsers.find((b) => b.browser === current.browser) : undefined;
    const invalid =
      current !== null && (!matched || !matched.profiles.some((p) => p.directory === current.profileDirectory));
    if (invalid) {
      await patchTaskBrowser(settings, null);
    }
    return { browsers, current: invalid ? null : current, cleared: invalid };
  }),

  /** 保存/清除任务浏览器；写入前校验浏览器已安装且账户在列表中，失效拒绝保存 */
  saveTaskBrowser: t.procedure
    .input<{ taskBrowser: TaskBrowserConfig | null }>()
    .action(async ({ input }) => {
      const settings = await loadSettings();
      if (input.taskBrowser === null) {
        await patchTaskBrowser(settings, null);
        return { ok: true as const };
      }
      const config = normalizeTaskBrowser(input.taskBrowser);
      if (!config) return { ok: false as const, error: '任务浏览器配置不完整' };
      const detection = await detectBrowser(config.browser);
      if (!detection) {
        return { ok: false as const, error: `未检测到已安装的 ${TASK_BROWSER_LABELS[config.browser]}` };
      }
      if (!detection.profiles.some((p) => p.directory === config.profileDirectory)) {
        return { ok: false as const, error: `浏览器账户「${config.profileName}」不存在` };
      }
      await patchTaskBrowser(settings, config);
      return { ok: true as const };
    }),

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
    .input<{ bounds: Rectangle | null; revision: number }>()
    .action(async ({ input, context }) => {
      const win = windowFromContext(context.sender);
      if (!win) return;
      reportPageViewBounds(win, input.bounds, input.revision);
    }),

  reportPageViewOverlay: t.procedure
    .input<{ hidden: boolean }>()
    .action(async ({ input, context }) => {
      const win = windowFromContext(context.sender);
      if (!win) return;
      setOverlayHidden(win, input.hidden);
    }),

  getWebAiState: t.procedure.action(async () => getWebAiState()),

  openWebAiSite: t.procedure
    .input<{ url: string }>()
    .action(async ({ input, context }) => openWebAiSite(windowFromContext(context.sender), input.url)),

  closeWebAiTab: t.procedure.action(async () => {
    closeWebAiTab();
  }),

  reportWebAiBounds: t.procedure
    .input<{ bounds: Rectangle | null; revision: number }>()
    .action(async ({ input, context }) => {
      const win = windowFromContext(context.sender);
      if (!win) return;
      reportWebAiBounds(win, input.bounds, input.revision);
    }),

  reportWebAiOverlay: t.procedure
    .input<{ hidden: boolean }>()
    .action(async ({ input, context }) => {
      const win = windowFromContext(context.sender);
      if (!win) return;
      setWebAiOverlayHidden(win, input.hidden);
    }),

  /** 地址栏导航/历史操作：只作用于呈现 tab，agent 当前 tab 不受影响 */
  navigatePresentedTab: t.procedure
    .input<{ tabId: string; url: string }>()
    .action(async ({ input }) => getEmbeddedBrowserManager().navigateTabAsUser(input.tabId, input.url)),

  goBackPresentedTab: t.procedure
    .input<{ tabId: string }>()
    .action(async ({ input }) => getEmbeddedBrowserManager().goBackTab(input.tabId)),

  goForwardPresentedTab: t.procedure
    .input<{ tabId: string }>()
    .action(async ({ input }) => getEmbeddedBrowserManager().goForwardTab(input.tabId)),

  reloadPresentedTab: t.procedure
    .input<{ tabId: string }>()
    .action(async ({ input }) => getEmbeddedBrowserManager().reloadTab(input.tabId)),

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

  getBrowserActionPolicy: t.procedure.action(async () => ({
    levels: ACTION_LEVEL_NOTES,
    paymentBlockedHosts: [...paymentBlockedHosts()],
    builtinPaymentBlockedHosts: [...builtinPaymentBlockedHosts()],
  })),

  takeOverTab: t.procedure
    .input<{ tabId: string; conversationId?: string }>()
    .action(async ({ input }) => {
      const taskMeta = input.conversationId ? { kind: 'agent' as const, conversationId: input.conversationId } : undefined;
      const ok = getEmbeddedBrowserManager().takeOverTab(input.tabId, taskMeta);
      return { ok };
    }),

  releaseTakeover: t.procedure
    .input<{ tabId: string }>()
    .action(async ({ input }) => {
      const released = getEmbeddedBrowserManager().releaseTakeover(input.tabId);
      if (!released) return { ok: false };
      const conversationId = released.taskMeta?.conversationId;
      if (conversationId) {
        resumeConversation(
          conversationId,
          '用户已交还页面控制权。请重新 observe_page 观察当前页面后继续任务，旧 ref 已全部失效',
        );
      }
      return { ok: true };
    }),

  resolveHumanIntervention: t.procedure
    .input<{ id: string; result?: InterventionResult; actionKey?: string }>()
    .action(async ({ input }) => {
      let result = input.result;
      if (!result && input.actionKey) {
        result = outcomeForActionKey(input.actionKey) ?? undefined;
        if (!result) {
          if (input.actionKey === 'go_page') {
            await focusInterventionTab(input.id);
          } else {
            interventionLogger.warn(`确认操作未映射 actionKey，交由副作用链路处理: id=${input.id} actionKey=${input.actionKey}`);
          }
          return { resolved: false, delegated: true };
        }
      }
      interventionLogger.warn(`确认操作到达主进程: id=${input.id} result=${result ?? '(无)'}`);
      const resolved = resolveHumanIntervention(input.id, 'user', result, undefined, input.actionKey);
      if (!resolved) return { resolved: false };
      if (!resolved.waiterConsumed) {
        const conversationId = resolved.taskMeta.conversationId;
        if (conversationId) {
          const tab = getEmbeddedBrowserManager().getTab(resolved.request.tabId);
          const url = tab?.url ?? resolved.request.url ?? '未知';
          resumeConversation(
            conversationId,
            `用户已在浏览器完成人工处理（${resolved.request.reason}，页面当前 URL: ${url}）。请重新观察该 tab 的当前页面状态后继续任务，不要从头重跑，不要重放旧 ref。`,
          );
        }
      }
      return { resolved: true };
    }),
};
