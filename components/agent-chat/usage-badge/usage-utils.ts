import type { ConversationUsageEntry, ContextSnapshot } from '@/types/usage';

type Usage = ConversationUsageEntry['usage'];

/** contextWindow → 简洁标签：200000→'200k'，1000000→'1M' */
export function formatLabel(window: number): string {
  if (window >= 1_000_000) return `${(window / 1_000_000).toFixed(1).replace(/\.0$/, '')}M`;
  return `${Math.round(window / 1000)}k`;
}

/** token 数缩写：15632→'15.6k'，900000→'900k'，<1000 原样 */
export function formatTokens(n: number): string {
  if (n < 1000) return String(n);
  const k = (n / 1000).toFixed(1).replace(/\.0$/, '');
  return `${k}k`;
}

/**
 * 解析当前上下文占用与上限，来自 SDK 真实快照 latestContext（query.getContextUsage）。
 * 无快照（旧对话或采集失败）返回 used=null，UI 据此不画进度条。
 * maxTokens 为 SDK 权威窗口（含 1M 模式），缺失时仅展示占用值、不画进度。
 */
export interface ContextInfo {
  used: number | null;
  limit: number;
  percentage: number;
  label: string;
}

export function resolveContext(latestContext: ContextSnapshot | undefined): ContextInfo {
  if (!latestContext || latestContext.totalTokens <= 0) {
    return { used: null, limit: 0, percentage: 0, label: '' };
  }
  const limit = latestContext.maxTokens > 0 ? latestContext.maxTokens : 0;
  const percentage = latestContext.percentage > 0
    ? latestContext.percentage
    : (limit > 0 ? (latestContext.totalTokens / limit) * 100 : 0);
  return {
    used: latestContext.totalTokens,
    limit,
    percentage,
    label: limit > 0 ? formatLabel(limit) : '',
  };
}

/**
 * 缓存命中率 = cacheRead / (input + cacheRead)。
 * 传单轮 usage 或会话级 totals（同字段形状）均可。
 */
export function cacheHitRate(usage: Pick<Usage, 'inputTokens' | 'cacheReadInputTokens'>): number {
  const denom = usage.inputTokens + usage.cacheReadInputTokens;
  if (denom <= 0) return 0;
  return usage.cacheReadInputTokens / denom;
}
