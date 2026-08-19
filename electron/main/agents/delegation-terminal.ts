/**
 * 子会话终态通知构造 + 错误分类（检测层 / 重调层共用）
 *
 * 终态联动：子会话走到失败终态（failed/hang/timeout）时秒级唤醒挂起在
 * dogear__WaitForMessage 的父会话，携带结构化死因（terminal）。
 * 错误分类（transient/quota/cancelled）驱动重调决策；
 * stopped 且带 terminalReason 的终态都会唤醒 waiter（含用户取消与 no_delivery）。
 */

import type { PiSessionTurnResult } from './pi-session/pi-session.js';
import type { ChildTerminalReason } from '../types.js';

export type DelegationErrorClass = 'transient' | 'quota' | 'cancelled';

export const MAX_RETRY = 3;

let effectiveMaxRetry = MAX_RETRY;

/** 测试注入用：把重试上限临时调小以验证耗尽路径，生产路径不调用 */
export function setDelegationMaxRetry(n: number): void {
  effectiveMaxRetry = n;
}

export function getDelegationMaxRetry(): number {
  return effectiveMaxRetry;
}

const QUOTA_ERROR_KEYWORDS = [
  '429', 'rate limit', 'rate_limit', 'quota', 'insufficient', 'balance', '余额', '限流', '额度',
];

export function isQuotaErrorMessage(message: string): boolean {
  const lower = message.toLowerCase();
  return QUOTA_ERROR_KEYWORDS.some((kw) => lower.includes(kw));
}

/** cancelled 错误 → 用户取消；message 命中 quota 关键词 → 供应商费率问题；其余 → 瞬时错误 */
export function classifyDelegationError(result: PiSessionTurnResult): DelegationErrorClass {
  if (result.error?.kind === 'cancelled') return 'cancelled';
  if (result.error?.message && isQuotaErrorMessage(result.error.message)) return 'quota';
  return 'transient';
}

export interface TerminalInfo {
  terminalReason?: ChildTerminalReason;
  lastError?: string;
  errorClass?: DelegationErrorClass;
  /** 连续失败次数（complete 正常到达时清零） */
  attempts: number;
  /** 已试过的模型链，`profileId:tier` 列表 */
  modelTried: string[];
}

export interface TerminalNoticeInput {
  title: string;
  terminalReason?: ChildTerminalReason;
  lastError?: string;
  startedAt: number;
  finishedAt?: number;
  errorClass?: DelegationErrorClass;
  modelTried?: string[];
}

export interface TerminalWaiterLike {
  ownerConversationId: string;
  fromSdkSessionIds: Set<string>;
}

const TERMINAL_REASON_LABELS: Record<ChildTerminalReason, string> = {
  failed: '运行失败',
  hang: '无进展中断',
  timeout: '超时中断',
  cancelled: '已取消',
  no_delivery: '结束但未交付',
};

export function terminalStatusLabel(reason: ChildTerminalReason | undefined): string {
  return (reason && TERMINAL_REASON_LABELS[reason]) ?? '已结束';
}

/** 通知范围：stopped 且带死因；success+delivered（无 terminalReason）不打扰 waiter，交付走 deliverMessage */
export function isNotifiableTerminal(reason: ChildTerminalReason | undefined): boolean {
  return reason !== undefined;
}

export function formatDurationMs(ms: number): string {
  if (ms < 0) ms = 0;
  const totalSeconds = Math.round(ms / 1000);
  if (totalSeconds < 60) return `${totalSeconds} 秒`;
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes < 60) return seconds > 0 ? `${minutes} 分 ${seconds} 秒` : `${minutes} 分钟`;
  const hours = Math.floor(minutes / 60);
  const remMinutes = minutes % 60;
  return remMinutes > 0 ? `${hours} 小时 ${remMinutes} 分` : `${hours} 小时`;
}

export function buildTerminalNotice(input: TerminalNoticeInput, attempts = 0): string {
  const duration = formatDurationMs((input.finishedAt ?? Date.now()) - input.startedAt);
  const reason = input.lastError ?? terminalStatusLabel(input.terminalReason);
  const base = `子会话「${input.title}」${terminalStatusLabel(input.terminalReason)}：${reason}。已运行 ${duration}，自动重试 ${attempts} 次。`;
  if (input.terminalReason === 'no_delivery') {
    return `${base}结束不代表未完成：建议先用 dogear__ReadReferenceSession 查看其最后进展、dogear__ListGroupFiles 检查共享区是否已有交付，确认确实未完成后再重派或用 dogear__ResumeSession 调起。`;
  }
  if (input.errorClass !== 'quota') return base;
  const tried = input.modelTried ?? [];
  const detail = tried.length > 1
    ? `疑似供应商费率上限，已降级尝试 ${tried.join(' → ')} 后仍失败`
    : '疑似供应商费率上限，降级链无可用供应商';
  return `${base}${detail}，建议更换供应商后用 dogear__ResumeSession 调起或重新派遣。`;
}

/** 找出等待指定子会话消息的所有 waiter key（owner 是其父会话且监听该 sessionId） */
export function collectTerminalWaiterKeys<W extends TerminalWaiterLike>(
  waiters: Map<string, W>,
  parentConversationId: string,
  sessionId: string,
): string[] {
  const keys: string[] = [];
  for (const [key, w] of waiters) {
    if (w.ownerConversationId === parentConversationId && w.fromSdkSessionIds.has(sessionId)) {
      keys.push(key);
    }
  }
  return keys;
}

/** dogear__WaitForMessage 工具结果里附带的死因摘要 */
export function formatTerminalSummary(terminal: TerminalInfo): string {
  const lines = [`状态: ${terminalStatusLabel(terminal.terminalReason)}`];
  if (terminal.lastError) lines.push(`死因: ${terminal.lastError}`);
  lines.push(`自动重试: ${terminal.attempts} 次`);
  if (terminal.modelTried.length > 0) lines.push(`已试模型: ${terminal.modelTried.join(' → ')}`);
  return lines.join('\n');
}
