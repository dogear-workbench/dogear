import { createModels, createProvider } from '@earendil-works/pi-ai';
import { anthropicMessagesApi } from '@earendil-works/pi-ai/api/anthropic-messages.lazy';
import { openAIResponsesApi } from '@earendil-works/pi-ai/api/openai-responses.lazy';
import { ANTHROPIC_MODELS } from '@earendil-works/pi-ai/providers/anthropic.models';
import { OPENAI_MODELS } from '@earendil-works/pi-ai/providers/openai.models';
import type { Api, Model, ModelThinkingLevel } from '@earendil-works/pi-ai';
import { FALLBACK_CONTEXT_WINDOW, lookupCatalogEntry } from './model-catalog.js';
import {
  isProfileComplete,
  type AppSettings,
  type ModelProfile,
  type ModelSelection,
  type PiWireApi,
} from '../../services/settings-types.js';

export interface PiModelResult {
  model: Model<Api>;
  profile: ModelProfile;
  tier: string;
  thinkingLevel: ModelThinkingLevel;
}

function resolveWireApi(profile: ModelProfile): PiWireApi {
  return profile.piWireApi ?? 'anthropic-messages';
}

function lookupCatalogModel(wireApi: PiWireApi, modelId: string) {
  // ModelCatalog 的键是字面量联合，按用户传入的 string 查表需要断言成 Record<string, Model<Api>>
  const catalog = (wireApi === 'openai-responses' ? OPENAI_MODELS : ANTHROPIC_MODELS) as Record<string, Model<Api>>;
  const entry = catalog[modelId];
  if (!entry) return undefined;
  return {
    reasoning: entry.reasoning,
    thinkingLevelMap: entry.thinkingLevelMap,
  };
}

function buildPiModel(profile: ModelProfile, entry: { id: string; label?: string; contextWindow?: number; maxTokens?: number; supportsVision?: boolean }): Model<Api> {
  const wireApi = resolveWireApi(profile);
  const catalog = lookupCatalogModel(wireApi, entry.id);
  const catalogEntry = lookupCatalogEntry(entry.id);
  return {
    // pi 直接把 id 当作请求体里的 model 字段发出去，必须是真实模型名
    id: entry.id,
    name: `${profile.name} / ${entry.label ?? entry.id}`,
    api: wireApi,
    provider: profile.id,
    baseUrl: profile.baseUrl,
    reasoning: catalog?.reasoning ?? false,
    thinkingLevelMap: catalog?.thinkingLevelMap,
    input: entry.supportsVision === true ? ['text', 'image'] : ['text'],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: entry.contextWindow ?? catalogEntry?.contextWindow ?? FALLBACK_CONTEXT_WINDOW,
    maxTokens: entry.maxTokens ?? catalogEntry?.maxTokens ?? 8192,
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

  const matched = (profile.piModels ?? []).find(m => m.id === target.tier);
  if (!matched) {
    throw new Error(`模型「${target.tier}」不在方案「${profile.name}」的模型清单里`);
  }

  const model = buildPiModel(profile, matched);
  const thinkingLevel: ModelThinkingLevel = target.effort ?? matched.effort ?? 'off';
  model.reasoning = thinkingLevel !== 'off';
  return { model, profile, tier: target.tier, thinkingLevel };
}

/**
 * 按 profile 构建 pi Provider 并注册到新建的 models 管理器。
 */
export function buildPiModels(profile: ModelProfile) {
  const wireApi = resolveWireApi(profile);
  const api = wireApi === 'openai-responses' ? openAIResponsesApi() : anthropicMessagesApi();
  const models = (profile.piModels ?? []).map((m) => buildPiModel(profile, m));
  const provider = createProvider({
    id: profile.id,
    name: profile.name,
    baseUrl: profile.baseUrl,
    auth: {
      apiKey: {
        name: 'API Key',
        // 0.99.2 resolve 入参为 { ctx, credential?, signal }，静态 key 场景全部忽略
        resolve: async (_input) => ({ auth: { apiKey: profile.apiKey } }),
      },
    },
    models,
    api,
  });
  const piModels = createModels();
  piModels.setProvider(provider);
  return piModels;
}
