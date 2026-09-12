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
  buildMainAgentToolDefs(skillEntries: SkillEntryStub[], activeAbilities: Set<string>): BuiltToolDef[];
  buildSubAgentToolDefs(profile: SubAgentProfile, skillEntries: SkillEntryStub[], activeAbilities: Set<string>): BuiltToolDef[];
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
  builders(s).buildMainAgentToolDefs([], activeAbilities);
  return new Set(builders(s).toolPackMap.values());
}

function subGroups(profile: SubAgentProfile, activeAbilities: Set<string>): { groups: Set<string>; names: string[] } {
  const s = makeSession('sub', { groupId: GROUP_ID, subAgentProfile: profile });
  const names = builders(s).buildSubAgentToolDefs(profile, [], activeAbilities).map((d) => d.name);
  return { groups: new Set(builders(s).toolPackMap.values()), names };
}

describe('冒烟：纯净模式（主会话全包关，绑定工作区）', () => {
  test('常驻组只剩 dogear-tasks + dogear-history，无协作组、无 extension、无 memory', () => {
    const active = resolveAbilities(ALL_OFF, { role: 'main', hasWorkspace: true, groupId: null });
    expect(active.size).toBe(0);

    const s = makeSession('main');
    const names = builders(s).buildMainAgentToolDefs([], active).map((d) => d.name);

    expect(new Set(builders(s).toolPackMap.values())).toEqual(new Set(['dogear-tasks', 'dogear-history']));

    expect(names).toContain('dogear__ListTopics');
    expect(names).toContain('dogear__ReadReferenceSession');
    expect(names).toContain('dogear__CreateTask');
    expect(names).toContain('dogear__ListTasks');

    expect(names.some((n) => n.startsWith('dogear__extension__'))).toBe(false);
    expect(names).not.toContain('dogear__ListGroupFiles');
    expect(names).not.toContain('dogear__ReadGroupBackground');
    expect(names).not.toContain('dogear__ListSiblingSessions');
    expect(names).not.toContain('dogear__SaveSharedNote');
  });
});

describe('冒烟：browser 包总闸 gate 主会话 extension', () => {
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

describe('冒烟：子会话 extension 双闸与 reference 拆组', () => {
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

  test('browser 总闸关 + Profile extension=true → 不注册（包闸优先）', () => {
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
    expect(active.has('browser')).toBe(false);

    const { groups } = subGroups(profile, active);
    expect(groups.has('extension')).toBe(false);
  });

  test('reference=false：无组协作引用（dogear-reference），但检索组常驻、固定协作组在', () => {
    const profile = createDefaultSubAgentProfile();
    const active = resolveAbilities(ALL_OFF, {
      role: 'sub',
      hasWorkspace: true,
      groupId: GROUP_ID,
      profile,
    });

    const { names } = subGroups(profile, active);
    expect(names).not.toContain('dogear__ReadGroupBackground');
    expect(names).not.toContain('dogear__ListSiblingSessions');

    expect(names).toContain('dogear__ListTopics');
    expect(names).toContain('dogear__ReadReferenceSession');

    expect(names).toContain('dogear__ListGroupFiles');
    expect(names).toContain('dogear__TrackUserActions');
  });

  test('reference=true：组协作引用两工具注册', () => {
    const profile: SubAgentProfile = {
      ...createDefaultSubAgentProfile(),
      enabledAbilities: { reference: true },
    };
    const active = resolveAbilities(ALL_OFF, {
      role: 'sub',
      hasWorkspace: true,
      groupId: GROUP_ID,
      profile,
    });

    const { names } = subGroups(profile, active);
    expect(names).toContain('dogear__ReadGroupBackground');
    expect(names).toContain('dogear__ListSiblingSessions');
  });
});
