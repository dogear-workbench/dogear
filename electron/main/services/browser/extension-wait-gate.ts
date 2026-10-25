/**
 * not_connected 分流编排：已配置任务浏览器时自动拉起并等待扩展连接，连接后重发原命令。
 * gateway 保持纯转发，gate 由 initExtensionWaitGate 注册（tipc/index.ts registerTipcHandlers 调用）；
 * 并发命令同时遇断连只拉起一次、等待卡只一张（pendingWait 单飞 + raise 同 tabId 复用）。
 */
import { mainLogger } from '../../agents/logger.js';
import { getChannelOwner } from './extension-ownership.js';
import {
  getExtensionStatus,
  setNotConnectedGate,
  subscribeExtensionStatus,
  type NotConnectedGateResult,
} from './browser-gateway.js';
import { launchTaskBrowser, isBrowserProcessAlive, TASK_BROWSER_LABELS } from './browser-launcher.js';
import { raiseHumanIntervention, resolveHumanIntervention, waitForInterventionResult } from './human-intervention.js';
import { loadSettings } from '../settings-service.js';
import type { TaskBrowserConfig } from '../settings-types.js';
import type { CommandKind } from './nm-protocol.js';
import type { BrowserTaskMeta } from './browser-task-meta.js';

const EXTENSION_WAIT_TIMEOUT_MS = 60_000;
const RECONNECT_WAIT_TIMEOUT_MS = 90_000;
const EXTENSION_WAIT_TAB_ID = 'extension-wait';

/** 收尾清理与会话卡 go_page 副作用不触发拉起：前者会话已销毁，后者失败保持卡片是既有语义 */
const NO_LAUNCH_KINDS: readonly CommandKind[] = ['close_agent_window', 'focus_tab'];

const logger = mainLogger.child('extension-wait-gate');

let pendingWait: Promise<NotConnectedGateResult> | null = null;

async function extensionWaitGate(kind: CommandKind): Promise<NotConnectedGateResult> {
  if (getExtensionStatus().status === 'connected') return { ok: true };
  if (NO_LAUNCH_KINDS.includes(kind)) return { ok: false, error: '扩展未连接' };
  const settings = await loadSettings();
  if (getExtensionStatus().status === 'connected') return { ok: true };
  if (!settings.taskBrowser) {
    return {
      ok: false,
      error:
        '浏览器扩展未连接。可在「设置 → 基础设置 → 浏览器」中配置任务浏览器，扩展未连接时将自动拉起浏览器并等待连接',
    };
  }
  if (!pendingWait) {
    pendingWait = launchAndWait(settings.taskBrowser).finally(() => {
      pendingWait = null;
    });
  }
  return pendingWait;
}

async function launchAndWait(config: TaskBrowserConfig): Promise<NotConnectedGateResult> {
  const browserLabel = TASK_BROWSER_LABELS[config.browser];
  const processAlive = await isBrowserProcessAlive(config.browser);
  if (!processAlive) {
    const launched = await launchTaskBrowser(config);
    if (!launched.ok) {
      logger.warn(`任务浏览器拉起失败: ${launched.error}`);
      return { ok: false, error: `任务浏览器拉起失败：${launched.error}` };
    }
  }
  const conversationId = getChannelOwner() ?? undefined;
  const taskMeta: BrowserTaskMeta = conversationId ? { kind: 'agent', conversationId } : { kind: 'agent' };
  const message = processAlive
    ? `检测到 ${browserLabel} 已在运行，正在等待 Dogear 扩展恢复连接…扩展恢复后任务会自动继续，无需操作；也可点「取消」放弃本次等待。`
    : `正在启动 ${browserLabel}（${config.profileName}），等待浏览器扩展连接…连接成功后任务会自动继续，无需操作；也可点「取消」放弃本次等待。`;
  const request = await raiseHumanIntervention({
    tabId: EXTENSION_WAIT_TAB_ID,
    reason: 'extension_wait',
    message,
    taskMeta,
    ...(conversationId ? { conversationId } : {}),
    actions: [{ key: 'cancel', label: '取消' }],
  });
  const waitMs = processAlive ? RECONNECT_WAIT_TIMEOUT_MS : EXTENSION_WAIT_TIMEOUT_MS;
  const waitPromise = waitForInterventionResult(request.id, waitMs);
  const unsubscribe = subscribeExtensionStatus((status) => {
    if (status.status === 'connected') resolveHumanIntervention(request.id, 'auto');
  });
  if (getExtensionStatus().status === 'connected') resolveHumanIntervention(request.id, 'auto');
  const { outcome } = await waitPromise;
  unsubscribe();
  logger.warn(
    `等待扩展连接结束: outcome=${outcome} processAlive=${processAlive} browser=${config.browser} profile=${config.profileDirectory}`,
  );
  if (outcome === 'auto') return { ok: true };
  if (outcome === 'unattended') {
    return {
      ok: false,
      error: '用户不在（无人值守），已跳过等待浏览器扩展连接，命令未执行；请改用其他路径（换源/降级/跳过并在收尾报告注明）',
    };
  }
  if (outcome === 'denied') {
    return { ok: false, error: '用户已取消等待，命令未执行' };
  }
  if (outcome === 'timeout') {
    return {
      ok: false,
      error: processAlive
        ? `等待浏览器扩展恢复连接超时（${Math.round(waitMs / 1000)} 秒），命令未执行。请检查 Dogear 扩展是否已启用，或在设置中重新配置任务浏览器`
        : `等待浏览器扩展连接超时（${Math.round(waitMs / 1000)} 秒），命令未执行。请检查 ${browserLabel} 是否已启动、Dogear 扩展是否已启用，或在设置中重新配置任务浏览器`,
    };
  }
  return { ok: false, error: '等待被解除但扩展仍未连接，命令未执行' };
}

export function initExtensionWaitGate(): void {
  setNotConnectedGate(extensionWaitGate);
}
