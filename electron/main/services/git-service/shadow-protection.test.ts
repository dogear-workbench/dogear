import { test, expect } from 'bun:test';
import { judgeSnapshotProtection } from './shadow-protection.js';
import { SNAPSHOT_SETTING_DEFAULTS, type SnapshotSettings } from '../settings-types.js';

const SETTINGS: SnapshotSettings = {
  maxFileSizeBytes: 100,
  excludeDirs: ['node_modules', 'dist'],
  retention: { recentDays: 7, totalDays: 30 },
  disabledWorkspaces: ['ws-off'],
};

test('受保护：正常文件且未超限', () => {
  expect(judgeSnapshotProtection('ws', 'src/a.ts', SETTINGS, 50)).toEqual({ protected: true });
});

test('disabled 优先级最高：同时命中排除目录与超限也只报 disabled', () => {
  expect(judgeSnapshotProtection('ws-off', 'node_modules/big.bin', SETTINGS, 999)).toEqual({
    protected: false,
    reason: 'disabled',
  });
});

test('excluded 优先于 size：排除目录内的超限文件报 excluded', () => {
  expect(judgeSnapshotProtection('ws', 'a/node_modules/big.bin', SETTINGS, 999)).toEqual({
    protected: false,
    reason: 'excluded',
  });
});

test('excluded：任意层级目录段命中，含首段', () => {
  expect(judgeSnapshotProtection('ws', 'node_modules/a/b.js', SETTINGS, 1)).toEqual({
    protected: false,
    reason: 'excluded',
  });
  expect(judgeSnapshotProtection('ws', 'x/dist/y.js', SETTINGS, 1)).toEqual({ protected: false, reason: 'excluded' });
});

test('excluded：末段（文件名）与目录同名也算命中，对齐 pathspec 排除语义', () => {
  expect(judgeSnapshotProtection('ws', 'dist', SETTINGS, 1)).toEqual({ protected: false, reason: 'excluded' });
});

test('excluded：目录名精确匹配，前缀不算', () => {
  expect(judgeSnapshotProtection('ws', 'node_modules-extra/a.js', SETTINGS, 1)).toEqual({ protected: true });
  expect(judgeSnapshotProtection('ws', 'distribution/readme.md', SETTINGS, 1)).toEqual({ protected: true });
});

test('size：超过阈值报 size，等于阈值不报', () => {
  expect(judgeSnapshotProtection('ws', 'a.bin', SETTINGS, 101)).toEqual({ protected: false, reason: 'size' });
  expect(judgeSnapshotProtection('ws', 'a.bin', SETTINGS, 100)).toEqual({ protected: true });
});

test('size：文件不存在（null）不算超限', () => {
  expect(judgeSnapshotProtection('ws', 'a.bin', SETTINGS, null)).toEqual({ protected: true });
});

test('路径分隔符兼容反斜杠', () => {
  expect(judgeSnapshotProtection('ws', 'src\\node_modules\\a.js', SETTINGS, 1)).toEqual({
    protected: false,
    reason: 'excluded',
  });
});

test('根路径（.）仅受 disabled 影响', () => {
  expect(judgeSnapshotProtection('ws', '.', SETTINGS, null)).toEqual({ protected: true });
  expect(judgeSnapshotProtection('ws-off', '.', SETTINGS, null)).toEqual({ protected: false, reason: 'disabled' });
});

test('默认配置：常规源码文件受保护', () => {
  expect(judgeSnapshotProtection('ws', 'src/index.ts', SNAPSHOT_SETTING_DEFAULTS, 1024)).toEqual({ protected: true });
});
