import { test, expect, mock } from 'bun:test';
import fsp from 'node:fs/promises';
import fs from 'node:fs';
import path from 'node:path';
import { tmpdir } from 'node:os';
import AdmZip from 'adm-zip';

process.env.DOGEAR_CONFIG_DIR = await fsp.mkdtemp(path.join(tmpdir(), 'dogear-snapshot-'));
const wsDiskRoot = await fsp.mkdtemp(path.join(tmpdir(), 'dogear-snapshot-ws-'));

mock.module('electron', () => ({
  default: { app: { getPath: () => tmpdir() }, nativeTheme: {} },
  app: { getPath: () => tmpdir() },
  nativeTheme: {},
}));

const { deleteFilesOutsideSnapshot } = await import('./snapshot-restore.js');
const { restoreBackup } = await import('./index.js');

const configDir = () => process.env.DOGEAR_CONFIG_DIR!;
const cfg = (...segs: string[]) => path.join(configDir(), ...segs);
const anchorEntry = (wsid: string) => path.posix.join('__ws-external__', wsid, '.dogear', 'tasks.json');

async function seedRegistry(wsDiskPath: string): Promise<void> {
  await fsp.mkdir(path.dirname(cfg('workspaces', 'workspaces.json')), { recursive: true });
  await fsp.writeFile(
    cfg('workspaces', 'workspaces.json'),
    JSON.stringify({ version: 1, workspaces: [{ id: 'ws-x', path: wsDiskPath }] }),
    'utf8',
  );
}

async function writeZip(entries: Record<string, string>, outPath: string): Promise<void> {
  const zip = new AdmZip();
  for (const [name, content] of Object.entries(entries)) zip.addFile(name, Buffer.from(content, 'utf8'));
  await fsp.mkdir(path.dirname(outPath), { recursive: true });
  zip.writeZip(outPath);
}

async function backupZipCount(scope: string): Promise<number> {
  try {
    return (await fsp.readdir(cfg('backups', scope))).filter((f) => f.endsWith('.zip')).length;
  } catch {
    return 0;
  }
}

test('deleteFilesOutsideSnapshot：目录源内 zip 外文件删除、zip 内保留、边界外不删', async () => {
  await fsp.mkdir(cfg('workspaces', 'ws-a', 'notes'), { recursive: true });
  await fsp.writeFile(cfg('workspaces', 'ws-a', 'notes', 'keep.txt'), 'keep', 'utf8');
  await fsp.writeFile(cfg('workspaces', 'ws-a', 'notes', 'stale.txt'), 'stale', 'utf8');
  await fsp.writeFile(cfg('workspaces', 'ws-a', 'notes', 'sub.txt'), 'zip-内', 'utf8');
  await fsp.mkdir(cfg('backups'), { recursive: true });
  await fsp.writeFile(cfg('backups', 'keep-me.zip'), 'zip', 'utf8');
  await fsp.mkdir(cfg('usage'), { recursive: true });
  await fsp.writeFile(cfg('usage', 'u.json'), '{}', 'utf8');

  const removed = await deleteFilesOutsideSnapshot([cfg('workspaces', 'ws-a', 'notes')], [
    'workspaces/ws-a/notes/keep.txt',
    'workspaces/ws-a/notes/sub.txt',
  ]);

  expect(removed).toEqual(['workspaces/ws-a/notes/stale.txt']);
  expect(fs.existsSync(cfg('workspaces', 'ws-a', 'notes', 'keep.txt'))).toBe(true);
  expect(fs.existsSync(cfg('workspaces', 'ws-a', 'notes', 'sub.txt'))).toBe(true);
  expect(fs.existsSync(cfg('workspaces', 'ws-a', 'notes', 'stale.txt'))).toBe(false);
  expect(fs.existsSync(cfg('backups', 'keep-me.zip'))).toBe(true);
  expect(fs.existsSync(cfg('usage', 'u.json'))).toBe(true);
});

test('deleteFilesOutsideSnapshot：文件源 zip 外删除、zip 内保留', async () => {
  await fsp.writeFile(cfg('settings.json'), '{"k":2}', 'utf8');
  await fsp.writeFile(cfg('plans.json'), '{"p":1}', 'utf8');

  const removed = await deleteFilesOutsideSnapshot([cfg('settings.json'), cfg('plans.json')], ['settings.json']);

  expect(removed).toEqual(['plans.json']);
  expect(fs.existsSync(cfg('settings.json'))).toBe(true);
  expect(fs.existsSync(cfg('plans.json'))).toBe(false);
});

test('deleteFilesOutsideSnapshot：外部锚点按虚拟前缀删真实文件，锚点外不动', async () => {
  await seedRegistry(wsDiskRoot);
  const dogear = path.join(wsDiskRoot, '.dogear');
  await fsp.mkdir(dogear, { recursive: true });
  await fsp.writeFile(path.join(dogear, 'tasks.json'), '{"tasks":[]}', 'utf8');
  await fsp.writeFile(path.join(wsDiskRoot, 'other.txt'), 'out-of-boundary', 'utf8');

  const removed = await deleteFilesOutsideSnapshot(
    [cfg('__ws-external__', 'ws-x', '.dogear', 'tasks.json')],
    ['unrelated/entry.txt'],
  );

  expect(removed).toEqual([anchorEntry('ws-x')]);
  expect(fs.existsSync(path.join(dogear, 'tasks.json'))).toBe(false);
  expect(fs.existsSync(path.join(wsDiskRoot, 'other.txt'))).toBe(true);
  expect(fs.existsSync(dogear)).toBe(true);
});

test('deleteFilesOutsideSnapshot：锚点条目在 zip 内则保留', async () => {
  await seedRegistry(wsDiskRoot);
  const dogear = path.join(wsDiskRoot, '.dogear');
  await fsp.mkdir(dogear, { recursive: true });
  await fsp.writeFile(path.join(dogear, 'tasks.json'), '{"tasks":[1]}', 'utf8');

  const removed = await deleteFilesOutsideSnapshot(
    [cfg('__ws-external__', 'ws-x', '.dogear', 'tasks.json')],
    [anchorEntry('ws-x')],
  );

  expect(removed).toEqual([]);
  expect(fs.existsSync(path.join(dogear, 'tasks.json'))).toBe(true);
});

test('deleteFilesOutsideSnapshot：工作区已注销跳过该边界，不误删不报错', async () => {
  const unregistered = path.join(wsDiskRoot, 'unregistered-tasks.json');
  await fsp.writeFile(unregistered, '{"tasks":[]}', 'utf8');

  const removed = await deleteFilesOutsideSnapshot(
    [cfg('__ws-external__', 'ws-gone', '.dogear', 'tasks.json')],
    ['unrelated/entry.txt'],
  );

  expect(removed).toEqual([]);
  expect(fs.existsSync(unregistered)).toBe(true);
});

test('deleteFilesOutsideSnapshot：源不存在时跳过', async () => {
  const removed = await deleteFilesOutsideSnapshot([cfg('workspaces', 'ws-none', 'notes')], []);
  expect(removed).toEqual([]);
});

test('restoreBackup：空包 zip 拒绝恢复（预备份已先行完成）', async () => {
  await fsp.mkdir(cfg('workspaces', 'ws-r', 'notes'), { recursive: true });
  await fsp.writeFile(cfg('workspaces', 'ws-r', 'notes', 'keep.txt'), 'old', 'utf8');
  const emptyZip = 'notes-groups-20990101-000000.zip';
  await writeZip({}, cfg('backups', 'ws-r', emptyZip));
  const before = await backupZipCount('ws-r');

  await expect(restoreBackup('notes-groups', 'ws-r', emptyZip, undefined, { keep: 5 })).rejects.toThrow('空包');

  expect(await backupZipCount('ws-r')).toBe(before + 1);
});

test('restoreBackup：目标 zip 不存在直接拒绝，不产生预备份', async () => {
  const before = await backupZipCount('ws-r');
  await expect(restoreBackup('notes-groups', 'ws-r', 'notes-groups-20990101-000001.zip', undefined, { keep: 5 })).rejects.toThrow(
    '备份文件不存在',
  );
  expect(await backupZipCount('ws-r')).toBe(before);
});

test('restoreBackup：快照还原端到端——写回 zip 内条目、删除 zip 外文件、边界外不动', async () => {
  await fsp.mkdir(cfg('workspaces', 'ws-r', 'notes'), { recursive: true });
  await fsp.writeFile(cfg('workspaces', 'ws-r', 'notes', 'keep.txt'), 'old', 'utf8');
  await fsp.writeFile(cfg('workspaces', 'ws-r', 'notes', 'stale.txt'), 'stale', 'utf8');
  await fsp.mkdir(cfg('usage'), { recursive: true });
  await fsp.writeFile(cfg('usage', 'untouched.json'), '{}', 'utf8');
  const zipName = 'notes-groups-20990101-000002.zip';
  await writeZip({ 'workspaces/ws-r/notes/keep.txt': 'new' }, cfg('backups', 'ws-r', zipName));

  const r = await restoreBackup('notes-groups', 'ws-r', zipName, undefined, { keep: 5 });

  expect(r.restored).toContain('workspaces/ws-r/notes/keep.txt');
  expect(r.deleted).toContain('workspaces/ws-r/notes/stale.txt');
  expect(await fsp.readFile(cfg('workspaces', 'ws-r', 'notes', 'keep.txt'), 'utf8')).toBe('new');
  expect(fs.existsSync(cfg('workspaces', 'ws-r', 'notes', 'stale.txt'))).toBe(false);
  expect(r.preBackupFileName).not.toBeNull();
  expect(fs.existsSync(cfg('usage', 'untouched.json'))).toBe(true);
});
