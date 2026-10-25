import { app, shell } from 'electron';
import { tipc } from '@egoist/tipc/main';
import { broadcastToWindows } from '../services/renderer-broadcast.js';
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

import { getExtensionStatus, sendExtensionCommand, setExtensionStatusBroadcaster, setHandoffHandler, setInterventionResolvedHandler } from '../services/browser/browser-gateway.js';
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
import { loadSettings, saveSettings, getConfigDir } from '../services/settings-service.js';
import { normalizeTaskBrowser, type AppSettings, type TaskBrowserConfig } from '../services/settings-types.js';
import {
  builtinExtensionDir,
  copyExtensionToCustom,
  getExtensionTarget,
  resetExtensionCustom,
} from '../services/extension-custom-service.js';
import { getPiSessionManager } from '../agents/pi-session/pi-session-manager.js';
import { handleInterventionRaised } from '../services/browser/intervention-notify.js';

const t = tipc.create();

let bridgeRegistered = false;

/** 人工等待接线（registerTipcHandlers 调用一次）：全量广播 + 新卡打扰（intervention-notify） */
export function registerHumanInterventionBridge(): void {
  if (bridgeRegistered) return;
  bridgeRegistered = true;
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

/** 内置扩展目录定位：prod = extraResources 打包产物，dev = 项目根源码目录 */
function extensionDirPath(): string {
  return builtinExtensionDir(app, process.resourcesPath);
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

/** 唤醒链路唯一入口：services 层不 import agents，等待人工解除走这里 */
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

  /** 当前生效扩展目录：custom 副本优先（存在即生效），source/outdated 供设置页展示副本状态与落后提示 */
  getExtensionDirPath: t.procedure.action(async () => getExtensionTarget(getConfigDir(), extensionDirPath())),

  /** 从内置复制到自定义（副本已存在时整体覆盖 = 更新副本），返回复制后的目标状态 */
  copyExtensionToCustom: t.procedure.action(async () => {
    try {
      return { ok: true as const, target: await copyExtensionToCustom(getConfigDir(), extensionDirPath()) };
    } catch (error) {
      console.error('[browser] 复制扩展到自定义区失败:', error);
      return { ok: false as const, error: String(error) };
    }
  }),

  /** 恢复默认：删除 custom 副本，浏览器加载回内置目录 */
  resetExtensionCustom: t.procedure.action(async () => {
    try {
      return { ok: true as const, target: await resetExtensionCustom(getConfigDir(), extensionDirPath()) };
    } catch (error) {
      console.error('[browser] 恢复扩展默认失败:', error);
      return { ok: false as const, error: String(error) };
    }
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

  /** 应用内 http/https 外链统一出口：系统默认浏览器打开，非 http(s) 拒绝 */
  'browser:openExternal': t.procedure
    .input<{ url: string }>()
    .action(async ({ input }) => {
      if (!/^https?:\/\//i.test(input.url)) {
        return { ok: false as const, error: '仅支持 http/https 链接' };
      }
      try {
        await shell.openExternal(input.url);
        return { ok: true as const };
      } catch (err) {
        return { ok: false as const, error: String(err) };
      }
    }),

  listHumanInterventions: t.procedure.action(async () => listPendingHumanInterventions()),

  getBrowserActionPolicy: t.procedure.action(async () => ({
    levels: ACTION_LEVEL_NOTES,
    paymentBlockedHosts: [...paymentBlockedHosts()],
    builtinPaymentBlockedHosts: [...builtinPaymentBlockedHosts()],
  })),

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
          resumeConversation(
            conversationId,
            `用户已在浏览器完成人工处理（${resolved.request.reason}，页面当前 URL: ${resolved.request.url ?? '未知'}）。请重新观察该 tab 的当前页面状态后继续任务，不要从头重跑，不要重放旧 ref。`,
          );
        }
      }
      return { resolved: true };
    }),
};
