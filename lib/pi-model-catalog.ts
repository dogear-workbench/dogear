import { ANTHROPIC_MODELS } from '@earendil-works/pi-ai/providers/anthropic.models';
import { OPENAI_MODELS } from '@earendil-works/pi-ai/providers/openai.models';
import { DEEPSEEK_MODELS } from '@earendil-works/pi-ai/providers/deepseek.models';
import { ZAI_MODELS } from '@earendil-works/pi-ai/providers/zai.models';
import { MOONSHOTAI_MODELS } from '@earendil-works/pi-ai/providers/moonshotai.models';
import { MINIMAX_MODELS } from '@earendil-works/pi-ai/providers/minimax.models';
import { QWEN_TOKEN_PLAN_MODELS } from '@earendil-works/pi-ai/providers/qwen-token-plan.models';
import { XAI_MODELS } from '@earendil-works/pi-ai/providers/xai.models';
import { GOOGLE_MODELS } from '@earendil-works/pi-ai/providers/google.models';
import { KIMI_CODING_MODELS } from '@earendil-works/pi-ai/providers/kimi-coding.models';
import type { Api, Model } from '@earendil-works/pi-ai';
import type { ModelPricing } from '@/types/settings';

export const FALLBACK_CONTEXT_WINDOW = 200_000;

/** 渲染层与 electron/main/agents/pi/model-catalog.ts 同源（tsconfig 隔离无法共享一份） */
const CONTEXT_WINDOWS: Record<string, number> = {};
const CATALOG_SOURCES: Array<Record<string, Model<Api>>> = [
  ANTHROPIC_MODELS,
  OPENAI_MODELS,
  DEEPSEEK_MODELS,
  ZAI_MODELS,
  MOONSHOTAI_MODELS,
  MINIMAX_MODELS,
  QWEN_TOKEN_PLAN_MODELS,
  XAI_MODELS,
  GOOGLE_MODELS,
  KIMI_CODING_MODELS,
];
for (const source of CATALOG_SOURCES) {
  for (const [id, model] of Object.entries(source)) {
    CONTEXT_WINDOWS[id] = model.contextWindow;
  }
}

/** 生效窗口解析链：手填 > 目录查表 > 200K 兜底（与主进程 buildPiModel 保持一致） */
export function resolveModelWindow(entry: { id: string; contextWindow?: number }): number {
  return entry.contextWindow ?? lookupContextWindow(entry.id) ?? FALLBACK_CONTEXT_WINDOW;
}

/** '1M'/'1.5M'/'200K'/'1000000' → token 数（大小写不敏感、忽略首尾空格）；非法或非正数返回 undefined */
export function parseContextInput(input: string): number | undefined {
  const m = /^(\d+(?:\.\d+)?)([kKmM]?)$/.exec(input.trim());
  if (!m) return undefined;
  const multiplier = m[2].toLowerCase() === 'k' ? 1_000 : m[2].toLowerCase() === 'm' ? 1_000_000 : 1;
  const result = Math.round(parseFloat(m[1]) * multiplier);
  return Number.isFinite(result) && result > 0 ? result : undefined;
}

export function lookupContextWindow(modelId: string): number | undefined {
  return CONTEXT_WINDOWS[modelId];
}

/** 已知模型默认价（元/百万 tokens）；目录里没有 glm-5.3 系（用户手填 id），DeepSeek 取空闲档价 */
const MODEL_PRICING: Record<string, ModelPricing> = {
  'glm-5.3': { input: 8, output: 28, cacheRead: 2 },
  'glm-5.3-flash': { input: 0.8, output: 2.8, cacheRead: 0.23 },
  'deepseek-flash': { input: 1, output: 4, cacheRead: 0.02 },
  'deepseek-v4-pro': { input: 4.5, output: 13.5, cacheRead: 0.15 },
};

const PRICING_ALIASES: Record<string, string> = {
  'deepseek-v4.1-flash': 'deepseek-flash',
  'deepseek-v4-flash': 'deepseek-flash',
  'deepseek-v4-pro-0813': 'deepseek-v4-pro',
};

/** 小写并剥尾部上下文变体段，让 'DeepSeek-V4-Pro[1m]' 等价 'deepseek-v4-pro' */
function canonicalPricingId(modelId: string): string {
  return modelId.trim().toLowerCase().replace(/\[[^\]]*\]$/, '');
}

export function lookupPricing(modelId: string): ModelPricing | undefined {
  const id = canonicalPricingId(modelId);
  return MODEL_PRICING[id] ?? MODEL_PRICING[PRICING_ALIASES[id]];
}

/** 204800→'204.8K'，262144→'262.1K'，200000→'200K'，1000000→'1M' */
export function formatContextLabel(window: number): string {
  if (window >= 1_000_000) return `${parseFloat((window / 1_000_000).toFixed(1))}M`;
  return `${parseFloat((window / 1000).toFixed(1))}K`;
}
