import { test, expect, mock } from 'bun:test';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';

process.env.DOGEAR_CONFIG_DIR = await fsp.mkdtemp(path.join(tmpdir(), 'dogear-mem-usage-'));

mock.module('electron', () => ({
  default: { app: { getPath: () => tmpdir() }, nativeTheme: {} },
  app: { getPath: () => tmpdir() },
  nativeTheme: {},
}));

const { recordRecallUsage, readMemoryUsage, usageKey } = await import('./memory-usage.js');

test('记录召回使用：按 scope 分键累计，文件在 sync 白名单外', async () => {
  await recordRecallUsage('ws1', [
    { slug: 'a', scope: 'workspace' },
    { slug: 'g', scope: 'global' },
  ]);
  await recordRecallUsage('ws1', [{ slug: 'a', scope: 'workspace' }]);

  const usage = await readMemoryUsage();
  expect(usage).not.toBeNull();
  expect(usage!.entries[usageKey('workspace', 'ws1', 'a')].count).toBe(2);
  expect(usage!.entries[usageKey('global', 'ws1', 'g')].count).toBe(1);
  expect(usage!.since).toBeTruthy();

  const statsAbs = path.join(process.env.DOGEAR_CONFIG_DIR!, 'memory-stats.json');
  await fsp.access(statsAbs);
});
