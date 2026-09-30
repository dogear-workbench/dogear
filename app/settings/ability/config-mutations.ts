import { toast } from 'sonner';
import { client } from '@/lib/client';
import type { WorkspaceConfig } from '@/types/electron-api';
import type { AbilityPackView } from '../../../electron/main/tipc/ability';

export const EMPTY_CONFIG: WorkspaceConfig = { enabledToolPacks: [], enabledSkills: [] };

export type SkillToPacks = Record<string, string[]>;

export function buildSkillToPacks(packs: AbilityPackView[]): SkillToPacks {
  const map: SkillToPacks = {};
  for (const pack of packs) {
    for (const skill of pack.skillMetas) map[skill.name] = skill.toolPacks;
  }
  return map;
}

/** 包总开关联动素材：linkedPackIds 只含可选工具包 id（排除常驻 server 名），与 enabledToolPacks 合法成员一致 */
export interface PackToggleLinks {
  skillNames: string[];
  linkedPackIds: string[];
}

export function packToggleLinksOf(pack: AbilityPackView): PackToggleLinks {
  return {
    skillNames: pack.skillMetas.map((s) => s.name),
    linkedPackIds: pack.toolGroupMetas.filter((g) => g.pack).map((g) => g.id),
  };
}

// 联动语义：开总开关只补齐 enabledSkills/enabledToolPacks 不删；关总开关只写 overrides 不动子开关
export function applyPackToggle(
  config: WorkspaceConfig,
  key: string,
  links: PackToggleLinks | undefined,
  enable: boolean,
): Partial<WorkspaceConfig> {
  const abilityOverrides = { ...config.abilityOverrides, [key]: enable };
  if (!links) return { abilityOverrides };
  if (links.skillNames.length === 0 && links.linkedPackIds.length > 0) {
    const enabledToolPacks = new Set(config.enabledToolPacks);
    for (const id of links.linkedPackIds) {
      if (enable) enabledToolPacks.add(id);
      else enabledToolPacks.delete(id);
    }
    return { abilityOverrides, enabledToolPacks: Array.from(enabledToolPacks) };
  }
  if (links.skillNames.length > 0 && enable) {
    const enabledSkills = new Set(config.enabledSkills);
    const enabledToolPacks = new Set(config.enabledToolPacks);
    for (const name of links.skillNames) enabledSkills.add(name);
    for (const id of links.linkedPackIds) enabledToolPacks.add(id);
    return {
      abilityOverrides,
      enabledSkills: Array.from(enabledSkills),
      enabledToolPacks: Array.from(enabledToolPacks),
    };
  }
  return { abilityOverrides };
}

// 关 skill 时其独占工具包一并下线，仍被其他启用 skill 引用的保留
export function applySkillToggles(
  config: WorkspaceConfig,
  skillToPacks: SkillToPacks,
  names: string[],
  enable: boolean,
): Partial<WorkspaceConfig> {
  if (names.length === 0) return {};
  const enabledSkills = new Set(config.enabledSkills);
  const enabledToolPacks = new Set(config.enabledToolPacks);
  if (enable) {
    for (const name of names) {
      enabledSkills.add(name);
      for (const p of skillToPacks[name] ?? []) enabledToolPacks.add(p);
    }
  } else {
    for (const name of names) enabledSkills.delete(name);
    const keptByOthers = new Set<string>();
    for (const other of enabledSkills) {
      for (const p of skillToPacks[other] ?? []) keptByOthers.add(p);
    }
    for (const name of names) {
      for (const p of skillToPacks[name] ?? []) {
        if (!keptByOthers.has(p)) enabledToolPacks.delete(p);
      }
    }
  }
  return {
    enabledSkills: Array.from(enabledSkills),
    enabledToolPacks: Array.from(enabledToolPacks),
  };
}

export interface ConfigPersisterOptions {
  workspaceId: string | null;
  applyLocal: (patch: Partial<WorkspaceConfig>) => void;
  rollback: (fresh: WorkspaceConfig | null) => void;
  onSaved?: () => void;
}

/** 乐观更新模式：本地先行翻转即时反馈；失败重拉服务端配置回滚（服务端可能已含后续操作，重拉值即真值） */
export function createConfigPersister({
  workspaceId,
  applyLocal,
  rollback,
  onSaved,
}: ConfigPersisterOptions) {
  return async (patch: Partial<WorkspaceConfig>) => {
    if (!workspaceId) return;
    applyLocal(patch);
    try {
      const res = await client.updateWorkspaceConfig({ workspaceId, config: patch });
      if (res && 'config' in res && res.config) {
        onSaved?.();
        return;
      }
      throw new Error(res && 'error' in res ? String(res.error) : '未知错误');
    } catch (e) {
      const fresh = await client.getWorkspaceConfig({ workspaceId });
      rollback(fresh && 'config' in fresh ? (fresh.config ?? EMPTY_CONFIG) : null);
      toast.error('能力配置保存失败，已还原', { description: String(e) });
    }
  };
}
