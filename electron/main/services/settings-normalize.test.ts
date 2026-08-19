import { test, expect } from 'bun:test';
import { normalizeSettings, normalizePiModels, migratePiProfiles } from './settings-service.js';
import { normalizeFailoverChain } from './settings-types.js';
import { DEFAULT_SETTINGS, type AppSettings, type ModelProfile } from './settings-types.js';

function baseSettings(): AppSettings {
  return structuredClone(DEFAULT_SETTINGS);
}

function makeProfile(id: string, models: string[]): ModelProfile {
  return {
    id,
    name: id,
    apiKey: 'k',
    baseUrl: 'https://example.com',
    apiTimeoutMs: 3000000,
    piModels: models.map((m) => ({ id: m })),
  };
}

function threeProfiles(): Record<string, ModelProfile> {
  return {
    glm: makeProfile('glm', ['glm-a', 'glm-b']),
    deepseek: makeProfile('deepseek', ['ds-a']),
    proma: makeProfile('proma', ['pr-a', 'pr-b']),
  };
}

test('旧自动执行模式（bypassPermissions/dontAsk/auto/acceptEdits）映射为 autoExecute', () => {
  for (const oldMode of ['bypassPermissions', 'dontAsk', 'auto', 'acceptEdits']) {
    const s = baseSettings();
    (s.ai as Record<string, unknown>).permissionMode = oldMode;
    const changed = normalizeSettings(s);
    expect(changed).toBe(true);
    expect(s.ai.permissionMode).toBe('autoExecute');
  }
});

test('旧 plan 模式映射为 default', () => {
  const s = baseSettings();
  (s.ai as Record<string, unknown>).permissionMode = 'plan';
  normalizeSettings(s);
  expect(s.ai.permissionMode).toBe('default');
});

test('未知模式映射为 default', () => {
  const s = baseSettings();
  (s.ai as Record<string, unknown>).permissionMode = 'something-weird';
  normalizeSettings(s);
  expect(s.ai.permissionMode).toBe('default');
});

test('新模式值保持不变', () => {
  for (const mode of ['default', 'autoExecute'] as const) {
    const s = baseSettings();
    s.ai.permissionMode = mode;
    const changed = normalizeSettings(s);
    expect(changed).toBe(false);
    expect(s.ai.permissionMode).toBe(mode);
  }
});

test('缺失 basicToolPermissions 时生成七项 ask 映射', () => {
  const s = baseSettings();
  delete (s as Record<string, unknown>).basicToolPermissions;
  const changed = normalizeSettings(s);
  expect(changed).toBe(true);
  expect(s.basicToolPermissions).toEqual({
    read: 'ask', write: 'ask', edit: 'ask', bash: 'ask',
    Glob: 'ask', Grep: 'ask', Skill: 'ask',
  });
});

test('额外/无效基础工具键被清理，缺失键补齐', () => {
  const s = baseSettings();
  (s as Record<string, unknown>).basicToolPermissions = {
    read: 'allow',
    write: 'invalid-value',
    bash: 'allow',
    extraKey: 'allow',
  };
  const changed = normalizeSettings(s);
  expect(changed).toBe(true);
  expect(s.basicToolPermissions).toEqual({
    read: 'allow', write: 'ask', edit: 'ask', bash: 'allow',
    Glob: 'ask', Grep: 'ask', Skill: 'ask',
  });
});

test('basicToolPermissions 结构损坏（数组/字符串/null）时恢复为安全默认', () => {
  for (const bad of [[], 'ask', null, 42]) {
    const s = baseSettings();
    (s as Record<string, unknown>).basicToolPermissions = bad;
    normalizeSettings(s);
    expect(s.basicToolPermissions).toEqual({
      read: 'ask', write: 'ask', edit: 'ask', bash: 'ask',
      Glob: 'ask', Grep: 'ask', Skill: 'ask',
    });
  }
});

test('ai 对象结构损坏时恢复为安全默认', () => {
  for (const bad of [null, [], 'string', 42]) {
    const s = baseSettings();
    (s as Record<string, unknown>).ai = bad;
    const changed = normalizeSettings(s);
    expect(changed).toBe(true);
    expect(s.ai.permissionMode).toBe('default');
    expect(s.ai.effort).toBe(null);
  }
});

test('旧 permissionRules 被删除', () => {
  const s = baseSettings();
  (s as Record<string, unknown>).permissionRules = { allow: ['Read', 'Bash'], deny: ['Write'] };
  const changed = normalizeSettings(s);
  expect(changed).toBe(true);
  expect('permissionRules' in s).toBe(false);
});

test('遗留 SDK 设置字段被清理', () => {
  const s = baseSettings();
  const ai = s.ai as Record<string, unknown>;
  ai.maxTurns = 50;
  ai.defaultSystemPrompt = 'test';
  ai.subagentModelTier = 'sonnet';
  ai.excludeDynamicSections = true;
  ai.promptSuggestionsEnabled = true;
  ai.thinkingType = 'adaptive';
  ai.thinkingBudgetTokens = 8000;
  ai.thinkingDisplay = 'summarized';
  const changed = normalizeSettings(s);
  expect(changed).toBe(true);
  for (const field of ['maxTurns', 'defaultSystemPrompt', 'subagentModelTier', 'excludeDynamicSections', 'promptSuggestionsEnabled', 'thinkingType', 'thinkingBudgetTokens', 'thinkingDisplay']) {
    expect(field in s.ai).toBe(false);
  }
});

test('旧 subAgent.permissionMode 被删除', () => {
  const s = baseSettings();
  (s.subAgent as unknown as Record<string, unknown>).permissionMode = 'bypassPermissions';
  const changed = normalizeSettings(s);
  expect(changed).toBe(true);
  expect('permissionMode' in (s.subAgent as unknown as Record<string, unknown>)).toBe(false);
});

test('重复执行规范化不再产生改动（幂等）', () => {
  const s = baseSettings();
  (s.ai as Record<string, unknown>).permissionMode = 'bypassPermissions';
  (s as Record<string, unknown>).permissionRules = { allow: ['Read'] };
  (s.subAgent as unknown as Record<string, unknown>).permissionMode = 'dontAsk';
  normalizeSettings(s);
  const changed2 = normalizeSettings(s);
  expect(changed2).toBe(false);
});

test('规范化不丢失无关的有效设置', () => {
  const s = baseSettings();
  s.ai.permissionMode = 'autoExecute';
  s.subAgent.profiles[0].timeoutMinutes = 60;
  const changed = normalizeSettings(s);
  expect(changed).toBe(false);
  expect(s.subAgent.profiles[0].timeoutMinutes).toBe(60);
});

test('合法的七项 allow 映射保持不变', () => {
  const s = baseSettings();
  s.basicToolPermissions = {
    read: 'allow', write: 'allow', edit: 'allow', bash: 'allow',
    Glob: 'allow', Grep: 'allow', Skill: 'allow',
  };
  const changed = normalizeSettings(s);
  expect(changed).toBe(false);
});

test('旧 subAgent 结构（含 modelSelection/timeoutMinutes/cachePolicy/loadCoreProfile/loadSkills/loadArticleParse）归一化为 profiles', () => {
  const s = baseSettings();
  (s.subAgent as unknown as Record<string, unknown>) = {
    timeoutMinutes: 45,
    cachePolicy: '1h',
    loadCoreProfile: true,
    loadSkills: true,
    loadArticleParse: true,
  };
  const changed = normalizeSettings(s);
  expect(changed).toBe(true);
  expect(s.subAgent.profiles).toHaveLength(1);
  expect(s.subAgent.profiles[0].id).toBe('default');
  expect(s.subAgent.profiles[0].timeoutMinutes).toBe(30);
  expect(s.subAgent.profiles[0].enabledBasicTools).toEqual(['read', 'write', 'edit', 'bash', 'Glob', 'Grep']);
  expect(s.subAgent.profiles[0].enabledAbilities).toEqual({});
  const sub = s.subAgent as unknown as Record<string, unknown>;
  expect('cachePolicy' in sub).toBe(false);
  expect('loadCoreProfile' in sub).toBe(false);
  expect('loadSkills' in sub).toBe(false);
  expect('loadArticleParse' in sub).toBe(false);
});

test('subAgent.profiles 中 profile 缺失 enabledBasicTools 时补全', () => {
  const s = baseSettings();
  s.subAgent.profiles = [{ id: 'p1', name: 'test', description: '', timeoutMinutes: 20 }];
  const changed = normalizeSettings(s);
  expect(changed).toBe(true);
  expect(s.subAgent.profiles[0].enabledBasicTools).toEqual(['read', 'write', 'edit', 'bash', 'Glob', 'Grep']);
  expect(s.subAgent.profiles[0].enabledAbilities).toEqual({});
});

test('subAgent.profiles 结构完整时不产生改动', () => {
  const s = baseSettings();
  const changed = normalizeSettings(s);
  expect(changed).toBe(false);
  expect(s.subAgent.profiles).toHaveLength(1);
  expect(s.subAgent.profiles[0].id).toBe('default');
});

test('subAgent.profiles 为空数组时补全默认 Profile', () => {
  const s = baseSettings();
  s.subAgent.profiles = [];
  const changed = normalizeSettings(s);
  expect(changed).toBe(true);
  expect(s.subAgent.profiles).toHaveLength(1);
  expect(s.subAgent.profiles[0].id).toBe('default');
});

test('normalizePiModels：存量 string[] 迁移为 { id } 对象数组', () => {
  expect(normalizePiModels(['gpt-5', 'glm-4.7'])).toEqual([{ id: 'gpt-5' }, { id: 'glm-4.7' }]);
});

test('normalizePiModels：对象元素保留 id 与合法 label，非法 label 被清洗', () => {
  expect(normalizePiModels([
    { id: 'gpt-5', label: '主力' },
    { id: 'glm-4.7', label: '' },
    { id: 'kimi', label: 42 },
    { id: 'deepseek' },
  ])).toEqual([
    { id: 'gpt-5', label: '主力' },
    { id: 'glm-4.7' },
    { id: 'kimi' },
    { id: 'deepseek' },
  ]);
});

test('normalizePiModels：按 id 去重保首现顺序', () => {
  expect(normalizePiModels([
    'gpt-5',
    { id: 'gpt-5', label: '后出现的重复项' },
    'glm-4.7',
    'gpt-5',
  ])).toEqual([{ id: 'gpt-5' }, { id: 'glm-4.7' }]);
});

test('normalizePiModels：非法元素丢弃，非数组输入返回空数组', () => {
  expect(normalizePiModels([null, 42, '', { label: '没有 id' }, { id: '' }])).toEqual([]);
  expect(normalizePiModels(undefined)).toEqual([]);
  expect(normalizePiModels('not-array')).toEqual([]);
});

test('normalizePiModels：已是规范形状时输出不变（幂等）', () => {
  const input = [{ id: 'gpt-5', label: '主力' }, { id: 'glm-4.7' }];
  expect(normalizePiModels(input)).toEqual(input);
});

test('normalizePiModels：正整数 contextWindow 保留', () => {
  expect(normalizePiModels([{ id: 'glm-5.3', contextWindow: 358400 }])).toEqual([
    { id: 'glm-5.3', contextWindow: 358400 },
  ]);
});

test('normalizePiModels：0 / 负数 / 小数 / 字符串 / NaN 的 contextWindow 丢弃', () => {
  expect(normalizePiModels([
    { id: 'a', contextWindow: 0 },
    { id: 'b', contextWindow: -200000 },
    { id: 'c', contextWindow: 200000.5 },
    { id: 'd', contextWindow: '200000' },
    { id: 'e', contextWindow: NaN },
    { id: 'f', contextWindow: null },
  ])).toEqual([{ id: 'a' }, { id: 'b' }, { id: 'c' }, { id: 'd' }, { id: 'e' }, { id: 'f' }]);
});

test('normalizePiModels：label 与 contextWindow 共存且未手填时字段不写入', () => {
  expect(normalizePiModels([
    { id: 'glm-5.3', label: '主力', contextWindow: 358400 },
    { id: 'gpt-5', label: '备用' },
  ])).toEqual([
    { id: 'glm-5.3', label: '主力', contextWindow: 358400 },
    { id: 'gpt-5', label: '备用' },
  ]);
});

test('normalizePiModels：按 id 去重时首现条目的 contextWindow 生效', () => {
  expect(normalizePiModels([
    { id: 'glm-5.3', contextWindow: 358400 },
    { id: 'glm-5.3', contextWindow: 999 },
    { id: 'glm-5.3' },
  ])).toEqual([{ id: 'glm-5.3', contextWindow: 358400 }]);
});

test('migratePiProfiles：存量 string[] piModels 落盘前迁移为对象数组', () => {
  const s = baseSettings();
  (s.profiles.default as unknown as { piModels: unknown }).piModels = ['gpt-5', 'glm-4.7'];
  const changed = migratePiProfiles(s);
  expect(changed).toBe(true);
  expect(s.profiles.default.piModels).toEqual([{ id: 'gpt-5' }, { id: 'glm-4.7' }]);
});

test('migratePiProfiles：旧三档种子填充产出对象数组', () => {
  const s = baseSettings();
  const p = s.profiles.default as unknown as Record<string, unknown>;
  p.haikuModel = 'm-haiku';
  p.sonnetModel = 'm-sonnet';
  p.opusModel = 'm-sonnet';
  const changed = migratePiProfiles(s);
  expect(changed).toBe(true);
  expect(s.profiles.default.piModels).toEqual([{ id: 'm-haiku' }, { id: 'm-sonnet' }]);
  expect('haikuModel' in p).toBe(false);
});

test('migratePiProfiles：旧 autoCompactWindow 字段被删除', () => {
  const s = baseSettings();
  const p = s.profiles.default as unknown as Record<string, unknown>;
  p.autoCompactWindow = 500000;
  const changed = migratePiProfiles(s);
  expect(changed).toBe(true);
  expect('autoCompactWindow' in p).toBe(false);
});

test('migratePiProfiles：autoCompactPercent 不受迁移影响', () => {
  const s = baseSettings();
  s.profiles.default.piModels = [{ id: 'gpt-5' }];
  s.profiles.default.autoCompactPercent = 90;
  const changed = migratePiProfiles(s);
  expect(changed).toBe(false);
  expect(s.profiles.default.autoCompactPercent).toBe(90);
});

test('migratePiProfiles：已迁移数据二次执行不再产生改动（幂等）', () => {
  const s = baseSettings();
  s.profiles.default.piModels = [{ id: 'gpt-5', label: '主力' }, { id: 'glm-4.7' }];
  const changed = migratePiProfiles(s);
  expect(changed).toBe(false);
});

// ── normalizeFailoverChain ───────────────────────────

test('normalizeFailoverChain：failover 缺失时按 profiles 顺序生成完整链（enabled: false，tier 取首个）', () => {
  const result = normalizeFailoverChain(threeProfiles(), undefined);
  expect(result).toEqual({
    enabled: false,
    chain: [
      { profileId: 'glm', tier: 'glm-a' },
      { profileId: 'deepseek', tier: 'ds-a' },
      { profileId: 'proma', tier: 'pr-a' },
    ],
  });
});

test('normalizeFailoverChain：已有链的 enabled 与顺序保留，新增供应商追加链尾', () => {
  const profiles = threeProfiles();
  const result = normalizeFailoverChain(profiles, {
    enabled: true,
    chain: [{ profileId: 'deepseek', tier: 'ds-a' }, { profileId: 'glm', tier: 'glm-b' }],
  });
  expect(result.enabled).toBe(true);
  expect(result.chain).toEqual([
    { profileId: 'deepseek', tier: 'ds-a' },
    { profileId: 'glm', tier: 'glm-b' },
    { profileId: 'proma', tier: 'pr-a' },
  ]);
});

test('normalizeFailoverChain：已删除的供应商移出链', () => {
  const profiles: Record<string, ModelProfile> = { glm: makeProfile('glm', ['glm-a']) };
  const result = normalizeFailoverChain(profiles, {
    enabled: true,
    chain: [{ profileId: 'glm', tier: 'glm-a' }, { profileId: 'gone', tier: 'x' }],
  });
  expect(result.chain).toEqual([{ profileId: 'glm', tier: 'glm-a' }]);
});

test('normalizeFailoverChain：tier 失效时回退该家 piModels 首个', () => {
  const result = normalizeFailoverChain(threeProfiles(), {
    enabled: false,
    chain: [{ profileId: 'glm', tier: 'not-exist' }],
  });
  expect(result.chain[0]).toEqual({ profileId: 'glm', tier: 'glm-a' });
});

test('normalizeFailoverChain：chain 内 profileId 去重保首现', () => {
  const result = normalizeFailoverChain(threeProfiles(), {
    enabled: false,
    chain: [
      { profileId: 'glm', tier: 'glm-b' },
      { profileId: 'glm', tier: 'glm-a' },
    ],
  });
  expect(result.chain).toEqual([
    { profileId: 'glm', tier: 'glm-b' },
    { profileId: 'deepseek', tier: 'ds-a' },
    { profileId: 'proma', tier: 'pr-a' },
  ]);
});

test('normalizeFailoverChain：piModels 为空的供应商不进链、存量条目被移出', () => {
  const profiles: Record<string, ModelProfile> = {
    glm: makeProfile('glm', ['glm-a']),
    empty: makeProfile('empty', []),
  };
  const result = normalizeFailoverChain(profiles, {
    enabled: false,
    chain: [{ profileId: 'empty', tier: 'x' }],
  });
  expect(result.chain).toEqual([{ profileId: 'glm', tier: 'glm-a' }]);
});

test('normalizeFailoverChain：迁移前的 string[] piModels 也能取到 tier', () => {
  const profiles: Record<string, ModelProfile> = {
    legacy: { ...makeProfile('legacy', []), piModels: ['old-a', 'old-b'] as unknown as ModelProfile['piModels'] },
  };
  const result = normalizeFailoverChain(profiles, undefined);
  expect(result.chain).toEqual([{ profileId: 'legacy', tier: 'old-a' }]);
});

test('normalizeFailoverChain：结构损坏（非对象/缺 profileId/数组 chain）时安全重建', () => {
  for (const bad of [null, 42, 'x', { enabled: 'yes', chain: 'not-array' }] as unknown as Parameters<typeof normalizeFailoverChain>[1][]) {
    const result = normalizeFailoverChain(threeProfiles(), bad);
    expect(result).toEqual({
      enabled: false,
      chain: [
        { profileId: 'glm', tier: 'glm-a' },
        { profileId: 'deepseek', tier: 'ds-a' },
        { profileId: 'proma', tier: 'pr-a' },
      ],
    });
  }
});

test('normalizeFailoverChain：已是规范形状时输出不变（幂等）', () => {
  const input = {
    enabled: true,
    chain: [
      { profileId: 'glm', tier: 'glm-b' },
      { profileId: 'deepseek', tier: 'ds-a' },
      { profileId: 'proma', tier: 'pr-b' },
    ],
  };
  expect(normalizeFailoverChain(threeProfiles(), input)).toEqual(input);
});

test('normalizeSettings：failover 缺失且存在可用供应商时生成链并落盘标记', () => {
  const s = baseSettings();
  s.profiles = threeProfiles();
  const changed = normalizeSettings(s);
  expect(changed).toBe(true);
  expect(s.failover).toEqual({
    enabled: false,
    chain: [
      { profileId: 'glm', tier: 'glm-a' },
      { profileId: 'deepseek', tier: 'ds-a' },
      { profileId: 'proma', tier: 'pr-a' },
    ],
  });
});

test('normalizeSettings：默认设置（无 piModels 供应商）failover 保持空链不产生改动', () => {
  const s = baseSettings();
  const changed = normalizeSettings(s);
  expect(changed).toBe(false);
  expect(s.failover).toEqual({ enabled: false, chain: [] });
});
