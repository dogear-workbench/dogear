import type { AppSettings, EffortLevel, ModelProfile, ModelSelection } from '@/types/settings';

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

/** 与主进程 resolvePiModel 的 thinkingLevel 回退链同源：手调 → 模型方案条目预设；null = 链尽头 off */
export function resolveEffectiveEffort(settings: AppSettings, selection: ModelSelection | null): EffortLevel | null {
  const matched = selection
    ? settings.profiles[selection.profileId]?.piModels?.find((m) => m.id === selection.tier)
    : undefined;
  return selection?.effort ?? matched?.effort ?? null;
}
