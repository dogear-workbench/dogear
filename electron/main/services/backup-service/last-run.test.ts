import { test, expect, mock } from 'bun:test';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';

process.env.DOGEAR_CONFIG_DIR = await fsp.mkdtemp(path.join(tmpdir(), 'dogear-last-run-'));

mock.module('electron', () => ({
  default: { app: { getPath: () => tmpdir() }, nativeTheme: {} },
  app: { getPath: () => tmpdir() },
  nativeTheme: {},
}));

const {
  recordCategoryRun,
  recordSchedulerRun,
  readCategoryRun,
  readSchedulerRun,
  lastRunFilePath,
} = await import('./last-run.js');

test('recordCategoryRun：写入并可读回，文件落在 backups/last-run.json', async () => {
  await recordCategoryRun('memory', 'global', false, '磁盘已满');
  const entry = await readCategoryRun('memory', 'global');
  expect(entry).not.toBeNull();
  expect(entry!.category).toBe('memory');
  expect(entry!.scope).toBe('global');
  expect(entry!.ok).toBe(false);
  expect(entry!.error).toBe('磁盘已满');
  expect(entry!.time).not.toBe('');
  expect(path.basename(lastRunFilePath())).toBe('last-run.json');
  expect(path.basename(path.dirname(lastRunFilePath()))).toBe('backups');
});

test('同 category+scope 覆盖：失败后成功，lastError 清除', async () => {
  await recordCategoryRun('tasks', 'global', false, '源读取失败');
  const failed = await readCategoryRun('tasks', 'global');
  expect(failed!.ok).toBe(false);
  await recordCategoryRun('tasks', 'global', true, null);
  const ok = await readCategoryRun('tasks', 'global');
  expect(ok!.ok).toBe(true);
  expect(ok!.error).toBeNull();
  expect(new Date(ok!.time).getTime()).toBeGreaterThanOrEqual(new Date(failed!.time).getTime());
});

test('不同 category/scope 条目互不干扰', async () => {
  await recordCategoryRun('memory', 'ws-a', false, 'err-a');
  await recordCategoryRun('memory', 'ws-b', true, null);
  await recordCategoryRun('sessions', 'ws-a', true, null);
  expect((await readCategoryRun('memory', 'ws-a'))!.error).toBe('err-a');
  expect((await readCategoryRun('memory', 'ws-b'))!.ok).toBe(true);
  expect((await readCategoryRun('sessions', 'ws-a'))!.ok).toBe(true);
});

test('recordSchedulerRun：覆盖式记录调度级结果', async () => {
  expect(await readSchedulerRun()).toBeNull();
  await recordSchedulerRun(false, '配置读取失败');
  const failed = await readSchedulerRun();
  expect(failed!.ok).toBe(false);
  expect(failed!.error).toBe('配置读取失败');
  expect(failed!.category).toBeNull();
  await recordSchedulerRun(true, null);
  const ok = await readSchedulerRun();
  expect(ok!.ok).toBe(true);
  expect(ok!.error).toBeNull();
});

test('未记录的 category/scope 读回 null；损坏文件降级为空', async () => {
  expect(await readCategoryRun('app-config', 'global')).toBeNull();
  await fsp.writeFile(lastRunFilePath(), '{broken json', 'utf8');
  expect(await readCategoryRun('memory', 'global')).toBeNull();
  expect(await readSchedulerRun()).toBeNull();
});

test('并发 record 串行化：100 个并发写入后全部条目完整', async () => {
  await Promise.all(
    Array.from({ length: 100 }, (_, i) => recordCategoryRun('memory', `ws-${i}`, i % 2 === 0, i % 2 === 0 ? `err-${i}` : null)),
  );
  for (let i = 0; i < 100; i++) {
    const entry = await readCategoryRun('memory', `ws-${i}`);
    expect(entry).not.toBeNull();
    expect(entry!.ok).toBe(i % 2 === 0);
  }
});
