import type { ConversationUsageEntry } from '@/types/usage';

type ModelUsage = ConversationUsageEntry['modelUsage'][string];
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
 * 解析上下文上限与标签。
 * 1M 模式固定 900k（SDK 上报 contextWindow 仍是 200k，但实际可用近 1M，留压缩余量按 900k 计）。
 * 普通模式取模型自身 contextWindow；缺失则 limit=0，UI 据此不画进度条。
 */
export function resolveContextLimit(
  modelUsage: ModelUsage | undefined,
  enable1M: boolean,
): { limit: number; label: string } {
  if (enable1M) return { limit: 900000, label: '1M' };
  const window = modelUsage?.contextWindow ?? 0;
  if (!window) return { limit: 0, label: '' };
  return { limit: window, label: formatLabel(window) };
}

/** 缓存命中率 = cacheRead / (input + cacheRead) */
export function cacheHitRate(usage: Pick<Usage, 'inputTokens' | 'cacheReadInputTokens'>): number {
  const denom = usage.inputTokens + usage.cacheReadInputTokens;
  if (denom <= 0) return 0;
  return usage.cacheReadInputTokens / denom;
}

/** 当前上下文占用 = input + cacheRead + cacheCreation */
export function currentContextSize(
  usage: Pick<Usage, 'inputTokens' | 'cacheReadInputTokens' | 'cacheCreationInputTokens'>,
): number {
  return usage.inputTokens + usage.cacheReadInputTokens + usage.cacheCreationInputTokens;
}
