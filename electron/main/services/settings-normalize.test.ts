import { test, expect } from 'bun:test';
import { normalizeSettings } from './settings-service.js';
import { DEFAULT_SETTINGS, type AppSettings } from './settings-types.js';

function baseSettings(): AppSettings {
  return structuredClone(DEFAULT_SETTINGS);
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
