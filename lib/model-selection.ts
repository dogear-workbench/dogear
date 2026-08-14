import type { ModelProfile, ModelSelection } from '@/types/settings';

export function dedupeProfileTiers(profile: ModelProfile): Array<{ tier: string; modelId: string }> {
  return (profile.piModels ?? []).map((id) => ({ tier: id, modelId: id }));
}

export function sameSelection(a: ModelSelection | null, b: ModelSelection | null): boolean {
  if (a === null && b === null) return true;
  if (a === null || b === null) return false;
  return a.profileId === b.profileId && a.tier === b.tier;
}
