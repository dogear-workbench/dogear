import type { AppSettings, ModelProfile, ModelSelection } from '@/types/settings';

export function dedupeProfileTiers(profile: ModelProfile): Array<{ tier: string; modelId: string }> {
  return (profile.piModels ?? []).map((m) => ({ tier: m.id, modelId: m.label ?? m.id }));
}

export function sameSelection(a: ModelSelection | null, b: ModelSelection | null): boolean {
  if (a === null && b === null) return true;
  if (a === null || b === null) return false;
  return a.profileId === b.profileId && a.tier === b.tier;
}

export function resolveModelLabel(settings: AppSettings, selection: ModelSelection): string {
  const profile = settings.profiles[selection.profileId];
  if (!profile) return '已删除的模型';
  const matched = (profile.piModels ?? []).find((m) => m.id === selection.tier);
  return matched ? (matched.label ?? matched.id) : '已删除的模型';
}
