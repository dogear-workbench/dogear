/**
 * 扩展通道登录墙/验证墙人工介入：工具返回 pageState 命中时 raise 会话卡并阻塞等待用户处理。
 * 通道：raise（go_page/done/block/skip 按钮组）→ watch_intervention 挂自动检测 →
 * 用户点按钮或扩展回推 auto 解除 → outcome 分支（完成路径重发 observe / 屏蔽写 blocklist / 跳过与超时 isError）。
 */

import { getExtensionStatus } from '../../services/browser/browser-gateway.js';
import { NO_FOCUS_TAB_ID } from '../../services/browser/gateway-tab-state.js';
import { addBlockedDomain, isBlocked, toRegisteredDomain } from '../../services/browser/browser-blocklist-service.js';
import {
  raiseHumanIntervention,
  waitForInterventionResult,
  type HumanInterventionAction,
  type HumanInterventionReason,
} from '../../services/browser/human-intervention.js';
import { buildTaskMeta, currentUrl, isErrorResult, runCommand, textResult } from './extension-command-shared.js';
import { parseObservePayload, pageStateSuffix } from './extension-observe-format.js';
import { mainLogger } from '../../agents/logger.js';
import type { ToolResult } from '../pi/tool-adapter.js';

const LOGIN_WALL_TIMEOUT_MS = 5 * 60_000;

const LOGIN_ACTIONS: HumanInterventionAction[] = [
  { key: 'go_page', label: '前往该网页' },
  { key: 'done', label: '完成登录', tone: 'primary' },
  { key: 'block', label: '屏蔽该网站', tone: 'destructive' },
  { key: 'skip', label: '本次跳过' },
];

const VERIFY_ACTIONS: HumanInterventionAction[] = [
  { key: 'go_page', label: '前往该网页' },
  { key: 'done', label: '完成验证', tone: 'primary' },
  { key: 'skip', label: '本次跳过' },
];

const logger = mainLogger.child('extension-login-wall');

export function isWallPageState(pageState?: string): boolean {
  return pageState === 'login_required' || pageState === 'verification_required';
}

export interface LoginWallGateInput {
  conversationId?: string;
  pageState?: string;
  url?: string | null;
  /** 命中命令回传的数字 tabId；缺省用当前焦点 tab */
  tabId?: number;
  /** done/auto 后给 agent 的续作指引（按工具区分） */
  resumeNote: string;
}

/** 命中登录/验证墙时 raise 卡并阻塞等待；返回 null 表示无墙，工具继续既有流程 */
export async function loginWallGate(input: LoginWallGateInput): Promise<ToolResult | null> {
  if (!isWallPageState(input.pageState)) return null;
  const reason = input.pageState as Extract<HumanInterventionReason, 'login_required' | 'verification_required'>;
  const noun = reason === 'login_required' ? '登录' : '人工验证';
  const url = input.url || currentUrl() || '';
  const domain = toRegisteredDomain(url);
  if (domain && (await isBlocked(url))) {
    return isErrorResult(`该站点（${domain}）已被用户要求屏蔽，请停止访问该站，改用其他来源或直接告知用户`);
  }
  const status = getExtensionStatus();
  const extTabId = input.tabId ?? (status.status === 'connected' ? status.tabId : null);
  const request = raiseHumanIntervention({
    tabId: `ext-${extTabId ?? 'unknown'}`,
    reason,
    message:
      reason === 'login_required'
        ? '本页面需要登录后才能继续。请在浏览器中完成登录，登录成功后本操作会自动继续；也可点「前往该网页」把浏览器切到前台。'
        : '本页面需要人工完成人机验证/安全挑战。请在浏览器中完成验证，完成后本操作会自动继续。',
    url: url || null,
    taskMeta: buildTaskMeta(input.conversationId),
    conversationId: input.conversationId,
    actions: reason === 'login_required' ? LOGIN_ACTIONS : VERIFY_ACTIONS,
  });
  if (typeof extTabId === 'number' && extTabId !== NO_FOCUS_TAB_ID) {
    // 挂自动检测：登录跳转完成 pageState 恢复 ready 时扩展回推 → auto 解除唤醒等待
    await runCommand('watch_intervention', { tabId: extTabId }, () => undefined, undefined, { tabId: extTabId });
  }
  const { outcome, request: resolved } = await waitForInterventionResult(request.id, LOGIN_WALL_TIMEOUT_MS);
  const actionKey = resolved?.actionKey;
  logger.warn(`登录墙等待结束: outcome=${outcome} actionKey=${actionKey ?? '-'} url=${url}`);
  if (outcome === 'approved' || outcome === 'auto' || outcome === 'manual' || outcome === 'missing') {
    return rerunObserve(input.resumeNote);
  }
  if (outcome === 'denied' && actionKey === 'block') {
    const blocked = domain ? await addBlockedDomain(domain, reason) : null;
    if (!blocked) return isErrorResult('屏蔽该站点失败（域名无法解析），请改用其他来源');
    return isErrorResult(`已按用户要求屏蔽该站点（${blocked}），后续请勿再访问该站，改用其他来源或直接告知用户`);
  }
  if (outcome === 'denied') {
    return isErrorResult(`用户已跳过本次${noun}，该站需${noun}后才能继续；请改用其他路径，或就此向用户说明`);
  }
  return isErrorResult(`等待用户处理超时（5 分钟），用户未响应，已跳过；该站需${noun}后才能继续，请改用其他路径或稍后重试`);
}

/** done/auto 路径：重发一次 observe 取最新页面状态返回，agent 据此继续或重发原操作 */
async function rerunObserve(resumeNote: string): Promise<ToolResult> {
  const r = await runCommand('observe', {}, parseObservePayload);
  if (!r.ok) {
    return isErrorResult(
      `用户已完成处理，但重新观察页面失败：${r.message}。请重新调用 observe_page 确认页面状态后继续任务`,
    );
  }
  const v = r.value;
  return textResult(
    `用户已完成处理，页面当前状态：\nURL: ${v.url ?? ''}\n标题: ${v.title ?? ''}\n状态: ${v.pageState ?? 'ready'}${pageStateSuffix(v.pageState)}\n${resumeNote}`,
  );
}
