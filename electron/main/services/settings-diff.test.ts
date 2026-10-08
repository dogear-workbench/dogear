import { test, expect } from 'bun:test';
import { diffSettings, isSessionSnapshotAffected, hasSnapshotChange } from './settings-diff.js';
import { DEFAULT_SETTINGS, createDefaultSubAgentProfile, type AppSettings, type ModelProfile, type ModelSelection } from './settings-types.js';

function baseSettings(): AppSettings {
  return structuredClone(DEFAULT_SETTINGS);
}

function makeProfile(id: string): ModelProfile {
  return {
    id,
    name: id,
    apiKey: 'k',
    baseUrl: 'https://example.com',
    apiTimeoutMs: 3000000,
    piModels: [{ id: 'm-a' }, { id: 'm-b' }],
  };
}

const SEL_A: ModelSelection = { profileId: 'default', tier: 'm-a' };
const SEL_B: ModelSelection = { profileId: 'default', tier: 'm-b' };

test('effort / permissionMode / basicToolPermissions 变化各自命中', () => {
  const prev = baseSettings();
  const next = baseSettings();
  next.ai.effort = 'high';
  expect(diffSettings(prev, next).effortChanged).toBe(true);

  const next2 = baseSettings();
  next2.ai.permissionMode = 'autoExecute';
  const diff2 = diffSettings(prev, next2);
  expect(diff2.permissionModeChanged).toBe(true);
  expect(hasSnapshotChange(diff2)).toBe(true);

  const next3 = baseSettings();
  next3.basicToolPermissions = { ...next3.basicToolPermissions, bash: 'allow' };
  expect(diffSettings(prev, next3).basicToolPermissionsChanged).toBe(true);
});

test('profile 快照域字段变化命中，name-only 不命中', () => {
  const prev = baseSettings();
  prev.profiles.p1 = makeProfile('p1');
  const next = baseSettings();
  next.profiles.p1 = { ...makeProfile('p1'), name: '改名' };
  expect(diffSettings(prev, next).changedProfileIds).toEqual([]);

  const next2 = baseSettings();
  next2.profiles.p1 = { ...makeProfile('p1'), apiKey: 'k2' };
  expect(diffSettings(prev, next2).changedProfileIds).toEqual(['p1']);

  const next3 = baseSettings();
  next3.profiles.p1 = { ...makeProfile('p1'), piWireApi: undefined };
  const next4 = baseSettings();
  next4.profiles.p1 = { ...makeProfile('p1'), piWireApi: 'anthropic-messages' };
  expect(diffSettings(next3, next4).changedProfileIds).toEqual([]);

  const next5 = baseSettings();
  next5.profiles.p1 = { ...makeProfile('p1'), autoCompactPercent: undefined };
  const next6 = baseSettings();
  next6.profiles.p1 = { ...makeProfile('p1'), autoCompactPercent: 80 };
  expect(diffSettings(next5, next6).changedProfileIds).toEqual([]);
});

test('profile 新增/删除计入 changedProfileIds', () => {
  const prev = baseSettings();
  const next = baseSettings();
  next.profiles.p1 = makeProfile('p1');
  expect(diffSettings(prev, next).changedProfileIds).toEqual(['p1']);

  const prev2 = baseSettings();
  prev2.profiles.p1 = makeProfile('p1');
  expect(diffSettings(prev2, baseSettings()).changedProfileIds).toEqual(['p1']);
});

test('defaultModelSelection 变化命中', () => {
  const prev = baseSettings();
  prev.ai.defaultModelSelection = SEL_A;
  const next = baseSettings();
  next.ai.defaultModelSelection = SEL_B;
  expect(diffSettings(prev, next).defaultModelSelectionChanged).toBe(true);
});

test('subAgent.profiles：修改入 idsChanged，纯新增不入，删除入', () => {
  const prev = baseSettings();
  prev.subAgent.profiles = [createDefaultSubAgentProfile()];
  const modified = { ...createDefaultSubAgentProfile(), enabledBasicTools: ['read'] };
  const next = baseSettings();
  next.subAgent.profiles = [modified];
  const diff = diffSettings(prev, next);
  expect(diff.subAgentProfilesChanged).toBe(true);
  expect(diff.subAgentProfileIdsChanged).toEqual(['default']);

  const added = { ...createDefaultSubAgentProfile(), id: 'extra', name: 'extra' };
  const next2 = baseSettings();
  next2.subAgent.profiles = [createDefaultSubAgentProfile(), added];
  const diff2 = diffSettings(prev, next2);
  expect(diff2.subAgentProfilesChanged).toBe(true);
  expect(diff2.subAgentProfileIdsChanged).toEqual([]);

  const next3 = baseSettings();
  next3.subAgent.profiles = [];
  const diff3 = diffSettings(prev, next3);
  expect(diff3.subAgentProfileIdsChanged).toEqual(['default']);

  const untouched = diffSettings(prev, structuredClone(prev));
  expect(untouched.subAgentProfilesChanged).toBe(false);
  expect(hasSnapshotChange(untouched)).toBe(false);
});

test('子会话 Profile 的 timeoutMinutes 变化不标脏（派时读取）', () => {
  const prev = baseSettings();
  prev.subAgent.profiles = [createDefaultSubAgentProfile()];
  const next = baseSettings();
  next.subAgent.profiles = [{ ...createDefaultSubAgentProfile(), timeoutMinutes: 60 }];
  const diff = diffSettings(prev, next);
  expect(diff.subAgentProfilesChanged).toBe(false);
});

test('isSessionSnapshotAffected：effort 全员命中', () => {
  const diff = diffSettings(baseSettings(), { ...baseSettings(), ai: { ...baseSettings().ai, effort: 'low' } });
  for (const role of ['main', 'sub'] as const) {
    expect(isSessionSnapshotAffected(diff, { role, configModelSelection: SEL_A, currentModelSelection: SEL_A }, baseSettings())).toBe(true);
  }
});

test('isSessionSnapshotAffected：basicToolPermissions 仅主会话命中', () => {
  const prev = baseSettings();
  const next = baseSettings();
  next.basicToolPermissions = { ...next.basicToolPermissions, read: 'allow' };
  const diff = diffSettings(prev, next);
  expect(isSessionSnapshotAffected(diff, { role: 'main', configModelSelection: SEL_A, currentModelSelection: SEL_A }, next)).toBe(true);
  expect(isSessionSnapshotAffected(diff, { role: 'sub', configModelSelection: SEL_A, currentModelSelection: SEL_A }, next)).toBe(false);
});

test('isSessionSnapshotAffected：生效 profile 变化命中，无关 profile 不命中', () => {
  const prev = baseSettings();
  prev.profiles.p1 = makeProfile('p1');
  prev.profiles.p2 = makeProfile('p2');
  const next = baseSettings();
  next.profiles.p1 = { ...makeProfile('p1'), apiKey: 'k2' };
  next.profiles.p2 = makeProfile('p2');
  const diff = diffSettings(prev, next);
  expect(isSessionSnapshotAffected(diff, { role: 'main', configModelSelection: null, currentModelSelection: { profileId: 'p1', tier: 'm-a' } }, next)).toBe(true);
  expect(isSessionSnapshotAffected(diff, { role: 'main', configModelSelection: null, currentModelSelection: { profileId: 'p2', tier: 'm-a' } }, next)).toBe(false);
});

test('isSessionSnapshotAffected：回退默认模型的会话在默认模型变化时命中，生效值未变则不命中', () => {
  const prev = baseSettings();
  prev.ai.defaultModelSelection = SEL_A;
  const next = baseSettings();
  next.ai.defaultModelSelection = SEL_B;
  const diff = diffSettings(prev, next);
  expect(isSessionSnapshotAffected(diff, { role: 'main', configModelSelection: null, currentModelSelection: SEL_A }, next)).toBe(true);
  expect(isSessionSnapshotAffected(diff, { role: 'main', configModelSelection: SEL_B, currentModelSelection: SEL_B }, next)).toBe(false);

  const sameAsEffective = baseSettings();
  sameAsEffective.ai.defaultModelSelection = SEL_B;
  const prevSame = baseSettings();
  prevSame.ai.defaultModelSelection = SEL_A;
  const diffSame = diffSettings(prevSame, sameAsEffective);
  expect(isSessionSnapshotAffected(diffSame, { role: 'main', configModelSelection: null, currentModelSelection: SEL_B }, sameAsEffective)).toBe(false);
});

test('isSessionSnapshotAffected：子会话仅绑定 profile 变化时命中；主会话任何子 Profile 增删改都命中', () => {
  const prev = baseSettings();
  prev.subAgent.profiles = [createDefaultSubAgentProfile()];
  const next = baseSettings();
  next.subAgent.profiles = [{ ...createDefaultSubAgentProfile(), enabledBasicTools: ['read'] }, { ...createDefaultSubAgentProfile(), id: 'extra', name: 'extra' }];
  const diff = diffSettings(prev, next);
  expect(isSessionSnapshotAffected(diff, { role: 'sub', configModelSelection: null, currentModelSelection: null, subAgentProfileId: 'default' }, next)).toBe(true);
  expect(isSessionSnapshotAffected(diff, { role: 'sub', configModelSelection: null, currentModelSelection: null, subAgentProfileId: 'extra' }, next)).toBe(false);
  expect(isSessionSnapshotAffected(diff, { role: 'main', configModelSelection: null, currentModelSelection: null, subAgentProfileId: undefined }, next)).toBe(true);

  const nextUnchanged = baseSettings();
  const diffUnchanged = diffSettings(prev, nextUnchanged);
  expect(isSessionSnapshotAffected(diffUnchanged, { role: 'sub', configModelSelection: null, currentModelSelection: null, subAgentProfileId: 'default' }, nextUnchanged)).toBe(false);
});
