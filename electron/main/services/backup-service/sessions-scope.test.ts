import { test, expect, mock, beforeEach } from 'bun:test';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import AdmZip from 'adm-zip';

mock.module('electron', () => ({
  default: { app: { getPath: () => tmpdir() }, nativeTheme: {} },
  app: { getPath: () => tmpdir() },
  nativeTheme: {},
}));

const { runBackup } = await import('./index.js');
const { readCategoryRun } = await import('./last-run.js');
const { listBackupFiles } = await import('./zip-pack.js');

const cfg = (...segs: string[]) => path.join(process.env.DOGEAR_CONFIG_DIR!, ...segs);

async function latestZipEntries(scope: string, category: string): Promise<string[]> {
  const files = await listBackupFiles(scope, category);
  const last = files.at(-1);
  if (!last) return [];
  const zip = new AdmZip(cfg('backups', scope, last.fileName));
  return zip.getEntries().filter((e) => !e.isDirectory).map((e) => e.entryName).sort();
}

beforeEach(async () => {
  process.env.DOGEAR_CONFIG_DIR = await fsp.mkdtemp(path.join(tmpdir(), 'dogear-sess-'));
  await fsp.mkdir(cfg('workspaces', 'ws-a', 'sessions'), { recursive: true });
  await fsp.writeFile(cfg('workspaces', 'ws-a', 'sessions', 's1.jsonl'), '{"id":1}', 'utf8');
  await fsp.writeFile(cfg('workspaces', 'workspaces.json'), JSON.stringify({ version: 1, workspaces: [{ id: 'ws-a', path: cfg('disk-ws-a') }] }), 'utf8');
});

test('runBackup sessions：workspace zip 只含本工作区会话，global scope 已收敛不再支持（conversations 退役）', async () => {
  const wsResult = await runBackup('sessions', 'ws-a');
  expect(wsResult.fileName).not.toBeNull();
  const wsEntries = await latestZipEntries('ws-a', 'sessions');
  expect(wsEntries).toEqual(['workspaces/ws-a/sessions/s1.jsonl']);

  await expect(runBackup('sessions', 'global')).rejects.toThrow('不支持 global scope');
});

test('runBackup sessions：last-run 只记 ws-a:sessions 且带签名，global 无备份记录', async () => {
  await runBackup('sessions', 'ws-a');
  const wsRun = await readCategoryRun('sessions', 'ws-a');
  const globalRun = await readCategoryRun('sessions', 'global');
  expect(wsRun?.ok).toBe(true);
  expect(wsRun?.signature).toBeDefined();
  expect(globalRun).toBeNull();
});
