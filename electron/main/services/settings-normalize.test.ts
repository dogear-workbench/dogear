import { test, expect } from 'bun:test';
import { normalizeSettings, normalizePiModels, migratePiProfiles } from './settings-service.js';
import { normalizeFailoverChain, normalizePaymentBlockedHosts } from './settings-types.js';
import {
  DEFAULT_SETTINGS,
  type AppSettings,
  type ModelProfile,
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
    expect(s.ai.effort).toBe(null);
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

test('subAgent.profiles 结构完整时不产生改动', () => {
  const s = baseSettings();
  const changed = normalizeSettings(s);
  expect(changed).toBe(false);
  expect(s.subAgent.profiles).toHaveLength(2);
  expect(s.subAgent.profiles[0]!.id).toBe('default');
  expect(s.subAgent.profiles[1]!.id).toBe('browser-parse');
});

test('subAgent.profiles 为空数组时补全默认 Profile', () => {
  const s = baseSettings();
  s.subAgent.profiles = [];
  const changed = normalizeSettings(s);
  expect(changed).toBe(true);
  expect(s.subAgent.profiles).toHaveLength(2);
  expect(s.subAgent.profiles[0]!.id).toBe('default');
  expect(s.subAgent.profiles[1]!.id).toBe('browser-parse');
});

test('缺失内置浏览器解析 Profile 时自动补齐，已有 Profile 保留且幂等', () => {
  const s = baseSettings();
  s.subAgent.profiles = [{ id: 'p1', name: '自定义', description: '', timeoutMinutes: 15, enabledBasicTools: ['read'], enabledAbilities: {} }];
  const changed = normalizeSettings(s);
  expect(changed).toBe(true);
  expect(s.subAgent.profiles).toHaveLength(2);
  expect(s.subAgent.profiles[0]).toEqual({ id: 'p1', name: '自定义', description: '', timeoutMinutes: 15, enabledBasicTools: ['read'], enabledAbilities: {} });
  expect(s.subAgent.profiles[1]!.id).toBe('browser-parse');
  expect(s.subAgent.profiles[1]!.enabledAbilities).toEqual({ web: true, browser: true, extension: true, article: true });
  expect(normalizeSettings(s)).toBe(false);
});

test('用户自定义 description 不被迁移', () => {
  const s = baseSettings();
  s.subAgent.profiles[0]!.description = '我自己的默认描述';
  s.subAgent.profiles[1]!.description = '我自己的浏览器解析描述';
  expect(normalizeSettings(s)).toBe(false);
  expect(s.subAgent.profiles[0]!.description).toBe('我自己的默认描述');
  expect(s.subAgent.profiles[1]!.description).toBe('我自己的浏览器解析描述');
});

test('enabledAbilities.browser 非布尔值被清洗，布尔值保留', () => {
  const s = baseSettings();
  s.subAgent.profiles[0]!.enabledAbilities = { browser: 'yes' as unknown as boolean };
  const changed = normalizeSettings(s);
  expect(changed).toBe(true);
  expect('browser' in s.subAgent.profiles[0]!.enabledAbilities).toBe(false);

  const s2 = baseSettings();
  s2.subAgent.profiles[0]!.enabledAbilities = { browser: true };
  const changed2 = normalizeSettings(s2);
  expect(changed2).toBe(true);
  expect(s2.subAgent.profiles[0]!.enabledAbilities).toEqual({ browser: true, web: true });
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
