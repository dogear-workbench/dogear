import type { ModelProfile, ModelSelection, ModelTier } from '@/types/settings';

const TIER_PRIORITY: ModelTier[] = ['opus', 'sonnet', 'haiku'];

export function dedupeProfileTiers(profile: ModelProfile): Array<{ tier: ModelTier; modelId: string }> {
  const seen = new Set<string>();
  const result: Array<{ tier: ModelTier; modelId: string }> = [];
  for (const tier of TIER_PRIORITY) {
    const modelId = profile[`${tier}Model` as 'haikuModel' | 'sonnetModel' | 'opusModel'];
    if (!modelId || seen.has(modelId)) continue;
    seen.add(modelId);
    result.push({ tier, modelId });
  }
  return result;
}

export function sameSelection(a: ModelSelection | null, b: ModelSelection | null): boolean {
  if (a === null && b === null) return true;
  if (a === null || b === null) return false;
  return a.profileId === b.profileId && a.tier === b.tier;
}
