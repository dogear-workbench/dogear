import type { ContextSnapshot } from '@/types/usage';

/** contextWindow → 简洁标签：200000→'200k'，1000000→'1m' */
export function formatLabel(window: number): string {
  if (window >= 1_000_000) return `${(window / 1_000_000).toFixed(1).replace(/\.0$/, '')}m`;
  return `${Math.round(window / 1000)}k`;
}

/** token 数缩写（k=千 m=百万 b=十亿，千进制）：15632→'15.6k'，1234567→'1.23m'，≥ 1B→'1.2b'，<1000 原样 */
export function formatTokens(n: number): string {
  if (n < 1000) return String(n);
  if (n < 1_000_000) return `${(n / 1000).toFixed(1).replace(/\.0$/, '')}k`;
  if (n < 1_000_000_000) return `${(n / 1_000_000).toFixed(2).replace(/\.?0+$/, '')}m`;
  return `${(n / 1_000_000_000).toFixed(2).replace(/\.?0+$/, '')}b`;
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
  /** 上下文构成估算（Σ 恒等于 used）；旧快照为空数组，UI 判空不渲染构成块 */
  categories: Array<{ name: string; tokens: number }>;
}

export function resolveContext(
  latestContext: ContextSnapshot | undefined,
  autoCompactPercent = 80,
): ContextInfo {
  if (!latestContext || latestContext.totalTokens <= 0) {
    return { used: null, limit: 0, percentage: 0, label: '', nearCompact: false, categories: [] };
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
    categories: latestContext.categories ?? [],
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

