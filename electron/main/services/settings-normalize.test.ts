import { test, expect } from 'bun:test';
import { normalizeSettings, normalizePiModels, migratePiProfiles } from './settings-service.js';
import { normalizeFailoverChain, normalizePaymentBlockedHosts } from './settings-types.js';
import {
  DEFAULT_SETTINGS,
  createDefaultSubAgentProfile,
  createBrowserParseSubAgentProfile,
  createExploreSubAgentProfile,
  createStockSubAgentProfile,
  type AppSettings,
  type ModelProfile,
  type SubAgentProfile,
} from './settings-types.js';

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

test('存量 stateModelSelection 键剥离（话题状态卡退役残留）', () => {
  const s = baseSettings();
  (s.ai as Record<string, unknown>).stateModelSelection = { profileId: 'glm', modelId: 'glm-a' };
  const changed = normalizeSettings(s);
  expect(changed).toBe(true);
  expect('stateModelSelection' in s.ai).toBe(false);
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

test('appearance 非法结构重置，非法 theme 回退 light，合法值保持', () => {
  const s1 = baseSettings();
  (s1 as Record<string, unknown>).appearance = 'dark';
  expect(normalizeSettings(s1)).toBe(true);
  expect(s1.appearance).toEqual({ theme: 'light' });

  const s2 = baseSettings();
  (s2.appearance as { theme: string }).theme = 'blue';
  expect(normalizeSettings(s2)).toBe(true);
  expect(s2.appearance?.theme).toBe('light');

  const s3 = baseSettings();
  s3.appearance = { theme: 'system' };
  expect(normalizeSettings(s3)).toBe(false);
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
  }
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

test('subAgent.profiles 中 profile 缺失 enabledBasicTools 时补全', () => {
  const s = baseSettings();
  s.subAgent.profiles = [{ id: 'p1', name: 'test', description: '', timeoutMinutes: 20 }];
  const changed = normalizeSettings(s);
  expect(changed).toBe(true);
  expect(s.subAgent.profiles[0].enabledBasicTools).toEqual(['read', 'write', 'edit', 'bash', 'Glob', 'Grep']);
  expect(s.subAgent.profiles[0].enabledAbilities).toEqual({});
});

test('subAgent.profiles 结构完整时不产生改动（四内置齐全）', () => {
  const s = baseSettings();
  const changed = normalizeSettings(s);
  expect(changed).toBe(false);
  expect(s.subAgent.profiles.map((p) => p.id)).toEqual(['default', 'browser-parse', 'explore', 'stock']);
});

test('subAgent.profiles 为空数组时补全四内置预设', () => {
  const s = baseSettings();
  s.subAgent.profiles = [];
  const changed = normalizeSettings(s);
  expect(changed).toBe(true);
  expect(s.subAgent.profiles.map((p) => p.id)).toEqual(['default', 'browser-parse', 'explore', 'stock']);
});

test('缺失内置预设时自动补齐，已有自定义 Profile 保留且幂等', () => {
  const s = baseSettings();
  s.subAgent.profiles = [{ id: 'p1', name: '自定义', description: '', timeoutMinutes: 15, enabledBasicTools: ['read'], enabledAbilities: {} }];
  const changed = normalizeSettings(s);
  expect(changed).toBe(true);
  expect(s.subAgent.profiles).toHaveLength(5);
  expect(s.subAgent.profiles[0]).toEqual({ id: 'p1', name: '自定义', description: '', timeoutMinutes: 15, enabledBasicTools: ['read'], enabledAbilities: {} });
  expect(s.subAgent.profiles.slice(1).map((p) => p.id)).toEqual(['default', 'browser-parse', 'explore', 'stock']);
  expect(s.subAgent.profiles[2]!.enabledAbilities).toEqual({ web: true, extension: true, article: true });
  expect(normalizeSettings(s)).toBe(false);
});

test('内置条目文案无条件刷成模板版（含用户自定义过的）', () => {
  const s = baseSettings();
  s.subAgent.profiles[0]!.name = '我的默认';
  s.subAgent.profiles[0]!.description = '我自己的默认描述';
  s.subAgent.profiles[1]!.description = '我自己的浏览器解析描述';
  const changed = normalizeSettings(s);
  expect(changed).toBe(true);
  expect(s.subAgent.profiles[0]!.name).toBe('默认');
  expect(s.subAgent.profiles[0]!.description).toBe(createDefaultSubAgentProfile().description);
  expect(s.subAgent.profiles[1]!.description).toBe(createBrowserParseSubAgentProfile().description);
  expect(normalizeSettings(s)).toBe(false);
});

test('收编映射：同名自建「探索」条目改挂内置 slug，配置字段继承、文案接管', () => {
  const s = baseSettings();
  const legacyExplore: SubAgentProfile = {
    id: '94132af8-e2f4-40b3-a070-f5cb72323074',
    name: '探索',
    description: '旧版自建描述',
    modelSelection: { profileId: 'default', tier: 'glm-5.3' },
    timeoutMinutes: 45,
    enabledBasicTools: ['read', 'bash', 'Glob', 'Grep'],
    enabledAbilities: { reference: true, memory: true, extension: false, web: true },
  };
  s.subAgent.profiles = [s.subAgent.profiles[0]!, s.subAgent.profiles[1]!, legacyExplore];
  const changed = normalizeSettings(s);
  expect(changed).toBe(true);
  const adopted = s.subAgent.profiles.find((p) => p.id === 'explore')!;
  expect(adopted.description).toBe(createExploreSubAgentProfile().description);
  expect(adopted.modelSelection).toEqual({ profileId: 'default', tier: 'glm-5.3' });
  expect(adopted.timeoutMinutes).toBe(45);
  expect(adopted.enabledBasicTools).toEqual(['read', 'bash', 'Glob', 'Grep']);
  expect(adopted.enabledAbilities).toEqual({ reference: true, memory: true, extension: false, web: true });
  expect(s.subAgent.profiles.some((p) => p.id === '94132af8-e2f4-40b3-a070-f5cb72323074')).toBe(false);
  expect(s.subAgent.profiles.map((p) => p.id)).toEqual(['default', 'browser-parse', 'explore', 'stock']);
  expect(normalizeSettings(s)).toBe(false);
});

test('收编映射：同名自建「股票」条目继承停用与能力域，文案接管', () => {
  const s = baseSettings();
  const legacyStock: SubAgentProfile = {
    id: 'cafd7e16-88d6-4d8b-81aa-b09a2f5f0354',
    name: '股票',
    description: '旧版股票描述',
    modelSelection: { profileId: 'default', tier: 'glm-5.3' },
    timeoutMinutes: 30,
    enabled: false,
    enabledBasicTools: ['read', 'write', 'edit', 'bash', 'Glob', 'Grep'],
    enabledAbilities: { stock: true },
  };
  s.subAgent.profiles = [s.subAgent.profiles[0]!, legacyStock];
  normalizeSettings(s);
  const adopted = s.subAgent.profiles.find((p) => p.id === 'stock')!;
  expect(adopted.description).toBe(createStockSubAgentProfile().description);
  expect(adopted.enabled).toBe(false);
  expect(adopted.enabledAbilities).toEqual({ stock: true });
  expect(s.subAgent.profiles.some((p) => p.id === 'cafd7e16-88d6-4d8b-81aa-b09a2f5f0354')).toBe(false);
  expect(normalizeSettings(s)).toBe(false);
});

test('收编幂等保护：内置 slug 已在场时，同名自定义条目不被收编', () => {
  const s = baseSettings();
  const twin: SubAgentProfile = {
    id: 'twin-uuid',
    name: '探索',
    description: '另一个探索',
    timeoutMinutes: 20,
    enabledBasicTools: ['read'],
    enabledAbilities: {},
  };
  s.subAgent.profiles = [...s.subAgent.profiles, twin];
  const changed = normalizeSettings(s);
  expect(changed).toBe(false);
  const twinAfter = s.subAgent.profiles.find((p) => p.id === 'twin-uuid')!;
  expect(twinAfter.name).toBe('探索');
  expect(twinAfter.description).toBe('另一个探索');
});

test('内置能力域只补缺失键，显式 false 不动（配置自治）', () => {
  const s = baseSettings();
  s.subAgent.profiles[1]!.enabledAbilities = { web: true, extension: false };
  const changed = normalizeSettings(s);
  expect(changed).toBe(true);
  expect(s.subAgent.profiles[1]!.enabledAbilities).toEqual({ web: true, extension: false, article: true });
  expect(normalizeSettings(s)).toBe(false);
});

test('内嵌浏览器下线迁移：browser 键一律清除，显式关闭同样清', () => {
  const s = baseSettings();
  s.subAgent.profiles[0]!.enabledAbilities = { browser: true, web: true, extension: true };
  const changed = normalizeSettings(s);
  expect(changed).toBe(true);
  expect('browser' in s.subAgent.profiles[0]!.enabledAbilities).toBe(false);
  expect(s.subAgent.profiles[0]!.enabledAbilities).toEqual({ web: true, extension: true });

  const s2 = baseSettings();
  s2.subAgent.profiles[0]!.enabledAbilities = { browser: false };
  normalizeSettings(s2);
  expect('browser' in s2.subAgent.profiles[0]!.enabledAbilities).toBe(false);
});

test('内嵌浏览器下线迁移：skills 细选去 browser-exploration，清空删键，其他 skill 保留', () => {
  const s = baseSettings();
  s.subAgent.profiles[0]!.enabledAbilities = { skills: ['browser-exploration'] };
  const changed = normalizeSettings(s);
  expect(changed).toBe(true);
  expect('skills' in s.subAgent.profiles[0]!.enabledAbilities).toBe(false);

  const s2 = baseSettings();
  s2.subAgent.profiles[0]!.enabledAbilities = { skills: ['brainstorming', 'browser-exploration', 'staged-impl'] };
  normalizeSettings(s2);
  expect(s2.subAgent.profiles[0]!.enabledAbilities.skills).toEqual(['brainstorming', 'staged-impl']);
});

test('内嵌浏览器下线迁移：browser 键清除、skills 清空删键、description 接管为模板版后幂等', () => {
  const s = baseSettings();
  s.subAgent.profiles[1]!.description = '历代任意旧文案';
  s.subAgent.profiles[1]!.enabledAbilities = { web: true, browser: true, extension: true, article: true, skills: ['browser-exploration'] };
  const changed = normalizeSettings(s);
  expect(changed).toBe(true);
  expect(s.subAgent.profiles[1]!.description).toBe(createBrowserParseSubAgentProfile().description);
  expect(s.subAgent.profiles[1]!.enabledAbilities).toEqual({ web: true, extension: true, article: true });
  expect(normalizeSettings(s)).toBe(false);
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

test('normalizePiModels：合法 effort 字面量保留，非法值丢弃', () => {
  expect(normalizePiModels([
    { id: 'a', effort: 'off' },
    { id: 'b', effort: 'low' },
    { id: 'c', effort: 'medium' },
    { id: 'd', effort: 'high' },
    { id: 'e', effort: 'xhigh' },
    { id: 'f', effort: 'max' },
    { id: 'g', effort: null },
    { id: 'h', effort: 'ultra' },
    { id: 'i', effort: 3 },
    { id: 'j', effort: '' },
  ])).toEqual([
    { id: 'a', effort: 'off' },
    { id: 'b', effort: 'low' },
    { id: 'c', effort: 'medium' },
    { id: 'd', effort: 'high' },
    { id: 'e', effort: 'xhigh' },
    { id: 'f', effort: 'max' },
    { id: 'g' },
    { id: 'h' },
    { id: 'i' },
    { id: 'j' },
  ]);
});

test('normalizePiModels：布尔 true 的 supportsVision 保留，false 与非布尔丢弃', () => {
  expect(normalizePiModels([
    { id: 'a', supportsVision: true },
    { id: 'b', supportsVision: false },
    { id: 'c', supportsVision: 'yes' },
    { id: 'd', supportsVision: 1 },
    { id: 'e' },
  ])).toEqual([
    { id: 'a', supportsVision: true },
    { id: 'b' },
    { id: 'c' },
    { id: 'd' },
    { id: 'e' },
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
  const input = [{ id: 'gpt-5', label: '主力' }, { id: 'glm-4.7', supportsVision: true, effort: 'high' }];
  expect(normalizePiModels(input)).toEqual(input);
});

test('normalizePiModels：三字段均为有限非负数的 pricing 保留，含 0 值', () => {
  expect(normalizePiModels([
    { id: 'glm-5.3', pricing: { input: 8, output: 28, cacheRead: 2 } },
    { id: 'free-model', pricing: { input: 0, output: 0, cacheRead: 0 } },
  ])).toEqual([
    { id: 'glm-5.3', pricing: { input: 8, output: 28, cacheRead: 2 } },
    { id: 'free-model', pricing: { input: 0, output: 0, cacheRead: 0 } },
  ]);
});

test('normalizePiModels：pricing 缺字段/非法值/负数/非对象时整体丢弃', () => {
  expect(normalizePiModels([
    { id: 'a', pricing: { input: 1, output: 2 } },
    { id: 'b', pricing: { input: '1', output: 2, cacheRead: 0 } },
    { id: 'c', pricing: { input: -1, output: 2, cacheRead: 0 } },
    { id: 'd', pricing: { input: NaN, output: 2, cacheRead: 0 } },
    { id: 'e', pricing: 'cheap' },
  ])).toEqual([{ id: 'a' }, { id: 'b' }, { id: 'c' }, { id: 'd' }, { id: 'e' }]);
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

test('migratePiProfiles：supportsVision 与 effort 不被归一化剥离（重启不丢标记）', () => {
  const s = baseSettings();
  s.profiles.default.piModels = [
    { id: 'gpt-5', supportsVision: true, effort: 'high' },
    { id: 'glm-4.7', effort: 'off' },
  ];
  const changed = migratePiProfiles(s);
  expect(changed).toBe(false);
  expect(s.profiles.default.piModels).toEqual([
    { id: 'gpt-5', supportsVision: true, effort: 'high' },
    { id: 'glm-4.7', effort: 'off' },
  ]);
});

test('migratePiProfiles：已是 piModels 模型 id 的 selection 不受影响', () => {
  const s = baseSettings();
  s.profiles.default.piModels = [{ id: 'glm-4.7' }];
  s.ai.defaultModelSelection = { profileId: 'default', tier: 'glm-4.7' };
  const changed = migratePiProfiles(s);
  expect(changed).toBe(false);
  expect(s.ai.defaultModelSelection).toEqual({ profileId: 'default', tier: 'glm-4.7' });
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

// ── normalizePaymentBlockedHosts ───────────────────────

test('normalizePaymentBlockedHosts：trim + 小写 + `*.` 前缀归一，去重保首现顺序', () => {
  expect(normalizePaymentBlockedHosts([' Example.COM ', '*.pay.example.cn', 'Example.COM', 'pay.example.com']))
    .toEqual(['example.com', 'pay.example.cn', 'pay.example.com']);
});

test('normalizePaymentBlockedHosts：非法项丢弃（协议/路径/空串/非字符串），非数组返回空数组', () => {
  expect(normalizePaymentBlockedHosts([
    'https://evil.com',
    'has space.com',
    '',
    42,
    null,
    'ok-domain.cn',
  ])).toEqual(['ok-domain.cn']);
  expect(normalizePaymentBlockedHosts(undefined)).toEqual([]);
  expect(normalizePaymentBlockedHosts('not-array')).toEqual([]);
});

test('normalizeSettings：paymentBlockedHosts 缺失时不产生改动（旧文件升级无感）', () => {
  const s = baseSettings();
  expect(normalizeSettings(s)).toBe(false);
  expect(s.paymentBlockedHosts).toBeUndefined();
});

test('normalizeSettings：paymentBlockedHosts 含非法项时归一化替换，清空后删除字段', () => {
  const s1 = baseSettings();
  (s1 as Record<string, unknown>).paymentBlockedHosts = ['Pay.Bank.cn', 'https://x.com', 'pay.bank.cn'];
  expect(normalizeSettings(s1)).toBe(true);
  expect(s1.paymentBlockedHosts).toEqual(['pay.bank.cn']);

  const s2 = baseSettings();
  (s2 as Record<string, unknown>).paymentBlockedHosts = ['https://x.com'];
  expect(normalizeSettings(s2)).toBe(true);
  expect(s2.paymentBlockedHosts).toBeUndefined();

  const s3 = baseSettings();
  (s3 as Record<string, unknown>).paymentBlockedHosts = ['pay.bank.cn'];
  expect(normalizeSettings(s3)).toBe(false);
});
