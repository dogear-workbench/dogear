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

export interface ModelCatalogEntry {
  contextWindow: number;
  maxTokens?: number;
}

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

/** 全厂商目录合并查表；同 ID 跨目录 contextWindow 取值一致，后写覆盖无碍 */
export const MODEL_CATALOG: Record<string, ModelCatalogEntry> = {};
for (const source of CATALOG_SOURCES) {
  for (const [id, model] of Object.entries(source)) {
    MODEL_CATALOG[id] = { contextWindow: model.contextWindow, maxTokens: model.maxTokens };
  }
}

export const FALLBACK_CONTEXT_WINDOW = 200_000;

export function lookupContextWindow(modelId: string): number | undefined {
  return MODEL_CATALOG[modelId]?.contextWindow;
}

export function lookupCatalogEntry(modelId: string): ModelCatalogEntry | undefined {
  return MODEL_CATALOG[modelId];
}
