import { test, expect, mock } from 'bun:test';
import { tmpdir } from 'node:os';

// apply.ts 静态 import 链（→ settings-service/sync-state）顶层拉进 electron 命名导入；
// 先 mock 再动态加载（同 exclude.test.ts）
mock.module('electron', () => ({
  default: { app: { getPath: () => tmpdir() }, nativeTheme: {} },
  app: { getPath: () => tmpdir() },
  nativeTheme: {},
}));

const { conflictCopyRelPath } = await import('./apply.js');
const { isExcluded, excludesFromSyncOptions } = await import('./manifest.js');

test('副本名格式：<dir><stem><ext>.conflict-<胜方短ID>-<YYYYMMDD-HHmmss>-<rand4>（D3）', () => {
  expect(conflictCopyRelPath('memory/a.md', '4cc497')).toMatch(/^memory\/a\.md\.conflict-4cc497-\d{8}-\d{6}-[0-9a-f]{4}$/);
  expect(conflictCopyRelPath('plain', 'aaaaaa')).toMatch(/^plain\.conflict-aaaaaa-\d{8}-\d{6}-[0-9a-f]{4}$/);
  expect(conflictCopyRelPath('.gitignore', 'aaaaaa')).toMatch(/^\.gitignore\.conflict-aaaaaa-\d{8}-\d{6}-[0-9a-f]{4}$/);
});

test('同参数连续调用不重名（时间戳+随机段防同秒多副本互相覆盖）', () => {
  const names = new Set(Array.from({ length: 20 }, () => conflictCopyRelPath('x.json', 'aaaaaa')));
  expect(names.size).toBe(20);
});

test('时间戳格式副本名仍被排除体系识别（默认不同步、开启后放行）', () => {
  const name = conflictCopyRelPath('plans.json', '4cc497');
  expect(isExcluded(name, excludesFromSyncOptions())).toBe(true);
  expect(isExcluded(name, excludesFromSyncOptions({ syncConflictCopies: true }))).toBe(false);
});
