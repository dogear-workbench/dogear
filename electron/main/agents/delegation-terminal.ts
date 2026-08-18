/**
 * 子会话终态通知构造（检测层）
 *
 * 终态联动：子会话走到失败终态（failed/hang/timeout）时秒级唤醒挂起在
 * dogear__WaitForMessage 的父会话，携带结构化死因（terminal）。
 * 本步不做重调与 quota 分类（Step 2 接管），errorClass 暂一律 'transient'。
 */

import type { ChildStatus } from '../types.js';

export type DelegationErrorClass = 'transient' | 'quota' | 'cancelled';

export interface TerminalInfo {
  status: ChildStatus;
  errorMessage?: string;
  errorClass?: DelegationErrorClass;
  /** resume 尝试次数（Step 2 起计数，本步恒 0） */
  attempts: number;
  /** 已试过的模型链，`profileId:tier` 列表（Step 2 起填充，本步恒空） */
  modelTried: string[];
}

export interface TerminalNoticeInput {
  title: string;
  status: ChildStatus;
  errorMessage?: string;
  startedAt: number;
  finishedAt?: number;
}

export interface TerminalWaiterLike {
  ownerConversationId: string;
  fromSdkSessionIds: Set<string>;
}

const TERMINAL_STATUS_LABELS: Partial<Record<ChildStatus, string>> = {
  failed: '运行失败',
  hang: '无进展中断',
  timeout: '超时中断',
  cancelled: '已取消',
  interrupted: '已中断',
  no_delivery: '结束但未交付',
};

export function terminalStatusLabel(status: ChildStatus): string {
  return TERMINAL_STATUS_LABELS[status] ?? status;
}

/** Step 1 通知范围：失败终态（failed/hang/timeout）。done/cancelled/no_delivery 不在本步通知 */
export function isNotifiableTerminal(status: ChildStatus): boolean {
  return status === 'failed' || status === 'hang' || status === 'timeout';
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
  const reason = input.errorMessage ?? terminalStatusLabel(input.status);
  return `子会话「${input.title}」${terminalStatusLabel(input.status)}：${reason}。已运行 ${duration}，自动重试 ${attempts} 次。`;
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
  const lines = [`状态: ${terminalStatusLabel(terminal.status)}`];
  if (terminal.errorMessage) lines.push(`死因: ${terminal.errorMessage}`);
  lines.push(`自动重试: ${terminal.attempts} 次`);
  if (terminal.modelTried.length > 0) lines.push(`已试模型: ${terminal.modelTried.join(' → ')}`);
  return lines.join('\n');
}
