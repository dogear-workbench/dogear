import type { ContextSnapshot } from '@/types/usage';

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
 * 解析当前上下文占用与上限，来自主进程写入的快照 latestContext
 * （maxTokens 已是查表后的真实上下文窗口；无快照返回 used=null，UI 据此不画进度条）。
 * autoCompactPercent：触发自动压缩的百分比（默认 80），
 * percentage 超过它时 nearCompact=true，徽章变色提示「即将压缩」。
 */
export interface ContextInfo {
  used: number | null;
  limit: number;
  percentage: number;
  label: string;
  nearCompact: boolean;
}

export function resolveContext(
  latestContext: ContextSnapshot | undefined,
  autoCompactPercent = 80,
): ContextInfo {
  if (!latestContext || latestContext.totalTokens <= 0) {
    return { used: null, limit: 0, percentage: 0, label: '', nearCompact: false };
  }
  const used = latestContext.totalTokens;
  const limit = latestContext.maxTokens;
  const percentage = limit > 0 ? (used / limit) * 100 : 0;
  return {
    used,
    limit,
    percentage,
    label: limit > 0 ? formatLabel(limit) : '',
    nearCompact: limit > 0 && percentage >= autoCompactPercent,
  };
}

/**
 * 缓存命中率 = cacheRead / (input + cacheRead)。
 * 传单轮 usage、modelUsage 桶或会话级 totals（同字段形状）均可。
 */
export function cacheHitRate(usage: { inputTokens: number; cacheReadInputTokens: number }): number {
  const denom = usage.inputTokens + usage.cacheReadInputTokens;
  if (denom <= 0) return 0;
  return usage.cacheReadInputTokens / denom;
}

