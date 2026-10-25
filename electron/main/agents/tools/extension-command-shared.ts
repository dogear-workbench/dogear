/**
 * 扩展通道工具共享辅助：错误文案映射 / 命令执行 / 动作流 / 作用域说明
 *
 * 从 extension-tools 拆出，extension-tools 与 extension-tab-tools 共用，避免互相 import 成环。
 * 错误一律转中文 isError 文案不抛异常（13 个 errorCode 映射全覆盖）；
 * 空态（NO_FOCUS_TAB_ID）时 permission_denied 区分为「无可用标签页」引导 open_tab。
 */

import {
  getExtensionStatus,
  sendExtensionCommand,
  type CommandError,
  type SendExtensionCommandOptions,
} from '../../services/browser/browser-gateway.js';
import { mainLogger } from '../../agents/logger.js';
import { MIN_ACTION_INTERVAL_MS, sleep } from '../../services/browser/site-policy.js';
import { recordBrowserAction } from '../../services/browser/browser-action-stream.js';
import type { BrowserActionType } from '../../services/browser/browser-action-stream.js';
import type { BrowserTaskMeta } from '../../services/browser/browser-task-meta.js';
import { NO_FOCUS_TAB_ID } from '../../services/browser/gateway-tab-state.js';
import type { CommandErrorCode, CommandKind } from '../../services/browser/nm-protocol.js';
import type { ToolResult } from '../pi/tool-adapter.js';

export const ERROR_MESSAGES: Record<CommandErrorCode, string> = {
  not_connected: '浏览器扩展未连接，请稍后重试；持续失败请检查 Dogear 扩展是否已启用',
  stale_protocol:
    '扩展版本过旧：内置安装请在扩展管理页重载 Dogear 扩展；自定义副本请先在「设置 → 基础设置 → 浏览器」用内置版覆盖，再到扩展管理页重载',
  timeout: '命令执行超时（30s 上限），请重试',
  disconnected: '扩展连接中断，命令已取消；系统会自动重连，稍等后重试即可',
  stale_tab: '当前受控标签页已不可用，请用 list_tabs 查看 Dogear 标签页并用 focus_tab 切换，或 open_tab 打开新页面',
  navigated_away: '页面已离开命令发起时的地址，请重新调用 observe_page 后再操作',
  tab_closed: '目标标签页已关闭，请用 list_tabs 查看剩余标签页，或 open_tab 重新打开',
  permission_denied: '目标不在 Dogear 可操作范围（仅 agent 窗口内标签页与当前焦点标签页），请用 list_tabs 查询可用标签页',
  ref_expired: '页面已变化，请重新调用 observe_page 获取新 ref',
  value_mismatch: '填写后页面当前值与输入不一致（页面可能改写了内容），请检查后重试',
  guard_password: '密码类输入本阶段禁止，请手动填写密码',
  guard_submit: '提交类操作需用户确认后执行，请在确认卡上处理（确认后放行 / 拒绝则不执行）',
  navigation_blocked: '无法导航至目标地址',
};

export const EMPTY_GROUP_MESSAGE =
  'Dogear 当前没有可用标签页（agent 窗口为空），请先调用 dogear__extension__open_tab 打开目标页面';

export const SHARED_SCOPE_NOTE =
  '作用于用户真实浏览器中 Dogear 管理的标签页（agent 专属窗口内 + 用户移交的焦点页面，经 NativeMessaging 通道），导航不受域名限制，支付与网银域名一律禁用；' +
  'open_tab 开新页即成操作焦点，close_tab 仅能关 agent 窗口内标签页，页面操作只作用于焦点标签页；' +
  '点击/填充自动执行，提交类点击需用户在确认卡上确认后才会执行。' +
  '页面命中登录墙/人机验证时会自动弹出等待人工卡并阻塞等待用户处理（5 分钟超时自动跳过），请以工具返回结果为准，不要在等待期间重试。' +
  `navigate/click/fill 之间有节奏保护（最小间隔 ${MIN_ACTION_INTERVAL_MS / 1000} 秒，间隔不足时系统自动等待，回包稍慢属正常，不要重试）；` +
  '扩展通道同一时间仅一个会话可用，被其他会话占用时会直接报错（不排队）。' +
  '用户浏览器已连接且目标站需登录态时优先本工具组；公开网页读取可用 dogear__extension__search / readArticle（纯 HTTP，不占通道独占）。';

export function commandErrorMessage(err: unknown): string {
  const e = (err ?? null) as Partial<CommandError> | null;
  const code = e?.errorCode;
  const detail = typeof e?.error === 'string' && e.error ? e.error : undefined;
  const currentUrl = typeof e?.currentUrl === 'string' && e.currentUrl ? e.currentUrl : undefined;
  if (code === 'navigated_away' || code === 'ref_expired') {
    const base = ERROR_MESSAGES[code];
    return currentUrl ? `${base}（当前页面: ${currentUrl}）` : base;
  }
  if (code === 'navigation_blocked') {
    if (!detail) return ERROR_MESSAGES.navigation_blocked;
    return `无法导航：${detail}`;
  }
  if (code === 'not_connected') {
    return detail ?? ERROR_MESSAGES.not_connected;
  }
  if (code === 'permission_denied') {
    return detail ?? ERROR_MESSAGES.permission_denied;
  }
  if (typeof code === 'string' && code in ERROR_MESSAGES) {
    return ERROR_MESSAGES[code as CommandErrorCode];
  }
  return `浏览器扩展命令执行失败：${detail ?? String(err)}`;
}

export function isErrorResult(message: string): ToolResult {
  return { content: [{ type: 'text' as const, text: message }], isError: true };
}

export function textResult(text: string): ToolResult {
  return { content: [{ type: 'text' as const, text }] };
}

export function buildTaskMeta(conversationId: string | undefined): BrowserTaskMeta {
  return conversationId ? { kind: 'agent', conversationId } : { kind: 'agent' };
}

export function currentUrl(): string | undefined {
  const status = getExtensionStatus();
  return status.status === 'connected' ? status.url : undefined;
}

export interface ActionExtra {
  url?: string;
  detail?: string;
  result?: string;
  urlBefore?: string;
  urlAfter?: string;
  errorCode?: string;
  durationMs?: number;
}

export function emitAction(
  taskMeta: BrowserTaskMeta,
  action: BrowserActionType,
  extra?: ActionExtra,
): void {
  recordBrowserAction({
    source: 'extension',
    taskMeta,
    action,
    ...extra,
  });
}

export function busyChannelMessage(idleMs: number): string {
  const minutes = Math.max(1, Math.floor(idleMs / 60_000));
  return `扩展通道正被另一个会话使用（对方最近活动于 ${minutes} 分钟前），通道空闲 10 分钟后自动释放；若需并行调研，请改串行派遣`; 
}

function isEmptyGroup(): boolean {
  const status = getExtensionStatus();
  return status.status === 'connected' && status.tabId === NO_FOCUS_TAB_ID;
}

const paceLogger = mainLogger.child('extension-pace');
const lastActionAtByConv = new Map<string, number>();

function paceKey(conversationId: string | undefined): string {
  return conversationId ?? '__adhoc__';
}

/** 距上次扩展写操作不足最小间隔时补齐等待（对齐策略站点 delayMs 的「自动等待」语义，不报错） */
export async function paceActionGate(conversationId: string | undefined): Promise<void> {
  const key = paceKey(conversationId);
  const last = lastActionAtByConv.get(key);
  if (last === undefined) return;
  const elapsed = Date.now() - last;
  if (elapsed >= MIN_ACTION_INTERVAL_MS) return;
  const waited = MIN_ACTION_INTERVAL_MS - elapsed;
  paceLogger.warn(`操作节奏限制: conv=${key} 等待=${waited}ms 间隔下限=${MIN_ACTION_INTERVAL_MS}ms`);
  await sleep(waited);
}

export function markActionDone(conversationId: string | undefined): void {
  lastActionAtByConv.set(paceKey(conversationId), Date.now());
}

export async function runCommand<T>(
  kind: CommandKind,
  params: Record<string, unknown>,
  extract: (data: unknown) => T,
  timeoutMs?: number,
  opts?: SendExtensionCommandOptions,
): Promise<{ ok: true; value: T } | { ok: false; message: string; errorCode?: string; data?: unknown }> {
  try {
    const result = await sendExtensionCommand(kind, params, timeoutMs, opts);
    return { ok: true, value: extract(result.data) };
  } catch (err) {
    const e = (err ?? null) as Partial<CommandError> | null;
    const errorCode = e?.errorCode;
    const message =
      errorCode === 'permission_denied' && isEmptyGroup() ? EMPTY_GROUP_MESSAGE : commandErrorMessage(err);
    return {
      ok: false,
      message,
      ...(typeof errorCode === 'string' ? { errorCode } : {}),
      ...(e?.data !== undefined ? { data: e.data } : {}),
    };
  }
}
