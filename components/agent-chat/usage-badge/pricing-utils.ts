import { lookupPricing } from '@/lib/pi-model-catalog';
import type { AppSettings, ModelPricing, ModelSelection } from '@/types/settings';
import type { ConversationUsageEntry } from '@/types/usage';

export interface UsageTokens {
  input: number;
  output: number;
  cacheRead: number;
}

/** 会话模型的生效价：piModels 条目手填价 > 目录默认价；profile 或条目不存在视为无价 */
export function lookupEntryPricing(
  settings: AppSettings,
  selection: ModelSelection,
): ModelPricing | undefined {
  const entry = settings.profiles[selection.profileId]?.piModels?.find((m) => m.id === selection.tier);
  if (!entry) return undefined;
  return entry.pricing ?? lookupPricing(entry.id);
}

/** 按请求模型 id 查价：任意 profile 的手填价优先，目录兜底（弹窗无会话 profile 上下文，跨 profile 同 id 取首个手填） */
export function lookupModelPricing(settings: AppSettings, modelId: string): ModelPricing | undefined {
  for (const profile of Object.values(settings.profiles)) {
    const entry = profile.piModels?.find((m) => m.id === modelId);
    if (entry?.pricing) return entry.pricing;
  }
  return lookupPricing(modelId);
}

/** 费用（元）= (in×input + out×output + cacheRead×cacheRead) / 100 万 */
export function calcCost(tokens: UsageTokens, pricing: ModelPricing): number {
  return (
    (tokens.input * pricing.input +
      tokens.output * pricing.output +
      tokens.cacheRead * pricing.cacheRead) /
    1_000_000
  );
}

/** 会话累计费用：聚合各轮 modelUsage 分桶按各模型 pricing 求和；无任何可计价模型时返回 null */
export function sumSessionCost(
  entries: ConversationUsageEntry[],
  settings: AppSettings,
): number | null {
  const tokensByModel = new Map<string, UsageTokens>();
  for (const e of entries) {
    for (const [model, m] of Object.entries(e.modelUsage ?? {})) {
      const t = tokensByModel.get(model) ?? { input: 0, output: 0, cacheRead: 0 };
      t.input += m.inputTokens;
      t.output += m.outputTokens;
      t.cacheRead += m.cacheReadInputTokens;
      tokensByModel.set(model, t);
    }
  }
  let cost = 0;
  let priced = false;
  for (const [model, t] of tokensByModel) {
    const pricing = lookupModelPricing(settings, model);
    if (!pricing) continue;
    priced = true;
    cost += calcCost(t, pricing);
  }
  return priced ? cost : null;
}

/** ≥100 取整 / ≥1 两位小数 / <1 三位小数，前缀 ¥ */
export function formatCost(v: number): string {
  const value = v >= 100 ? String(Math.round(v)) : v >= 1 ? v.toFixed(2) : v.toFixed(3);
  return `¥${value}`;
}
