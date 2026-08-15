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

/** 204800→'204.8K'，262144→'262.1K'，200000→'200K'，1000000→'1M' */
export function formatContextLabel(window: number): string {
  if (window >= 1_000_000) return `${parseFloat((window / 1_000_000).toFixed(1))}M`;
  return `${parseFloat((window / 1000).toFixed(1))}K`;
}
