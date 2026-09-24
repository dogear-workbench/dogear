import { describe, test, expect } from 'bun:test';
// electron/tipc stub 必须最先注册（进程级共享同一份，禁止在本文件再 mock 一份）；真实模块在其后动态加载
import './delegation-test-mocks.js';
import type { PiSessionConfig } from './pi-session/pi-session.js';
import { ABILITY_PACKS, resolveAbilities } from './ability-registry.js';
import {
  createDefaultBasicToolPermissions,
  createDefaultSubAgentProfile,
  type SubAgentProfile,
} from '../services/settings-types.js';
import type { WorkspaceConfig } from '../services/workspace-config-service.js';

const { PiSession } = await import('./pi-session/pi-session.js');

type BuiltToolDef = { name: string };

interface ToolBuilders {
  buildMainAgentToolDefs(skillEntries: SkillEntryStub[], activeAbilities: Set<string>, basePaths: string[]): BuiltToolDef[];
  buildSubAgentToolDefs(profile: SubAgentProfile, skillEntries: SkillEntryStub[], activeAbilities: Set<string>, basePaths: string[]): BuiltToolDef[];
  toolPackMap: Map<string, string>;
}

type SkillEntryStub = Parameters<ToolBuilders['buildMainAgentToolDefs']>[0][number];

const WORKSPACE_PATH = '/tmp/dogear-smoke-ws';
const GROUP_ID = 'group-smoke';

const ALL_OFF: WorkspaceConfig = {
  enabledToolPacks: [],
  enabledSkills: [],
  abilityOverrides: Object.fromEntries(ABILITY_PACKS.map((p) => [p.key, false])),
};

function configWithBrowser(): WorkspaceConfig {
  return {
    ...ALL_OFF,
    abilityOverrides: { ...ALL_OFF.abilityOverrides, browser: true },
  };
}

function makeSession(role: 'main' | 'sub', overrides: Partial<PiSessionConfig> = {}): PiSession {
  return new PiSession(role === 'main' ? 'smoke-main' : 'smoke-sub', {
    conversationId: 'conv-smoke',
    modelSelection: null,
    workspacePath: WORKSPACE_PATH,
    additionalPaths: [],
    workspaceId: 'ws-smoke',
    harnessSessionId: null,
    enabledToolPacks: [],
    role,
    ...(role === 'sub' ? { groupId: GROUP_ID, parentConversationId: 'conv-parent' } : {}),
    permissionMode: 'default',
    basicToolPermissions: createDefaultBasicToolPermissions(),
    ...overrides,
  });
}

function builders(session: PiSession): ToolBuilders {
  return session as unknown as ToolBuilders;
}

function mainGroups(enabledToolPacks: string[], activeAbilities: Set<string>): Set<string> {
  const s = makeSession('main', { enabledToolPacks });
  builders(s).buildMainAgentToolDefs([], activeAbilities, [WORKSPACE_PATH]);
  return new Set(builders(s).toolPackMap.values());
}

function subGroups(profile: SubAgentProfile, activeAbilities: Set<string>): { groups: Set<string>; names: string[] } {
  const s = makeSession('sub', { groupId: GROUP_ID, subAgentProfile: profile });
  const names = builders(s).buildSubAgentToolDefs(profile, [], activeAbilities, [WORKSPACE_PATH]).map((d) => d.name);
  return { groups: new Set(builders(s).toolPackMap.values()), names };
}

describe('冒烟：纯净模式（主会话全包关，绑定工作区）', () => {
  test('常驻组只剩 dogear-history，任务系统随笔记包，无协作组、无 extension、无 memory', () => {
    const active = resolveAbilities(ALL_OFF, { role: 'main', hasWorkspace: true, groupId: null });
    expect(active.size).toBe(0);

    const s = makeSession('main');
    const names = builders(s).buildMainAgentToolDefs([], active, [WORKSPACE_PATH]).map((d) => d.name);

    expect(new Set(builders(s).toolPackMap.values())).toEqual(new Set(['dogear-history']));

    expect(names).toContain('dogear__ListTopics');
    expect(names).toContain('dogear__ReadReferenceSession');
    expect(names).not.toContain('dogear__CreateTask');
    expect(names).not.toContain('dogear__ListTasks');

    expect(names.some((n) => n.startsWith('dogear__extension__'))).toBe(false);
    expect(names).not.toContain('dogear__ListGroupFiles');
    expect(names).not.toContain('dogear__ReadGroupBackground');
    expect(names).not.toContain('dogear__ListSiblingSessions');
    expect(names).not.toContain('dogear__SaveSharedNote');
  });
});

describe('冒烟：notes 包 gate dogear-tasks 与 executor 派单保底', () => {
  test('notes 开 → notes+tasks 两组；关 → 两组全无；executor 关包保底注册申报工具', () => {
    const configOn: WorkspaceConfig = {
      ...ALL_OFF,
      abilityOverrides: { ...ALL_OFF.abilityOverrides, notes: true },
    };
    const on = resolveAbilities(configOn, { role: 'main', hasWorkspace: true, groupId: null });
    const sOn = makeSession('main');
    builders(sOn).buildMainAgentToolDefs([], on, [WORKSPACE_PATH]);
    expect(new Set(builders(sOn).toolPackMap.values())).toEqual(new Set(['dogear-notes', 'dogear-tasks', 'dogear-history']));

    const off = resolveAbilities(ALL_OFF, { role: 'main', hasWorkspace: true, groupId: null });
    const sOff = makeSession('main');
    builders(sOff).buildMainAgentToolDefs([], off, [WORKSPACE_PATH]);
    expect(new Set(builders(sOff).toolPackMap.values())).toEqual(new Set(['dogear-history']));

    const sExec = makeSession('main', { executor: true });
    const execNames = builders(sExec).buildMainAgentToolDefs([], off, [WORKSPACE_PATH]).map((d) => d.name);
    expect(new Set(builders(sExec).toolPackMap.values())).toEqual(new Set(['dogear-tasks', 'dogear-history']));
    expect(execNames).toContain('dogear__ReportTaskResult');
  });
});

describe('冒烟：browser 包总开关 gate 主会话 extension', () => {
  test('browser 关 + enabledToolPacks 残留 extension → 静默忽略不注册', () => {
    const active = resolveAbilities(ALL_OFF, { role: 'main', hasWorkspace: true, groupId: null });
    expect(mainGroups(['extension'], active).has('extension')).toBe(false);
  });

  test('browser 开 + enabledToolPacks 不含 browser → extension 注册、内嵌 browser 不注册', () => {
    const active = resolveAbilities(configWithBrowser(), { role: 'main', hasWorkspace: true, groupId: null });
    expect(active.has('browser')).toBe(true);

    const groups = mainGroups([], active);
    expect(groups.has('extension')).toBe(true);
    expect(groups.has('browser')).toBe(false);
  });

  test('browser 开 + enabledToolPacks 含 browser → 内嵌与扩展两通道都注册', () => {
    const active = resolveAbilities(configWithBrowser(), { role: 'main', hasWorkspace: true, groupId: null });
    const groups = mainGroups(['browser'], active);
    expect(groups.has('browser')).toBe(true);
    expect(groups.has('extension')).toBe(true);
  });
});

describe('冒烟：web-mcp 包双闸与 mainOnly', () => {
  const configWebMcp = (): WorkspaceConfig => ({
    ...ALL_OFF,
    abilityOverrides: { ...ALL_OFF.abilityOverrides, 'web-mcp': true },
  });

  test('包开 + enabledToolPacks 含 web-mcp → 主会话挂载两个工具', () => {
    const active = resolveAbilities(configWebMcp(), { role: 'main', hasWorkspace: true, groupId: null });
    expect(active.has('web-mcp')).toBe(true);

    const s = makeSession('main', { enabledToolPacks: ['web-mcp'] });
    const names = builders(s).buildMainAgentToolDefs([], active, [WORKSPACE_PATH]).map((d) => d.name);
    expect(names).toContain('bigmodel__webSearch');
    expect(names).toContain('bigmodel__webReader');
  });

  test('包开 + enabledToolPacks 不含 web-mcp → 子开关拦住不挂载', () => {
    const active = resolveAbilities(configWebMcp(), { role: 'main', hasWorkspace: true, groupId: null });
    const s = makeSession('main');
    const names = builders(s).buildMainAgentToolDefs([], active, [WORKSPACE_PATH]).map((d) => d.name);
    expect(names).not.toContain('bigmodel__webSearch');
    expect(names).not.toContain('bigmodel__webReader');
  });

  test('包关 + enabledToolPacks 残留 web-mcp → 总开关拦住不挂载', () => {
    const active = resolveAbilities(ALL_OFF, { role: 'main', hasWorkspace: true, groupId: null });
    expect(active.has('web-mcp')).toBe(false);

    const s = makeSession('main', { enabledToolPacks: ['web-mcp'] });
    const names = builders(s).buildMainAgentToolDefs([], active, [WORKSPACE_PATH]).map((d) => d.name);
    expect(names).not.toContain('bigmodel__webSearch');
  });

  test('web-mcp 子会话子开关：default Profile 预勾生效，web 未勾不生效', () => {
    const active = resolveAbilities(configWebMcp(), {
      role: 'sub',
      hasWorkspace: true,
      groupId: GROUP_ID,
      profile: createDefaultSubAgentProfile(),
    });
    expect(active.has('web-mcp')).toBe(true);

    const off = resolveAbilities(configWebMcp(), {
      role: 'sub',
      hasWorkspace: true,
      groupId: GROUP_ID,
      profile: { ...createDefaultSubAgentProfile(), enabledAbilities: { web: false } },
    });
    expect(off.has('web-mcp')).toBe(false);
  });
});

describe('冒烟：子会话 extension 双闸与归属重划拆组', () => {
  test('browser 包开 + Profile extension=true → extension 注册', () => {
    const profile: SubAgentProfile = {
      ...createDefaultSubAgentProfile(),
      enabledAbilities: { browser: true, extension: true },
    };
    const active = resolveAbilities(configWithBrowser(), {
      role: 'sub',
      hasWorkspace: true,
      groupId: GROUP_ID,
      profile,
    });
    expect(active.has('browser')).toBe(true);

    const { groups } = subGroups(profile, active);
    expect(groups.has('extension')).toBe(true);
  });

  test('browser 包开 + Profile extension 未勾 → 不注册（双闸第二道）', () => {
    const profile: SubAgentProfile = {
      ...createDefaultSubAgentProfile(),
      enabledAbilities: { browser: true },
    };
    const active = resolveAbilities(configWithBrowser(), {
      role: 'sub',
      hasWorkspace: true,
      groupId: GROUP_ID,
      profile,
    });
    expect(active.has('browser')).toBe(true);

    const { groups } = subGroups(profile, active);
    expect(groups.has('extension')).toBe(false);
  });

  test('browser 总开关关 + Profile browser/extension=true → 注册（Profile 独裁，不受工作区包闸约束）', () => {
    const profile: SubAgentProfile = {
      ...createDefaultSubAgentProfile(),
      enabledAbilities: { browser: true, extension: true },
    };
    const active = resolveAbilities(ALL_OFF, {
      role: 'sub',
      hasWorkspace: true,
      groupId: GROUP_ID,
      profile,
    });
    expect(active.has('browser')).toBe(true);

    const { groups } = subGroups(profile, active);
    expect(groups.has('extension')).toBe(true);
    expect(groups.has('browser')).toBe(true);
  });

  test('browser 总开关关 + Profile extension=true 但 browser 未勾 → 均不注册（子开关独裁）', () => {
    const profile: SubAgentProfile = {
      ...createDefaultSubAgentProfile(),
      enabledAbilities: { extension: true },
    };
    const active = resolveAbilities(ALL_OFF, {
      role: 'sub',
      hasWorkspace: true,
      groupId: GROUP_ID,
      profile,
    });
    expect(active.has('browser')).toBe(false);

    const { groups } = subGroups(profile, active);
    expect(groups.has('extension')).toBe(false);
  });

  test('子会话：会话组包与协作包开 → 组状态卡与兄弟会话各随其包注册', () => {
    const config: WorkspaceConfig = {
      ...ALL_OFF,
      abilityOverrides: { ...ALL_OFF.abilityOverrides, 'group-context': true, 'agent-collab': true },
    };
    const profile = createDefaultSubAgentProfile();
    const active = resolveAbilities(config, {
      role: 'sub',
      hasWorkspace: true,
      groupId: GROUP_ID,
      profile,
    });
    expect(active.has('group-context')).toBe(true);
    expect(active.has('agent-collab')).toBe(true);

    const { groups, names } = subGroups(profile, active);
    expect(groups.has('dogear-group-context')).toBe(true);
    expect(groups.has('dogear-sibling')).toBe(true);
    expect(names).toContain('dogear__ReadGroupBackground');
    expect(names).toContain('dogear__ListSiblingSessions');
  });

  test('子会话：两包全关 → 两工具不注册，检索组与固定协作组在（reference 旧子开关被忽略）', () => {
    const profile: SubAgentProfile = {
      ...createDefaultSubAgentProfile(),
      enabledAbilities: { reference: true } as SubAgentProfile['enabledAbilities'],
    };
    const active = resolveAbilities(ALL_OFF, {
      role: 'sub',
      hasWorkspace: true,
      groupId: GROUP_ID,
      profile,
    });
    expect(active.has('group-context')).toBe(false);
    expect(active.has('agent-collab')).toBe(false);

    const { names } = subGroups(profile, active);
    expect(names).not.toContain('dogear__ReadGroupBackground');
    expect(names).not.toContain('dogear__ListSiblingSessions');

    expect(names).toContain('dogear__ListTopics');
    expect(names).toContain('dogear__ReadReferenceSession');

    expect(names).toContain('dogear__ListGroupFiles');
    expect(names).toContain('dogear__TrackUserActions');
  });

  test('主会话：会话组包开协作关 → ReadGroupBackground 在、ListSiblingSessions 与共享区不在', () => {
    const config: WorkspaceConfig = {
      ...ALL_OFF,
      abilityOverrides: { ...ALL_OFF.abilityOverrides, 'group-context': true },
    };
    const active = resolveAbilities(config, { role: 'main', hasWorkspace: true, groupId: GROUP_ID });
    const s = makeSession('main', { groupId: GROUP_ID });
    const names = builders(s).buildMainAgentToolDefs([], active, [WORKSPACE_PATH]).map((d) => d.name);
    expect(names).toContain('dogear__ReadGroupBackground');
    expect(names).not.toContain('dogear__ListSiblingSessions');
    expect(names).not.toContain('dogear__ListGroupFiles');
    expect(names).not.toContain('dogear__SaveSharedNote');
  });

  test('主会话：协作包开会话组包关 → ListSiblingSessions 在、ReadGroupBackground 不在', () => {
    const config: WorkspaceConfig = {
      ...ALL_OFF,
      abilityOverrides: { ...ALL_OFF.abilityOverrides, 'agent-collab': true },
    };
    const active = resolveAbilities(config, { role: 'main', hasWorkspace: true, groupId: GROUP_ID });
    const s = makeSession('main', { groupId: GROUP_ID });
    const names = builders(s).buildMainAgentToolDefs([], active, [WORKSPACE_PATH]).map((d) => d.name);
    expect(names).toContain('dogear__ListSiblingSessions');
    expect(names).not.toContain('dogear__ReadGroupBackground');
  });
});
