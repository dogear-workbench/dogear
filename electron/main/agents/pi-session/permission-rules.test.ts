import { test, expect } from 'bun:test';
import { decideToolPermission, isBasicToolName, getBasicToolPermission, createDefaultBasicToolPermissions, BASIC_TOOL_NAMES } from './permission-rules.js';
import type { BasicToolPermissions } from '../../services/settings-types.js';

function allAllow(): BasicToolPermissions {
  return { read: 'allow', write: 'allow', edit: 'allow', bash: 'allow', Glob: 'allow', Grep: 'allow', Skill: 'allow' };
}

function allAsk(): BasicToolPermissions {
  return createDefaultBasicToolPermissions();
}

const emptyPackMap = new Map<string, string>();
const emptyAllowed = new Set<string>();

test('BASIC_TOOL_NAMES 包含全部七项', () => {
  expect(BASIC_TOOL_NAMES).toEqual(['read', 'write', 'edit', 'bash', 'Glob', 'Grep', 'Skill']);
});

test('createDefaultBasicToolPermissions 返回全 ask', () => {
  const map = allAsk();
  for (const name of BASIC_TOOL_NAMES) {
    expect(map[name]).toBe('ask');
  }
});

test('isBasicToolName 正确识别基础工具', () => {
  for (const name of BASIC_TOOL_NAMES) {
    expect(isBasicToolName(name)).toBe(true);
  }
});

test('isBasicToolName 拒绝非基础工具', () => {
  expect(isBasicToolName('dogear__RecallMemory')).toBe(false);
  expect(isBasicToolName('Bash')).toBe(false);
  expect(isBasicToolName('Read')).toBe(false);
  expect(isBasicToolName('')).toBe(false);
});

test('getBasicToolPermission 返回基础工具的权限值', () => {
  const map = { ...allAsk(), read: 'allow', bash: 'allow' };
  expect(getBasicToolPermission(map, 'read')).toBe('allow');
  expect(getBasicToolPermission(map, 'bash')).toBe('allow');
  expect(getBasicToolPermission(map, 'write')).toBe('ask');
});

test('getBasicToolPermission 对非基础工具返回 undefined', () => {
  const map = allAsk();
  expect(getBasicToolPermission(map, 'dogear__RecallMemory')).toBeUndefined();
  expect(getBasicToolPermission(map, 'Read')).toBeUndefined();
});

test('autoExecute 模式无条件放行所有工具', () => {
  const packMap = new Map([['dogear__RecallMemory', 'dogear-memory']]);
  for (const tool of ['read', 'write', 'bash', 'dogear__RecallMemory', 'unknownTool']) {
    expect(decideToolPermission(tool, 'autoExecute', packMap, emptyAllowed, allAsk())).toBe('allow');
  }
});

test('autoExecute 模式忽略基础工具权限配置', () => {
  expect(decideToolPermission('write', 'autoExecute', emptyPackMap, emptyAllowed, allAsk())).toBe('allow');
  expect(decideToolPermission('bash', 'autoExecute', emptyPackMap, emptyAllowed, allAsk())).toBe('allow');
});

test('默认模式：基础工具 ask 时返回 ask', () => {
  expect(decideToolPermission('write', 'default', emptyPackMap, emptyAllowed, allAsk())).toBe('ask');
  expect(decideToolPermission('read', 'default', emptyPackMap, emptyAllowed, allAsk())).toBe('ask');
});

test('默认模式：基础工具 allow 时放行', () => {
  expect(decideToolPermission('read', 'default', emptyPackMap, emptyAllowed, { ...allAsk(), read: 'allow' })).toBe('allow');
  expect(decideToolPermission('bash', 'default', emptyPackMap, emptyAllowed, { ...allAsk(), bash: 'allow' })).toBe('allow');
});

test('默认模式：七个基础工具全部 ask 时全部 ask', () => {
  for (const tool of BASIC_TOOL_NAMES) {
    expect(decideToolPermission(tool, 'default', emptyPackMap, emptyAllowed, allAsk())).toBe('ask');
  }
});

test('默认模式：七个基础工具全部 allow 时全部放行', () => {
  for (const tool of BASIC_TOOL_NAMES) {
    expect(decideToolPermission(tool, 'default', emptyPackMap, emptyAllowed, allAllow())).toBe('allow');
  }
});

test('默认模式：工具包工具自动放行', () => {
  const packMap = new Map([['dogear__RecallMemory', 'dogear-memory'], ['dogear__SaveArticle', 'article']]);
  expect(decideToolPermission('dogear__RecallMemory', 'default', packMap, emptyAllowed, allAsk())).toBe('allow');
  expect(decideToolPermission('dogear__SaveArticle', 'default', packMap, emptyAllowed, allAsk())).toBe('allow');
});

test('默认模式：未分类工具返回 ask', () => {
  expect(decideToolPermission('MysteryTool', 'default', emptyPackMap, emptyAllowed, allAsk())).toBe('ask');
});

test('默认模式：sessionAllowedTools 放行基础工具', () => {
  const allowed = new Set(['bash']);
  expect(decideToolPermission('bash', 'default', emptyPackMap, allowed, allAsk())).toBe('allow');
});

test('默认模式：sessionAllowedTools 不影响非基础工具', () => {
  const allowed = new Set(['MysteryTool']);
  expect(decideToolPermission('MysteryTool', 'default', emptyPackMap, allowed, allAsk())).toBe('ask');
});

test('会话允许集不共享：不同 Set 实例互不影响', () => {
  const allowedA = new Set(['bash']);
  const allowedB = new Set<string>();
  expect(decideToolPermission('bash', 'default', emptyPackMap, allowedA, allAsk())).toBe('allow');
  expect(decideToolPermission('bash', 'default', emptyPackMap, allowedB, allAsk())).toBe('ask');
});

const extensionPackMap = new Map(
  [
    'dogear__extension__navigate',
    'dogear__extension__observe_page',
    'dogear__extension__click',
    'dogear__extension__fill',
    'dogear__extension__read_text',
    'dogear__extension__wait_for',
    'dogear__extension__screenshot',
  ].map((name) => [name, 'extension']),
);

test('默认模式：扩展通道只读工具随工具包放行', () => {
  for (const tool of [
    'dogear__extension__navigate',
    'dogear__extension__observe_page',
    'dogear__extension__read_text',
    'dogear__extension__wait_for',
    'dogear__extension__screenshot',
  ]) {
    expect(decideToolPermission(tool, 'default', extensionPackMap, emptyAllowed, allAsk())).toBe('allow');
  }
});

test('默认模式：扩展通道工具随工具包放行（click/fill 安全由 guard_submit 确认卡承担，不再走权限层逐次确认）', () => {
  for (const tool of extensionPackMap.keys()) {
    expect(decideToolPermission(tool, 'default', extensionPackMap, emptyAllowed, allAsk())).toBe('allow');
  }
});

test('autoExecute 模式：扩展全部工具放行（含交互两工具）', () => {
  for (const tool of extensionPackMap.keys()) {
    expect(decideToolPermission(tool, 'autoExecute', extensionPackMap, emptyAllowed, allAsk())).toBe('allow');
  }
});

const gitPackMap = new Map(
  [
    'dogear__GitStatus',
    'dogear__GitDiff',
    'dogear__GitLog',
    'dogear__GitShow',
    'dogear__GitBlame',
    'dogear__GitCommit',
    'dogear__GitRevert',
    'dogear__GitSnapshotList',
    'dogear__GitSnapshotRestore',
  ].map((name) => [name, 'dogear-git']),
);

test('默认模式：git 只读与提交/快照工具随工具包放行', () => {
  for (const tool of [
    'dogear__GitStatus',
    'dogear__GitDiff',
    'dogear__GitLog',
    'dogear__GitShow',
    'dogear__GitBlame',
    'dogear__GitCommit',
    'dogear__GitSnapshotList',
    'dogear__GitSnapshotRestore',
  ]) {
    expect(decideToolPermission(tool, 'default', gitPackMap, emptyAllowed, allAsk())).toBe('allow');
  }
});

test('默认模式：dogear__GitRevert 逐次确认，工具包启用不覆盖', () => {
  expect(decideToolPermission('dogear__GitRevert', 'default', gitPackMap, emptyAllowed, allAsk())).toBe('ask');
  expect(decideToolPermission('dogear__GitRevert', 'default', emptyPackMap, emptyAllowed, allAsk())).toBe('ask');
});

test('autoExecute 模式：dogear__GitRevert 放行', () => {
  expect(decideToolPermission('dogear__GitRevert', 'autoExecute', gitPackMap, emptyAllowed, allAsk())).toBe('allow');
});

test('默认模式：tool_search 元工具无副作用自动放行，不受未分类 ask 兑底影响', () => {
  expect(decideToolPermission('tool_search', 'default', emptyPackMap, emptyAllowed, allAsk())).toBe('allow');
  expect(decideToolPermission('tool_search', 'autoExecute', emptyPackMap, emptyAllowed, allAsk())).toBe('allow');
});
