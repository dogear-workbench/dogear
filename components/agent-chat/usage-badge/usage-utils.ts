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
 * SDK 的 maxTokens 只反映标准窗口（200k），不感知 1M beta；enable1MContext 为真时
 * 按 1M 兜底并据此重算占比，使上限与徽章上的 1M 标记一致（跟随用户勾选）。
 */
export interface ContextInfo {
  used: number | null;
  limit: number;
  percentage: number;
  label: string;
}

export function resolveContext(
  latestContext: ContextSnapshot | undefined,
  enable1MContext = false,
): ContextInfo {
  if (!latestContext || latestContext.totalTokens <= 0) {
    return { used: null, limit: 0, percentage: 0, label: '' };
  }
  const rawLimit = latestContext.maxTokens > 0 ? latestContext.maxTokens : 0;
  const limit = enable1MContext ? Math.max(rawLimit, 1_000_000) : rawLimit;
  // 上限被 1M 覆盖后，SDK 按 200k 算出的 percentage 不再适用，按 used/limit 重算
  const percentage = limit !== rawLimit
    ? (latestContext.totalTokens / limit) * 100
    : (latestContext.percentage > 0
        ? latestContext.percentage
        : (limit > 0 ? (latestContext.totalTokens / limit) * 100 : 0));
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
