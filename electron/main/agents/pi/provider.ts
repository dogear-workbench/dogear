import { createModels, createProvider } from '@earendil-works/pi-ai';
import { anthropicMessagesApi } from '@earendil-works/pi-ai/api/anthropic-messages.lazy';
import type { Model } from '@earendil-works/pi-ai';
import {
  isProfileComplete,
  type AppSettings,
  type ModelProfile,
  type ModelSelection,
  type ModelTier,
} from '../../services/settings-types.js';

export interface PiModelResult {
  model: Model<'anthropic-messages'>;
  profile: ModelProfile;
  tier: ModelTier;
}

function buildPiModel(profile: ModelProfile, modelId: string, tier: ModelTier): Model<'anthropic-messages'> {
  return {
    // pi 直接把 id 当作请求体里的 model 字段发出去，必须是真实模型名
    id: modelId,
    name: `${profile.name} / ${tier}`,
    api: 'anthropic-messages',
    provider: profile.id,
    baseUrl: profile.baseUrl,
    reasoning: false,
    input: ['text', 'image'],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 200_000,
    maxTokens: 8192,
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
    throw new Error(`模型方案「${profile.name}」配置不完整（缺 API Key / Base URL / 模型映射）`);
  }

  const tierMap: Record<ModelTier, string> = {
    haiku: profile.haikuModel,
    sonnet: profile.sonnetModel,
    opus: profile.opusModel,
  };
  const model = buildPiModel(profile, tierMap[target.tier], target.tier);
  return { model, profile, tier: target.tier };
}

/**
 * 按 profile 构建 pi Provider 并注册到新建的 models 管理器。
 * disableNonessentialTraffic / autoCompactWindow / subagentModelTier 是 claude CLI 的环境变量，
 * pi 运行时不使用，迁移完成后统一清理。
 */
export function buildPiModels(profile: ModelProfile) {
  const api = anthropicMessagesApi();
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
    models: [
      buildPiModel(profile, profile.haikuModel, 'haiku'),
      buildPiModel(profile, profile.sonnetModel, 'sonnet'),
      buildPiModel(profile, profile.opusModel, 'opus'),
    ],
    api,
  });
  const models = createModels();
  models.setProvider(provider);
  return models;
}
