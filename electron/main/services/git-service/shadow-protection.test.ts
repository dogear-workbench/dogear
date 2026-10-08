import { test, expect } from 'bun:test';
import { judgeSnapshotProtection } from './shadow-protection.js';
import { SNAPSHOT_SETTING_DEFAULTS, type SnapshotSettings } from '../settings-types.js';

const SETTINGS: SnapshotSettings = {
  maxFileSizeBytes: 100,
  excludedPaths: { ws: ['data', 'a/b', 'node_modules'] },
  retention: { recentDays: 7, totalDays: 30 },
  disabledWorkspaces: ['ws-off'],
};

test('受保护：正常文件且未超限', () => {
  expect(judgeSnapshotProtection('ws', 'src/a.ts', SETTINGS, 50)).toEqual({ protected: true });
});

test('disabled 优先级最高：同时命中排除路径与超限也只报 disabled', () => {
  expect(judgeSnapshotProtection('ws-off', 'node_modules/big.bin', SETTINGS, 999)).toEqual({
    protected: false,
    reason: 'disabled',
  });
});

test('excluded 优先于 size：排除路径内的超限文件报 excluded', () => {
  expect(judgeSnapshotProtection('ws', 'a/b/big.bin', SETTINGS, 999)).toEqual({
    protected: false,
    reason: 'excluded',
  });
});

test('excluded：排除路径精确命中', () => {
  expect(judgeSnapshotProtection('ws', 'data/a.txt', SETTINGS, 1)).toEqual({ protected: false, reason: 'excluded' });
  expect(judgeSnapshotProtection('ws', 'node_modules/pkg/index.js', SETTINGS, 1)).toEqual({
    protected: false,
    reason: 'excluded',
  });
});

test('excluded：子路径命中（子树全覆盖），含排除路径本身', () => {
  expect(judgeSnapshotProtection('ws', 'data/sub/deep/a.txt', SETTINGS, 1)).toEqual({
    protected: false,
    reason: 'excluded',
  });
  expect(judgeSnapshotProtection('ws', 'data', SETTINGS, 1)).toEqual({ protected: false, reason: 'excluded' });
});

test('excluded：段前缀不误伤同名前缀目录与文件', () => {
  expect(judgeSnapshotProtection('ws', 'data2/a.txt', SETTINGS, 1)).toEqual({ protected: true });
  expect(judgeSnapshotProtection('ws', 'database/x.db', SETTINGS, 1)).toEqual({ protected: true });
});

test('excluded：嵌套排除路径锚定顶层，不匹配深处的同名段序列', () => {
  expect(judgeSnapshotProtection('ws', 'a/b/c.txt', SETTINGS, 1)).toEqual({ protected: false, reason: 'excluded' });
  expect(judgeSnapshotProtection('ws', 'a/b', SETTINGS, 1)).toEqual({ protected: false, reason: 'excluded' });
  expect(judgeSnapshotProtection('ws', 'x/a/b/c.txt', SETTINGS, 1)).toEqual({ protected: true });
  expect(judgeSnapshotProtection('ws', 'a/bx/c.txt', SETTINGS, 1)).toEqual({ protected: true });
});

test('excluded：排除清单按工作区隔离，未列工作区不受影响', () => {
  expect(judgeSnapshotProtection('other', 'data/a.txt', SETTINGS, 1)).toEqual({ protected: true });
});

test('size：超过阈值报 size，等于阈值不报', () => {
  expect(judgeSnapshotProtection('ws', 'a.bin', SETTINGS, 101)).toEqual({ protected: false, reason: 'size' });
  expect(judgeSnapshotProtection('ws', 'a.bin', SETTINGS, 100)).toEqual({ protected: true });
});

test('size：文件不存在（null）不算超限', () => {
  expect(judgeSnapshotProtection('ws', 'a.bin', SETTINGS, null)).toEqual({ protected: true });
});

test('路径分隔符兼容反斜杠', () => {
  expect(judgeSnapshotProtection('ws', 'data\\sub\\a.txt', SETTINGS, 1)).toEqual({
    protected: false,
    reason: 'excluded',
  });
});

test('根路径（.）仅受 disabled 影响', () => {
  expect(judgeSnapshotProtection('ws', '.', SETTINGS, null)).toEqual({ protected: true });
  expect(judgeSnapshotProtection('ws-off', '.', SETTINGS, null)).toEqual({ protected: false, reason: 'disabled' });
});

test('默认配置（excludedPaths 空）：常规源码文件受保护', () => {
  expect(judgeSnapshotProtection('ws', 'src/index.ts', SNAPSHOT_SETTING_DEFAULTS, 1024)).toEqual({ protected: true });
});
