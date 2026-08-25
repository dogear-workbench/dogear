/**
 * failover 展示契约的渲染层镜像：哨兵前缀与 quota 关键词必须与主进程
 * model-failover.ts / delegation-terminal.ts 保持一致（electron rootDir 限制无法共享模块），
 * electron/main/agents/model-failover.test.ts 有哨兵一致性守护测试。
 */

export const FAILOVER_CONTINUE_SENTINEL = '[system:failover-continue]';

const QUOTA_ERROR_KEYWORDS = [
  '429', 'rate limit', 'rate_limit', 'quota', 'insufficient', 'balance', '余额', '限流', '额度',
];

export function isQuotaErrorText(text: string): boolean {
  if (!text) return false;
  const lower = text.toLowerCase();
  return QUOTA_ERROR_KEYWORDS.some((kw) => lower.includes(kw));
}

export function isFailoverContinueMessage(content: string): boolean {
  return !!content && content.startsWith(FAILOVER_CONTINUE_SENTINEL);
}

export function stripFailoverContinueSentinel(content: string): string {
  return content.slice(FAILOVER_CONTINUE_SENTINEL.length).trim();
}

/** failover 接管窗口：notice 在错误发出后 60s 内到达视为接管了该错误（下方 2s 容差吸收事件乱序） */
export function hasFailoverTakeover(notices: Array<{ at: number }> | undefined, errorTimestamp: number): boolean {
  if (!notices || notices.length === 0) return false;
  return notices.some((n) => n.at >= errorTimestamp - 2000 && n.at - errorTimestamp < 60_000);
}
