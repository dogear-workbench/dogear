import { test, expect, mock, beforeEach } from 'bun:test';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import AdmZip from 'adm-zip';

process.env.DOGEAR_CONFIG_DIR = await fsp.mkdtemp(path.join(tmpdir(), 'dogear-skip-'));

mock.module('electron', () => ({
  default: { app: { getPath: () => tmpdir() }, nativeTheme: {} },
  app: { getPath: () => tmpdir() },
  nativeTheme: {},
}));

const {
  runBackup,
  runBackupAll,
  isDue,
} = await import('./index.js');
const { computeSourceSignature } = await import('./source-signature.js');
const { backupSourcesFor } = await import('../data-registry.js');
const { lastRunFilePath, readCategoryRun } = await import('./last-run.js');
const { backupDirPath, backupFileName, listBackupFiles } = await import('./zip-pack.js');

const cfg = (...segs: string[]) => path.join(process.env.DOGEAR_CONFIG_DIR!, ...segs);
const DAY_MS = 24 * 60 * 60 * 1000;

beforeEach(async () => {
  process.env.DOGEAR_CONFIG_DIR = await fsp.mkdtemp(path.join(tmpdir(), 'dogear-skip-'));
  await fsp.mkdir(cfg('workspaces'), { recursive: true });
  await fsp.writeFile(cfg('workspaces', 'workspaces.json'), JSON.stringify({ version: 1, workspaces: [] }), 'utf8');
});

/** 种 app-config×global 源并构造「25h 前备份过 + last-run 含签名」的到期状态，返回当时的签名 */
async function seedDueStateWithSignature(): Promise<string> {
  await fsp.writeFile(cfg('settings.json'), '{"k":1}', 'utf8');
  await fsp.writeFile(cfg('agent.md'), '# agent', 'utf8');
  await fsp.writeFile(cfg('plans.json'), '{"plans":[]}', 'utf8');
  const sources = await backupSourcesFor('app-config', 'global');
  const signature = (await computeSourceSignature(sources))!;
  const old = new Date(Date.now() - 25 * 60 * 60 * 1000);
  await fsp.mkdir(backupDirPath('global'), { recursive: true });
  const zip = new AdmZip();
  zip.addFile('settings.json', Buffer.from('{"k":1}'));
  zip.writeZip(path.join(backupDirPath('global'), backupFileName('app-config', old)));
  await fsp.writeFile(
    lastRunFilePath(),
    JSON.stringify({
      runs: { 'global:app-config': { time: old.toISOString(), category: 'app-config', scope: 'global', ok: true, error: null, signature } },
      scheduler: null,
    }),
    'utf8',
  );
  return signature;
}

async function appConfigZipCount(): Promise<number> {
  return (await listBackupFiles('global', 'app-config')).length;
}

test('onlyDue：无变化跳过——不产 zip、last-run 记 skipped 且签名不变、isDue 归 false', async () => {
  const signature = await seedDueStateWithSignature();
  expect(await isDue('app-config', 'global', 'daily')).toBe(true);

  await runBackupAll(null, { onlyDue: true });

  expect(await appConfigZipCount()).toBe(1);
  const entry = await readCategoryRun('app-config', 'global');
  expect(entry!.ok).toBe(true);
  expect(entry!.error).toBeNull();
  expect(entry!.skipped).toBe(true);
  expect(entry!.signature).toBe(signature);
  expect(await isDue('app-config', 'global', 'daily')).toBe(false);
});

test('onlyDue：有变化正常备份并更新签名', async () => {
  await seedDueStateWithSignature();
  await fsp.writeFile(cfg('settings.json'), '{"k":2,"more":true}', 'utf8');

  await runBackupAll(null, { onlyDue: true });

  expect(await appConfigZipCount()).toBe(2);
  const entry = await readCategoryRun('app-config', 'global');
  expect(entry!.ok).toBe(true);
  expect(entry!.skipped).toBeUndefined();
  expect(entry!.signature).toMatch(/^[0-9a-f]{40}$/);
  expect(entry!.signature).toBe(await computeSourceSignature(await backupSourcesFor('app-config', 'global')));
});

test('手动 runBackup 不跳过：签名一致仍产新 zip 并刷新签名', async () => {
  await seedDueStateWithSignature();

  const result = await runBackup('app-config', 'global');

  expect(result.fileName).not.toBeNull();
  expect(await appConfigZipCount()).toBe(2);
  const entry = await readCategoryRun('app-config', 'global');
  expect(entry!.skipped).toBeUndefined();
  expect(entry!.signature).toBe(await computeSourceSignature(await backupSourcesFor('app-config', 'global')));
});

test('旧版 last-run（无 signature 字段）首次必备份并写入签名', async () => {
  await fsp.writeFile(cfg('settings.json'), '{"k":1}', 'utf8');
  const old = new Date(Date.now() - 25 * 60 * 60 * 1000);
  await fsp.mkdir(backupDirPath('global'), { recursive: true });
  const zip = new AdmZip();
  zip.addFile('settings.json', Buffer.from('{"k":1}'));
  zip.writeZip(path.join(backupDirPath('global'), backupFileName('app-config', old)));
  await fsp.writeFile(
    lastRunFilePath(),
    JSON.stringify({
      runs: { 'global:app-config': { time: old.toISOString(), category: 'app-config', scope: 'global', ok: true, error: null } },
      scheduler: null,
    }),
    'utf8',
  );

  await runBackupAll(null, { onlyDue: true });

  expect(await appConfigZipCount()).toBe(2);
  const entry = await readCategoryRun('app-config', 'global');
  expect(entry!.skipped).toBeUndefined();
  expect(entry!.signature).toBe(await computeSourceSignature(await backupSourcesFor('app-config', 'global')));
});

test('上次执行失败不跳过：签名一致仍重试真实备份', async () => {
  const signature = await seedDueStateWithSignature();
  await fsp.writeFile(
    lastRunFilePath(),
    JSON.stringify({
      runs: { 'global:app-config': { time: new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString(), category: 'app-config', scope: 'global', ok: false, error: '磁盘已满', signature } },
      scheduler: null,
    }),
    'utf8',
  );

  await runBackupAll(null, { onlyDue: true });

  expect(await appConfigZipCount()).toBe(2);
  const entry = await readCategoryRun('app-config', 'global');
  expect(entry!.ok).toBe(true);
  expect(entry!.error).toBeNull();
  expect(entry!.skipped).toBeUndefined();
});
