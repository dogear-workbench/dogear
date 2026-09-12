import { describe, test, expect } from 'bun:test';
import {
  ABILITY_PACKS,
  TOOL_PACK_TO_ABILITY,
  buildProfileAbilityMount,
  resolveAbilities,
  type AbilityPack,
} from './ability-registry.js';
import { createBrowserParseSubAgentProfile, createDefaultSubAgentProfile, type SubAgentProfile } from '../services/settings-types.js';
import type { WorkspaceConfig } from '../services/workspace-config-service.js';

function packOf(key: string): AbilityPack {
  const pack = ABILITY_PACKS.find((p) => p.key === key);
  if (!pack) throw new Error(`包不存在: ${key}`);
  return pack;
}

function profileWith(ab: SubAgentProfile['enabledAbilities'], extra?: Partial<SubAgentProfile>): SubAgentProfile {
  return { ...createDefaultSubAgentProfile(), enabledAbilities: ab, ...extra };
}

describe('buildProfileAbilityMount', () => {
  test('memory 仅 profile.enabledAbilities.memory === true 时可用', () => {
    const pack = packOf('memory');
    expect(buildProfileAbilityMount(pack, profileWith({}))).toMatchObject({ enabled: false });
    expect(buildProfileAbilityMount(pack, profileWith({ memory: true }))).toMatchObject({ enabled: true });
    expect(buildProfileAbilityMount(pack, profileWith({ memory: false }))).toMatchObject({ enabled: false });
  });

  test('stock/article/browser 各自对应能力域开关', () => {
    expect(buildProfileAbilityMount(packOf('stock'), profileWith({ stock: true }))?.enabled).toBe(true);
    expect(buildProfileAbilityMount(packOf('stock'), profileWith({}))?.enabled).toBe(false);
    expect(buildProfileAbilityMount(packOf('article'), profileWith({ article: true }))?.enabled).toBe(true);
    expect(buildProfileAbilityMount(packOf('browser'), profileWith({ browser: true }))?.enabled).toBe(true);
  });

  test('code-workflow 按 skills 白名单交集判定，matchedSkills 只含包内 skill', () => {
    const pack = packOf('code-workflow');
    const none = buildProfileAbilityMount(pack, profileWith({}));
    expect(none?.enabled).toBe(false);
    expect(none?.matchedSkills).toEqual([]);

    const partial = buildProfileAbilityMount(pack, profileWith({ skills: ['brainstorming', 'doc-sync', 'stock-analysis'] }));
    expect(partial?.enabled).toBe(true);
    expect(partial?.matchedSkills.sort()).toEqual(['brainstorming', 'doc-sync']);
  });

  test('无 Profile 细闸的包返回 null（prompt-only / notes / 会话组 / 协作）', () => {
    for (const key of ['workspace-rules', 'global-rules', 'core-profile', 'notes', 'group-context', 'agent-collab']) {
      expect(buildProfileAbilityMount(packOf(key), profileWith({ memory: true, stock: true }))).toBeNull();
    }
  });

  test('profileEnabled 反映 Profile 可见性，enabled 判定不受其影响', () => {
    const mount = buildProfileAbilityMount(packOf('memory'), profileWith({ memory: true }, { enabled: false }));
    expect(mount).toMatchObject({ profileEnabled: false, enabled: true });
  });

  test('内置浏览器解析 Profile 默认 browser 可用、默认 Profile 全不可用', () => {
    expect(buildProfileAbilityMount(packOf('browser'), createBrowserParseSubAgentProfile())?.enabled).toBe(true);
    expect(buildProfileAbilityMount(packOf('browser'), createDefaultSubAgentProfile())?.enabled).toBe(false);
  });
});

describe('resolveAbilities 与 buildProfileAbilityMount 对齐性', () => {
  test('memory/stock/article/browser 四包子会话侧两函数判定一致（工作区总闸全开时）', () => {
    // buildProfileAbilityMount 只表达 Profile 细闸维度（工作区总闸在挂载情况 workspaces 组表达），
    // 所以对齐前提是 abilityOverrides 把四包总闸全开；
    // code-workflow 的 Profile 过滤在运行时位于 skill 级（filterSkillsForSubAgent 的 ab.skills），
    // 不在 resolveAbilities 包级，故不在此对齐范围
    const keys = ['memory', 'stock', 'article', 'browser'] as const;
    const cases: SubAgentProfile['enabledAbilities'][] = [
      {},
      { memory: true },
      { stock: true, article: true },
      { browser: true, skills: ['brainstorming', 'staged-impl'] },
      { memory: true, stock: true, article: true, browser: true, skills: ['doc-sync'] },
    ];
    const config: WorkspaceConfig = {
      enabledToolPacks: [],
      enabledSkills: [],
      abilityOverrides: { memory: true, stock: true, article: true, browser: true },
    };
    for (const ab of cases) {
      const profile = profileWith(ab);
      const active = resolveAbilities(config, {
        role: 'sub',
        hasWorkspace: true,
        groupId: null,
        profile,
      });
      for (const key of keys) {
        const mount = buildProfileAbilityMount(packOf(key), profile);
        expect(active.has(key)).toBe(mount?.enabled ?? false);
      }
    }
  });
});

describe('TOOL_PACK_TO_ABILITY 挂载反查', () => {
  test('包内 toolGroups 全部可反查回所属包', () => {
    for (const pack of ABILITY_PACKS) {
      if (pack.type !== 'skill-packs') continue;
      for (const name of pack.toolGroups ?? []) {
        expect(TOOL_PACK_TO_ABILITY.get(name)).toBe(pack.key);
      }
    }
  });

  test('常驻组 server 名不在反查表中（不属于任务 toolPacksOverride 值域）', () => {
    for (const pack of ABILITY_PACKS) {
      if (pack.type !== 'segment-tools') continue;
      for (const server of pack.toolGroups ?? []) {
        expect(TOOL_PACK_TO_ABILITY.has(server)).toBe(false);
      }
    }
  });
});

describe('工具归属修正（extension 并包 / reference 拆组 / 系统行为收缩）', () => {
  test('browser 包 toolGroups 含内嵌浏览器与扩展通道两个组，扩展通道反查回 browser', () => {
    expect(packOf('browser').toolGroups).toEqual(['browser', 'dogear-extension']);
    expect(TOOL_PACK_TO_ABILITY.get('dogear-extension')).toBe('browser');
  });

  test('SYSTEM_BEHAVIORS 已退役（组上下文归会话组包、契约段归协作包展示）', () => {
    expect(packOf('group-context').segmentKeys).toEqual(['group-context']);
    expect(packOf('agent-collab').segmentKeys).toEqual(['main-agent-delegation', 'sub-agent-contract']);
  });

  test('归属重划：会话组包挂组状态卡组、协作包挂三组且去 reference、笔记包含任务组', () => {
    expect(packOf('group-context').toolGroups).toEqual(['dogear-group-context']);
    expect(packOf('agent-collab').toolGroups).toEqual(['dogear-delegation', 'dogear-group', 'dogear-sibling']);
    expect(packOf('notes').toolGroups).toEqual(['dogear-notes', 'dogear-tasks']);
  });

  test('触发条件：会话组包与协作包属组即生效，无组不生效', () => {
    const config: WorkspaceConfig = { enabledToolPacks: [], enabledSkills: [], abilityOverrides: {} };
    const withGroup = resolveAbilities(config, { role: 'main', hasWorkspace: true, groupId: 'g1' });
    expect(withGroup.has('group-context')).toBe(true);
    expect(withGroup.has('agent-collab')).toBe(true);

    const noGroup = resolveAbilities(config, { role: 'main', hasWorkspace: true, groupId: null });
    expect(noGroup.has('group-context')).toBe(false);
    expect(noGroup.has('agent-collab')).toBe(false);
  });

  test('子会话 reference 旧细闸不再生效：Profile reference=true 不影响包解析', () => {
    const config: WorkspaceConfig = { enabledToolPacks: [], enabledSkills: [], abilityOverrides: {} };
    const profile = profileWith({ reference: true });
    const active = resolveAbilities(config, {
      role: 'sub',
      hasWorkspace: true,
      groupId: 'g1',
      profile,
    });
    expect(active.has('group-context')).toBe(true);
    expect(active.has('agent-collab')).toBe(true);
  });
});
