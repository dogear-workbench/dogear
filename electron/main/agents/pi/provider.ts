import { createModels, createProvider } from '@earendil-works/pi-ai';
import { anthropicMessagesApi } from '@earendil-works/pi-ai/api/anthropic-messages.lazy';
import { openAIResponsesApi } from '@earendil-works/pi-ai/api/openai-responses.lazy';
import { ANTHROPIC_MODELS } from '@earendil-works/pi-ai/providers/anthropic.models';
import { OPENAI_MODELS } from '@earendil-works/pi-ai/providers/openai.models';
import type { Api, Model, ModelThinkingLevel } from '@earendil-works/pi-ai';
import {
  isProfileComplete,
  type AppSettings,
  type ModelProfile,
  type ModelSelection,
} from '../../services/settings-types.js';

export interface PiModelResult {
  model: Model<Api>;
  profile: ModelProfile;
  tier: string;
  thinkingLevel: ModelThinkingLevel;
}

function resolveWireApi(profile: ModelProfile): 'anthropic-messages' | 'openai-responses' {
  return profile.piWireApi ?? 'anthropic-messages';
}

function lookupCatalogModel(wireApi: 'anthropic-messages' | 'openai-responses', modelId: string) {
  // ModelCatalog 的键是字面量联合，按用户传入的 string 查表需要断言成 Record<string, Model<Api>>
  const catalog = (wireApi === 'openai-responses' ? OPENAI_MODELS : ANTHROPIC_MODELS) as Record<string, Model<Api>>;
  const entry = catalog[modelId];
  if (!entry) return undefined;
  return {
    reasoning: entry.reasoning,
    thinkingLevelMap: entry.thinkingLevelMap,
    contextWindow: entry.contextWindow,
    maxTokens: entry.maxTokens,
  };
}

function buildPiModel(profile: ModelProfile, modelId: string, tierOrLabel: string): Model<Api> {
  const wireApi = resolveWireApi(profile);
  const catalog = lookupCatalogModel(wireApi, modelId);
  return {
    // pi 直接把 id 当作请求体里的 model 字段发出去，必须是真实模型名
    id: modelId,
    name: `${profile.name} / ${tierOrLabel}`,
    api: wireApi,
    provider: profile.id,
    baseUrl: profile.baseUrl,
    reasoning: catalog?.reasoning ?? false,
    thinkingLevelMap: catalog?.thinkingLevelMap,
    input: ['text', 'image'],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: catalog?.contextWindow ?? 200_000,
    maxTokens: catalog?.maxTokens ?? 8192,
  };
}

/** 把 ModelSelection 解析为 pi 所需的 Model 描述符 + 配置好的 ModelProfile */
export function resolvePiModel(
  appSettings: AppSettings,
  selection: ModelSelection | null,
  subAgentFallback: ModelSelection | null,
  fallback: ModelSelection | null,
): PiModelResult {
  const target = selection ?? subAgentFallback ?? fallback;
  if (!target) throw new Error('未指定模型，请先在对话或设置中选择模型');

  const profile = appSettings.profiles[target.profileId];
  if (!profile) throw new Error(`模型方案「${target.profileId}」不存在`);
  if (!isProfileComplete(profile)) {
    throw new Error(`模型方案「${profile.name}」配置不完整（缺 API Key / Base URL / 模型清单）`);
  }

  if (!(profile.piModels ?? []).includes(target.tier)) {
    throw new Error(`模型「${target.tier}」不在方案「${profile.name}」的模型清单里`);
  }

  const model = buildPiModel(profile, target.tier, target.tier);
  const thinkingLevel: ModelThinkingLevel = appSettings.ai.effort ?? 'off';
  model.reasoning = thinkingLevel !== 'off';
  return { model, profile, tier: target.tier, thinkingLevel };
}

/**
 * 按 profile 构建 pi Provider 并注册到新建的 models 管理器。
 */
export function buildPiModels(profile: ModelProfile) {
  const wireApi = resolveWireApi(profile);
  const api = wireApi === 'openai-responses' ? openAIResponsesApi() : anthropicMessagesApi();
  const models = (profile.piModels ?? []).map((id) => buildPiModel(profile, id, id));
  const provider = createProvider({
    id: profile.id,
    name: profile.name,
    baseUrl: profile.baseUrl,
    auth: {
      apiKey: {
        name: 'API Key',
        resolve: async () => ({ auth: { apiKey: profile.apiKey } }),
      },
    },
    models,
    api,
  });
  const piModels = createModels();
  piModels.setProvider(provider);
  return piModels;
}
