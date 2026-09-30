import { describe, test, expect } from 'bun:test';
import {
  ABILITY_PACKS,
  SUB_AUTONOMOUS_SKILLS,
  TOOL_PACK_TO_ABILITY,
  resolveAbilities,
  scenePackEnabled,
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

describe('resolveAbilities 子会话 Profile 过滤', () => {
  test('stock/article/browser 子开关为 true 才生效；memory 归场景层不再受 Profile 闸约束；code-workflow 包级不过滤（skill 级运行时过滤）', () => {
    // 自治三包总开关在 abilityOverrides 全开，判定纯由子开关决定；
    // code-workflow 的 Profile 过滤在运行时位于 skill 级（filterSkillsForSubAgent 的 ab.skills），不在包级
    const keys = ['stock', 'article', 'browser'] as const;
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
      abilityOverrides: { memory: true, stock: true, article: true, browser: true, 'code-workflow': true },
    };
    for (const ab of cases) {
      const active = resolveAbilities(config, {
        role: 'sub',
        hasWorkspace: true,
        groupId: null,
        profile: profileWith(ab),
      });
      for (const key of keys) {
        expect(active.has(key)).toBe(ab[key] === true);
      }
      expect(active.has('memory')).toBe(true);
      expect(active.has('code-workflow')).toBe(true);
    }
  });

  test('web-mcp 子会话子开关：profile.web 显式 true 才生效，main 不受 Profile 约束', () => {
    const config: WorkspaceConfig = { enabledToolPacks: [], enabledSkills: [], abilityOverrides: { 'web-mcp': true } };
    expect(resolveAbilities(config, { role: 'sub', hasWorkspace: true, groupId: null, profile: profileWith({ web: true }) }).has('web-mcp')).toBe(true);
    expect(resolveAbilities(config, { role: 'sub', hasWorkspace: true, groupId: null, profile: profileWith({}) }).has('web-mcp')).toBe(false);
    expect(resolveAbilities(config, { role: 'sub', hasWorkspace: true, groupId: null, profile: profileWith({ web: false }) }).has('web-mcp')).toBe(false);
    expect(resolveAbilities(config, { role: 'main', hasWorkspace: true, groupId: null }).has('web-mcp')).toBe(true);
  });

  test('profile 停用不影响包级判定（可见性在派遣侧控制）；存量 memory 子开关残留被忽略', () => {
    const active = resolveAbilities(
      { enabledToolPacks: [], enabledSkills: [], abilityOverrides: {} },
      { role: 'sub', hasWorkspace: true, groupId: null, profile: profileWith({ memory: false }, { enabled: false }) },
    );
    expect(active.has('memory')).toBe(true);
  });

  test('内置浏览器解析 Profile 默认 browser 生效、默认 Profile 不生效', () => {
    const config: WorkspaceConfig = { enabledToolPacks: [], enabledSkills: [], abilityOverrides: { browser: true } };
    expect(resolveAbilities(config, { role: 'sub', hasWorkspace: true, groupId: null, profile: createBrowserParseSubAgentProfile() }).has('browser')).toBe(true);
    expect(resolveAbilities(config, { role: 'sub', hasWorkspace: true, groupId: null, profile: createDefaultSubAgentProfile() }).has('browser')).toBe(false);
  });
});

describe('sceneOverrides 场景三级回退', () => {
  const base: WorkspaceConfig = { enabledToolPacks: [], enabledSkills: [] };

  test('sceneOverrides 覆盖优先于 abilityOverrides', () => {
    const config: WorkspaceConfig = {
      ...base,
      abilityOverrides: { memory: false },
      sceneOverrides: { sub: { memory: true } },
    };
    const active = resolveAbilities(config, { role: 'sub', hasWorkspace: true, groupId: null, profile: null, sceneOverride: 'sub' });
    expect(active.has('memory')).toBe(true);
  });

  test('恢复默认：无 sceneOverrides 键（或空对象）回落工作区总闸', () => {
    const opts = { role: 'sub', hasWorkspace: true, groupId: null, profile: null, sceneOverride: 'sub' } as const;
    expect(resolveAbilities({ ...base, abilityOverrides: { memory: false } }, opts).has('memory')).toBe(false);
    expect(resolveAbilities({ ...base, abilityOverrides: { memory: false }, sceneOverrides: {} }, opts).has('memory')).toBe(false);
  });

  test('scenePackEnabled 三级回退：场景覆盖 → 工作区总闸 → defaultEnabled', () => {
    const pack = packOf('memory');
    expect(scenePackEnabled(pack, { ...base, sceneOverrides: { scheduler: { memory: false } } }, 'scheduler')).toBe(false);
    expect(scenePackEnabled(pack, { ...base, abilityOverrides: { memory: false } }, 'scheduler')).toBe(false);
    expect(scenePackEnabled(pack, base, 'scheduler')).toBe(true);
  });

  test('sub 角色 memory 不再受 Profile 闸影响：Profile 无 memory 字段也按场景闸（defaultEnabled=true）生效', () => {
    const config: WorkspaceConfig = { ...base, abilityOverrides: {} };
    const active = resolveAbilities(config, { role: 'sub', hasWorkspace: true, groupId: null, profile: profileWith({}) });
    expect(active.has('memory')).toBe(true);
  });

  test('sceneOverride 不解除场景代码条件：scheduler 场景下 mainOnly/role 条件包仍被排除，prompt-only 包覆盖关闭生效', () => {
    const config: WorkspaceConfig = {
      ...base,
      sceneOverrides: { scheduler: { shunt: true, notes: true, 'workspace-rules': false } },
    };
    const active = resolveAbilities(config, { role: 'sub', hasWorkspace: true, groupId: 'g1', profile: null, sceneOverride: 'scheduler' });
    expect(active.has('shunt')).toBe(false);
    expect(active.has('notes')).toBe(false);
    expect(active.has('workspace-rules')).toBe(false);
  });
});

describe('自治包四象限（main/sub × 工作区开关/Profile 子开关）', () => {
  const AUTONOMOUS_KEYS = ['stock', 'article', 'browser', 'web-mcp'] as const;
  const wsOverrides = (on: boolean) => ({
    enabledToolPacks: [],
    enabledSkills: [],
    abilityOverrides: Object.fromEntries(AUTONOMOUS_KEYS.map((key) => [key, on])),
  });
  const profileAllOn = profileWith({ stock: true, article: true, browser: true, web: true });

  test('工作区关 + Profile 开：sub 生效（Profile 独裁），main 不生效（纯主会话开关）', () => {
    const config: WorkspaceConfig = wsOverrides(false);
    for (const key of AUTONOMOUS_KEYS) {
      expect(resolveAbilities(config, { role: 'sub', hasWorkspace: true, groupId: null, profile: profileAllOn }).has(key)).toBe(true);
      expect(resolveAbilities(config, { role: 'main', hasWorkspace: true, groupId: null }).has(key)).toBe(false);
    }
  });

  test('工作区开 + Profile 关：sub 不生效（子开关独裁），main 生效', () => {
    const config: WorkspaceConfig = wsOverrides(true);
    const profileOff = profileWith({});
    for (const key of AUTONOMOUS_KEYS) {
      expect(resolveAbilities(config, { role: 'sub', hasWorkspace: true, groupId: null, profile: profileOff }).has(key)).toBe(false);
      expect(resolveAbilities(config, { role: 'main', hasWorkspace: true, groupId: null }).has(key)).toBe(true);
    }
  });

  test('sub 无 profile：自治包全部不生效（无授权即无能力）', () => {
    const config: WorkspaceConfig = wsOverrides(false);
    for (const key of AUTONOMOUS_KEYS) {
      expect(resolveAbilities(config, { role: 'sub', hasWorkspace: true, groupId: null, profile: null }).has(key)).toBe(false);
    }
  });

  test('自治标记与 skill 全集：四包置位且 SUB_AUTONOMOUS_SKILLS 恰含五 skill', () => {
    expect(ABILITY_PACKS.filter((p) => p.subAutonomous).map((p) => p.key)).toEqual([...AUTONOMOUS_KEYS]);
    expect([...SUB_AUTONOMOUS_SKILLS].sort()).toEqual(
      ['article-parser', 'browser-exploration', 'stock-analysis', 'stock-picking'].sort(),
    );
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

  test('子会话 reference 旧子开关不再生效：旧配置残留 reference=true 不影响包解析', () => {
    const config: WorkspaceConfig = { enabledToolPacks: [], enabledSkills: [], abilityOverrides: {} };
    const profile = profileWith({ reference: true } as SubAgentProfile['enabledAbilities']);
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
