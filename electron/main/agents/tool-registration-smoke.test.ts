import { describe, test, expect } from 'bun:test';
// electron/tipc stub 必须最先注册（进程级共享同一份，禁止在本文件再 mock 一份）；真实模块在其后动态加载
import './delegation-test-mocks.js';
import type { PiSessionConfig } from './pi-session/pi-session.js';
import { ABILITY_PACKS, resolveAbilities } from './ability-registry.js';
import { decideToolPermission } from './pi-session/permission-rules.js';
import type { ToolResult } from './pi/tool-adapter.js';
import {
  createDefaultBasicToolPermissions,
  createDefaultSubAgentProfile,
  type SubAgentProfile,
} from '../services/settings-types.js';
import type { WorkspaceConfig } from '../services/workspace-config-service.js';

const { PiSession } = await import('./pi-session/pi-session.js');

type BuiltToolDef = { name: string; deferred?: boolean; handler?: (args: { name: string }) => Promise<ToolResult> };

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

function configWithBrowser(extra: Record<string, boolean> = {}): WorkspaceConfig {
  return {
    ...ALL_OFF,
    abilityOverrides: { ...ALL_OFF.abilityOverrides, browser: true, ...extra },
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
  test('常驻组只剩 dogear-history，自定义 skill 四工具随包不挂载，无协作组、无 extension、无 memory', () => {
    const active = resolveAbilities(ALL_OFF, { role: 'main', hasWorkspace: true, groupId: null });
    expect(active.size).toBe(0);

    const s = makeSession('main');
    const names = builders(s).buildMainAgentToolDefs([], active, [WORKSPACE_PATH]).map((d) => d.name);

    expect(new Set(builders(s).toolPackMap.values())).toEqual(new Set(['dogear-history']));

    expect(names).not.toContain('dogear__SaveSkill');
    expect(names).not.toContain('dogear__GetSkill');
    expect(names).not.toContain('dogear__ListCustomSkills');
    expect(names).not.toContain('dogear__ForgetSkill');
    expect(names).toContain('dogear__ListTopics');
    expect(names).toContain('dogear__SearchSessions');
    expect(names).toContain('dogear__ReadReferenceSession');
    expect(names).not.toContain('dogear__CreateTask');
    expect(names).not.toContain('dogear__ListTasks');

    expect(names.some((n) => n.startsWith('dogear__extension__'))).toBe(false);
    expect(names).not.toContain('dogear__ListGroupFiles');
    expect(names).not.toContain('dogear__ReadGroupBackground');
    expect(names).not.toContain('dogear__UpdateGroupContext');
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

describe('冒烟：扩展通道随 browser-extension 包闸注册', () => {
  test('browser-extension 关 + enabledToolPacks 残留 extension → 静默忽略不注册', () => {
    const active = resolveAbilities(ALL_OFF, { role: 'main', hasWorkspace: true, groupId: null });
    expect(active.has('browser-extension')).toBe(false);
    expect(mainGroups(['extension'], active).has('extension')).toBe(false);
  });

  test('内嵌 browser 包已下线：残留开关键静默忽略，enabledToolPacks 含 browser 不再挂载内嵌工具', () => {
    const active = resolveAbilities(configWithBrowser(), { role: 'main', hasWorkspace: true, groupId: null });
    expect(active.has('browser')).toBe(false);
    expect(active.has('browser-extension')).toBe(false);

    const groups = mainGroups(['browser'], active);
    expect(groups.has('browser')).toBe(false);
    expect(groups.has('extension')).toBe(false);
  });

  test('扩展包开（abilityOverrides.browser-extension=true）→ 只注册扩展、内嵌不注册', () => {
    const active = resolveAbilities(configWithBrowser({ 'browser-extension': true }), { role: 'main', hasWorkspace: true, groupId: null });
    expect(active.has('browser-extension')).toBe(true);

    const groups = mainGroups([], active);
    expect(groups.has('extension')).toBe(true);
    expect(groups.has('browser')).toBe(false);
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

describe('冒烟：子会话 extension 双闸与归属重划拆组（内嵌下线后）', () => {
  test('Profile extension=true → extension 注册；内嵌 browser 组永不出现', () => {
    const profile: SubAgentProfile = {
      ...createDefaultSubAgentProfile(),
      enabledAbilities: { extension: true },
    };
    const active = resolveAbilities(configWithBrowser(), {
      role: 'sub',
      hasWorkspace: true,
      groupId: GROUP_ID,
      profile,
    });
    expect(active.has('browser')).toBe(false);
    expect(active.has('browser-extension')).toBe(true);

    const { groups } = subGroups(profile, active);
    expect(groups.has('extension')).toBe(true);
    expect(groups.has('browser')).toBe(false);
  });

  test('Profile extension 未勾 → extension 不注册（字段闸独立裁决，残留下线 browser 键不影响）', () => {
    const profile: SubAgentProfile = {
      ...createDefaultSubAgentProfile(),
      enabledAbilities: { browser: true } as SubAgentProfile['enabledAbilities'],
    };
    const active = resolveAbilities(configWithBrowser(), {
      role: 'sub',
      hasWorkspace: true,
      groupId: GROUP_ID,
      profile,
    });
    expect(active.has('browser')).toBe(false);
    expect(active.has('browser-extension')).toBe(false);

    const { groups } = subGroups(profile, active);
    expect(groups.has('extension')).toBe(false);
  });

  test('工作区包闸关 + Profile extension=true → 注册（Profile 独裁，不受工作区包闸约束）', () => {
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
    expect(active.has('browser-extension')).toBe(true);

    const { groups } = subGroups(profile, active);
    expect(groups.has('extension')).toBe(true);
    expect(groups.has('browser')).toBe(false);
  });

  test('子会话：协作包开 → 兄弟会话注册（组共识文档工具已退役不注册）', () => {
    const config: WorkspaceConfig = {
      ...ALL_OFF,
      abilityOverrides: { ...ALL_OFF.abilityOverrides, 'agent-collab': true },
    };
    const profile = createDefaultSubAgentProfile();
    const active = resolveAbilities(config, {
      role: 'sub',
      hasWorkspace: true,
      groupId: GROUP_ID,
      profile,
    });
    expect(active.has('agent-collab')).toBe(true);

    const { names } = subGroups(profile, active);
    expect(names).toContain('dogear__ListSiblingSessions');
    expect(names).not.toContain('dogear__UpdateGroupContext');
  });

  test('子会话：协作包关 → 兄弟会话不注册，检索组与固定协作组在（reference 旧子开关被忽略）', () => {
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
    expect(active.has('agent-collab')).toBe(false);

    const { names } = subGroups(profile, active);
    expect(names).not.toContain('dogear__UpdateGroupContext');
    expect(names).not.toContain('dogear__ListSiblingSessions');

    expect(names).toContain('dogear__ListTopics');
    expect(names).toContain('dogear__SearchSessions');
    expect(names).toContain('dogear__ReadReferenceSession');

    expect(names).toContain('dogear__ListGroupFiles');
    expect(names).toContain('dogear__TrackUserActions');
  });

  test('主会话：协作包关 → 协作三组工具不在（组共识文档工具已退役）', () => {
    const active = resolveAbilities(ALL_OFF, { role: 'main', hasWorkspace: true, groupId: GROUP_ID });
    const s = makeSession('main', { groupId: GROUP_ID });
    const names = builders(s).buildMainAgentToolDefs([], active, [WORKSPACE_PATH]).map((d) => d.name);
    expect(names).not.toContain('dogear__UpdateGroupContext');
    expect(names).not.toContain('dogear__ListSiblingSessions');
    expect(names).not.toContain('dogear__ListGroupFiles');
    expect(names).not.toContain('dogear__SaveSharedNote');
  });

  test('主会话：协作包开 → ListSiblingSessions 在、UpdateGroupContext 不在（已退役）', () => {
    const config: WorkspaceConfig = {
      ...ALL_OFF,
      abilityOverrides: { ...ALL_OFF.abilityOverrides, 'agent-collab': true },
    };
    const active = resolveAbilities(config, { role: 'main', hasWorkspace: true, groupId: GROUP_ID });
    const s = makeSession('main', { groupId: GROUP_ID });
    const names = builders(s).buildMainAgentToolDefs([], active, [WORKSPACE_PATH]).map((d) => d.name);
    expect(names).toContain('dogear__ListSiblingSessions');
    expect(names).not.toContain('dogear__UpdateGroupContext');
  });
});

describe('冒烟：git 纪律包拆分（dogear-git 7 工具 / dogear-snapshot 2 工具）', () => {
  const gitNames = [
    'dogear__GitStatus', 'dogear__GitDiff', 'dogear__GitLog', 'dogear__GitShow', 'dogear__GitBlame',
    'dogear__GitCommit', 'dogear__GitRevert',
  ];
  const snapshotNames = ['dogear__GitSnapshotList', 'dogear__GitSnapshotRestore'];

  const bothOn = (): WorkspaceConfig => ({
    ...ALL_OFF,
    abilityOverrides: { ...ALL_OFF.abilityOverrides, 'workspace-git': true, 'workspace-snapshot': true },
  });

  test('有 .git 工作区：两包开 → 两组 9 工具全在', () => {
    const active = resolveAbilities(bothOn(), { role: 'main', hasWorkspace: true, groupId: null, hasUserGitRepo: true });
    expect(active.has('workspace-git')).toBe(true);
    expect(active.has('workspace-snapshot')).toBe(true);

    const s = makeSession('main');
    const names = builders(s).buildMainAgentToolDefs([], active, [WORKSPACE_PATH]).map((d) => d.name);
    expect(new Set(builders(s).toolPackMap.values())).toEqual(new Set(['dogear-git', 'dogear-snapshot', 'dogear-history']));
    for (const n of [...gitNames, ...snapshotNames]) expect(names).toContain(n);
  });

  test('无 .git 工作区（hasUserGitRepo 缺省）：仅快照包生效 → 只注册 dogear-snapshot 2 工具', () => {
    const active = resolveAbilities(bothOn(), { role: 'main', hasWorkspace: true, groupId: null });
    expect(active.has('workspace-git')).toBe(false);
    expect(active.has('workspace-snapshot')).toBe(true);

    const s = makeSession('main');
    const names = builders(s).buildMainAgentToolDefs([], active, [WORKSPACE_PATH]).map((d) => d.name);
    expect(new Set(builders(s).toolPackMap.values())).toEqual(new Set(['dogear-snapshot', 'dogear-history']));
    for (const n of snapshotNames) expect(names).toContain(n);
    for (const n of gitNames) expect(names).not.toContain(n);
  });

  test('子会话：两包开同条件生效（无 Profile 子开关）', () => {
    const profile = createDefaultSubAgentProfile();
    const active = resolveAbilities(bothOn(), {
      role: 'sub',
      hasWorkspace: true,
      groupId: GROUP_ID,
      profile,
      hasUserGitRepo: true,
    });
    expect(active.has('workspace-git')).toBe(true);
    expect(active.has('workspace-snapshot')).toBe(true);

    const { groups, names } = subGroups(profile, active);
    expect(groups.has('dogear-git')).toBe(true);
    expect(groups.has('dogear-snapshot')).toBe(true);
    for (const n of [...gitNames, ...snapshotNames]) expect(names).toContain(n);
  });
});

describe('冒烟：skill-admin 包闸四工具挂载（子会话保持常驻）', () => {
  const SKILL_TOOL_NAMES = ['dogear__SaveSkill', 'dogear__GetSkill', 'dogear__ListCustomSkills', 'dogear__ForgetSkill'];

  test('包开（abilityOverrides.skill-admin=true）→ 主会话挂载四工具', () => {
    const configOn: WorkspaceConfig = {
      ...ALL_OFF,
      abilityOverrides: { ...ALL_OFF.abilityOverrides, 'skill-admin': true },
    };
    const active = resolveAbilities(configOn, { role: 'main', hasWorkspace: true, groupId: null });
    expect(active.has('skill-admin')).toBe(true);

    const s = makeSession('main');
    const names = builders(s).buildMainAgentToolDefs([], active, [WORKSPACE_PATH]).map((d) => d.name);
    expect(new Set(builders(s).toolPackMap.values())).toEqual(new Set(['dogear-skill', 'dogear-history']));
    for (const n of SKILL_TOOL_NAMES) expect(names).toContain(n);
  });

  test('挂载即 deferred：主/子会话四工具均标记按需拉起（不随请求下发）', () => {
    const configOn: WorkspaceConfig = {
      ...ALL_OFF,
      abilityOverrides: { ...ALL_OFF.abilityOverrides, 'skill-admin': true },
    };
    const mainActive = resolveAbilities(configOn, { role: 'main', hasWorkspace: true, groupId: null });
    const sMain = makeSession('main');
    const mainDefs = builders(sMain).buildMainAgentToolDefs([], mainActive, [WORKSPACE_PATH]);
    for (const n of SKILL_TOOL_NAMES) {
      expect(mainDefs.find((d) => d.name === n)?.deferred).toBe(true);
    }

    const profile = createDefaultSubAgentProfile();
    const subActive = resolveAbilities(ALL_OFF, {
      role: 'sub',
      hasWorkspace: true,
      groupId: GROUP_ID,
      profile,
    });
    const { names: subNames } = subGroups(profile, subActive);
    const sSub = makeSession('sub', { groupId: GROUP_ID, subAgentProfile: profile });
    const subDefs = builders(sSub).buildSubAgentToolDefs(profile, [], subActive, [WORKSPACE_PATH]);
    for (const n of SKILL_TOOL_NAMES) {
      expect(subNames).toContain(n);
      expect(subDefs.find((d) => d.name === n)?.deferred).toBe(true);
    }
  });

  test('包关 + enabledToolPacks 残留无影响：无工作区兜底路径只走 memory，四工具不挂载', () => {
    const active = resolveAbilities(ALL_OFF, { role: 'main', hasWorkspace: false, groupId: null });
    expect(active.has('skill-admin')).toBe(false);

    const s = makeSession('main', { workspacePath: undefined });
    const names = builders(s).buildMainAgentToolDefs([], active, [WORKSPACE_PATH]).map((d) => d.name);
    expect(new Set(builders(s).toolPackMap.values())).toEqual(new Set(['dogear-memory']));
    expect(names).not.toContain('dogear__SaveSkill');
    expect(names).not.toContain('dogear__ForgetSkill');
  });

  test('executor 场景：包关（sceneOverride 三级回退默认关）→ 四工具不挂载；场景覆盖开 → 挂载', () => {
    const offActive = resolveAbilities(ALL_OFF, { role: 'main', hasWorkspace: true, groupId: null, sceneOverride: 'executor' });
    expect(offActive.has('skill-admin')).toBe(false);
    const sOff = makeSession('main', { executor: true });
    const offNames = builders(sOff).buildMainAgentToolDefs([], offActive, [WORKSPACE_PATH]).map((d) => d.name);
    expect(offNames).not.toContain('dogear__SaveSkill');

    const sceneOn: WorkspaceConfig = {
      ...ALL_OFF,
      sceneOverrides: { executor: { 'skill-admin': true } },
    };
    const onActive = resolveAbilities(sceneOn, { role: 'main', hasWorkspace: true, groupId: null, sceneOverride: 'executor' });
    expect(onActive.has('skill-admin')).toBe(true);
    const sOn = makeSession('main', { executor: true });
    const onNames = builders(sOn).buildMainAgentToolDefs([], onActive, [WORKSPACE_PATH]).map((d) => d.name);
    expect(onNames).toContain('dogear__SaveSkill');
  });

  test('子会话不受包闸影响：包关也常驻四工具（Profile 独立体系不查包）', () => {
    const profile = createDefaultSubAgentProfile();
    const active = resolveAbilities(ALL_OFF, {
      role: 'sub',
      hasWorkspace: true,
      groupId: GROUP_ID,
      profile,
    });
    expect(active.has('skill-admin')).toBe(false);

    const { groups, names } = subGroups(profile, active);
    expect(groups.has('dogear-skill')).toBe(true);
    for (const n of SKILL_TOOL_NAMES) expect(names).toContain(n);
  });
});

describe('冒烟：主会话 stock/article 五包 deferred + skill 联动挂载', () => {
  const STOCK_ARTICLE_PACKS = ['article', 'stock-quote', 'stock-analysis', 'stock-announcement', 'stock-picking'];
  const configExt = (): WorkspaceConfig => ({
    ...ALL_OFF,
    abilityOverrides: { ...ALL_OFF.abilityOverrides, stock: true, article: true },
  });
  const stubEntry = (name: string): SkillEntryStub => ({
    name,
    description: `stub ${name}`,
    dir: '/tmp/skills',
    bodyPath: `/tmp/skills/${name}/SKILL.md`,
    content: `# ${name} stub`,
  });
  const toolsOfPack = (map: Map<string, string>, pack: string): string[] =>
    [...map.entries()].filter(([, p]) => p === pack).map(([n]) => n);

  test('主会话五包工具均 deferred 且权限走包闸 allow，子会话同包保持常驻', () => {
    const active = resolveAbilities(configExt(), { role: 'main', hasWorkspace: true, groupId: null });
    expect(active.has('stock')).toBe(true);
    expect(active.has('article')).toBe(true);

    const s = makeSession('main', { enabledToolPacks: STOCK_ARTICLE_PACKS });
    const defs = builders(s).buildMainAgentToolDefs([], active, [WORKSPACE_PATH]);
    const map = builders(s).toolPackMap;
    const packTools = STOCK_ARTICLE_PACKS.flatMap((p) => toolsOfPack(map, p));
    expect(packTools.length).toBeGreaterThan(0);
    for (const n of packTools) {
      expect(defs.find((d) => d.name === n)?.deferred).toBe(true);
      expect(decideToolPermission(n, 'default', map, new Set(), createDefaultBasicToolPermissions())).toBe('allow');
    }

    const profile: SubAgentProfile = {
      ...createDefaultSubAgentProfile(),
      enabledAbilities: { ...createDefaultSubAgentProfile().enabledAbilities, stock: true, article: true },
    };
    const subActive = resolveAbilities(configExt(), { role: 'sub', hasWorkspace: true, groupId: GROUP_ID, profile });
    expect(subActive.has('stock')).toBe(true);
    expect(subActive.has('article')).toBe(true);
    const { names: subNames } = subGroups(profile, subActive);
    const sSub = makeSession('sub', { groupId: GROUP_ID, subAgentProfile: profile });
    const subDefs = builders(sSub).buildSubAgentToolDefs(profile, [], subActive, [WORKSPACE_PATH]);
    for (const n of packTools) {
      expect(subNames).toContain(n);
      expect(subDefs.find((d) => d.name === n)?.deferred).toBeUndefined();
    }
  });

  test('skill 映射表构建正确：命中带包 skill 返回 control.addTools，无映射/未启用/子会话不带', async () => {
    const entries = ['stock-analysis', 'stock-picking', 'article-parser', 'brainstorming'].map(stubEntry);
    const active = resolveAbilities(configExt(), { role: 'main', hasWorkspace: true, groupId: null });
    const s = makeSession('main', { enabledToolPacks: STOCK_ARTICLE_PACKS });
    const defs = builders(s).buildMainAgentToolDefs(entries, active, [WORKSPACE_PATH]);
    const map = builders(s).toolPackMap;
    const skillDef = defs.find((d) => d.name === 'Skill');
    expect(skillDef?.handler).toBeDefined();

    const expected = (packs: string[]) => packs.flatMap((p) => toolsOfPack(map, p));
    const hitAnalysis = await skillDef!.handler!({ name: 'stock-analysis' });
    expect(hitAnalysis.control?.addTools).toEqual(expected(['stock-quote', 'stock-analysis', 'stock-announcement']));
    const hitArticle = await skillDef!.handler!({ name: 'article-parser' });
    expect(hitArticle.control?.addTools).toEqual(expected(['article']));
    const hitPlain = await skillDef!.handler!({ name: 'brainstorming' });
    expect('control' in hitPlain).toBe(false);

    const sOff = makeSession('main');
    const defsOff = builders(sOff).buildMainAgentToolDefs(entries, active, [WORKSPACE_PATH]);
    const hitOff = await defsOff.find((d) => d.name === 'Skill')!.handler!({ name: 'stock-analysis' });
    expect('control' in hitOff).toBe(false);

    const profile: SubAgentProfile = {
      ...createDefaultSubAgentProfile(),
      enabledAbilities: { ...createDefaultSubAgentProfile().enabledAbilities, article: true },
    };
    const subActive = resolveAbilities(configExt(), { role: 'sub', hasWorkspace: true, groupId: GROUP_ID, profile });
    const sSub = makeSession('sub', { groupId: GROUP_ID, subAgentProfile: profile });
    const subDefs = builders(sSub).buildSubAgentToolDefs(profile, entries, subActive, [WORKSPACE_PATH]);
    const subSkill = subDefs.find((d) => d.name === 'Skill');
    expect(subSkill?.handler).toBeDefined();
    const hitSub = await subSkill!.handler!({ name: 'article-parser' });
    expect('control' in hitSub).toBe(false);
  });
});

describe('冒烟：主会话 tasks 六件 deferred、notes 六件常驻', () => {
  const TASK_TOOLS = ['dogear__CreateTask', 'dogear__UpdateTask', 'dogear__DeleteTask', 'dogear__ExecuteTask', 'dogear__ListTasks', 'dogear__ReportTaskResult'];
  const NOTE_TOOLS = ['dogear__CreateNote', 'dogear__GetNote', 'dogear__SearchNotes', 'dogear__AppendNote', 'dogear__UpdateNote', 'dogear__DeleteNote'];
  const configNotes = (): WorkspaceConfig => ({
    ...ALL_OFF,
    abilityOverrides: { ...ALL_OFF.abilityOverrides, notes: true },
  });

  test('notes 开：tasks 六件 deferred 且权限走包闸 allow，notes 六件常驻', () => {
    const active = resolveAbilities(configNotes(), { role: 'main', hasWorkspace: true, groupId: null });
    expect(active.has('notes')).toBe(true);

    const s = makeSession('main');
    const defs = builders(s).buildMainAgentToolDefs([], active, [WORKSPACE_PATH]);
    const map = builders(s).toolPackMap;
    for (const n of TASK_TOOLS) {
      expect(defs.find((d) => d.name === n)?.deferred).toBe(true);
      expect(decideToolPermission(n, 'default', map, new Set(), createDefaultBasicToolPermissions())).toBe('allow');
    }
    for (const n of NOTE_TOOLS) {
      expect(defs.find((d) => d.name === n)?.deferred).toBeUndefined();
    }
  });

  test('executor 保底注册：tasks 六件保持常驻（不 defer）', () => {
    const off = resolveAbilities(ALL_OFF, { role: 'main', hasWorkspace: true, groupId: null });
    const s = makeSession('main', { executor: true });
    const defs = builders(s).buildMainAgentToolDefs([], off, [WORKSPACE_PATH]);
    for (const n of TASK_TOOLS) {
      expect(defs.find((d) => d.name === n)?.deferred).toBeUndefined();
    }
  });
});

describe('冒烟：主会话 scheduler 六件 deferred、子会话与 executor 不挂', () => {
  const SCHEDULER_TOOLS = [
    'dogear__ListScheduledTasks',
    'dogear__CreateScheduledTask',
    'dogear__UpdateScheduledTask',
    'dogear__DeleteScheduledTask',
    'dogear__RunScheduledTaskNow',
    'dogear__GetScheduledTaskRuns',
  ];
  const configScheduler = (): WorkspaceConfig => ({
    ...ALL_OFF,
    abilityOverrides: { ...ALL_OFF.abilityOverrides, scheduler: true },
  });

  test('包开：主会话六件 deferred 且权限走包闸 allow', () => {
    const active = resolveAbilities(configScheduler(), { role: 'main', hasWorkspace: true, groupId: null });
    expect(active.has('scheduler')).toBe(true);

    const s = makeSession('main');
    const defs = builders(s).buildMainAgentToolDefs([], active, [WORKSPACE_PATH]);
    const map = builders(s).toolPackMap;
    for (const n of SCHEDULER_TOOLS) {
      expect(defs.find((d) => d.name === n)?.deferred).toBe(true);
      expect(decideToolPermission(n, 'default', map, new Set(), createDefaultBasicToolPermissions())).toBe('allow');
    }
  });

  test('executor 场景包开也不挂载（管理动作归主会话）', () => {
    const active = resolveAbilities(configScheduler(), { role: 'main', hasWorkspace: true, groupId: null, sceneOverride: 'executor' });
    expect(active.has('scheduler')).toBe(true);

    const s = makeSession('main', { executor: true });
    const names = builders(s).buildMainAgentToolDefs([], active, [WORKSPACE_PATH]).map((d) => d.name);
    for (const n of SCHEDULER_TOOLS) expect(names).not.toContain(n);
  });

  test('子会话不挂载（mainOnly 剔除 + 子会话装配不注册该组）', () => {
    const profile = createDefaultSubAgentProfile();
    const active = resolveAbilities(configScheduler(), {
      role: 'sub',
      hasWorkspace: true,
      groupId: GROUP_ID,
      profile,
    });
    expect(active.has('scheduler')).toBe(false);

    const { groups, names } = subGroups(profile, active);
    expect(groups.has('dogear-scheduler')).toBe(false);
    for (const n of SCHEDULER_TOOLS) expect(names).not.toContain(n);
  });
});

describe('冒烟：registry deferredToolGroups 与装配侧一致（防两处真源漂移）', () => {
  test('声明组工具全 deferred，未声明组常驻，声明组全部有工具落地', () => {
    const enabledToolPacks = ['article', 'stock-quote', 'stock-analysis', 'stock-announcement', 'stock-picking', 'web-mcp'];
    const config: WorkspaceConfig = {
      ...ALL_OFF,
      abilityOverrides: Object.fromEntries(ABILITY_PACKS.map((p) => [p.key, true])),
      enabledToolPacks,
    };
    const active = resolveAbilities(config, { role: 'main', hasWorkspace: true, groupId: GROUP_ID, hasUserGitRepo: true });

    const s = makeSession('main', { enabledToolPacks, groupId: GROUP_ID });
    const defs = builders(s).buildMainAgentToolDefs([], active, [WORKSPACE_PATH]);
    const map = builders(s).toolPackMap;

    const declared = new Set(ABILITY_PACKS.flatMap((p) => p.deferredToolGroups ?? []));
    expect(declared.size).toBeGreaterThan(0);
    const seenDeferred = new Set<string>();
    for (const pack of ABILITY_PACKS) {
      for (const gid of pack.toolGroups ?? []) {
        const tools = [...map.entries()].filter(([, p]) => p === gid).map(([n]) => n);
        if (tools.length === 0) continue;
        const expectDeferred = declared.has(gid);
        for (const n of tools) {
          const def = defs.find((d) => d.name === n);
          expect(def).toBeDefined();
          if (expectDeferred) {
            seenDeferred.add(gid);
            expect(def!.deferred).toBe(true);
          } else {
            expect(def!.deferred).toBeUndefined();
          }
        }
      }
    }
    expect(seenDeferred).toEqual(declared);
  });
});
