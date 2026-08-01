import type { ModelProfile, ModelSelection } from '@/types/settings';

const TIER_PRIORITY: Array<'haiku' | 'sonnet' | 'opus'> = ['opus', 'sonnet', 'haiku'];

export function dedupeProfileTiers(profile: ModelProfile): Array<{ tier: string; modelId: string }> {
  const result: Array<{ tier: string; modelId: string }> = [];
  if (profile.apiFormat === 'pi') {
    for (const id of profile.piModels ?? []) {
      result.push({ tier: id, modelId: id });
    }
    return result;
  }
  const seen = new Set<string>();
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
