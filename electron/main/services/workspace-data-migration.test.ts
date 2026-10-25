import { test, expect, beforeEach, afterEach } from 'bun:test';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { migrateWorkspaceDataIfNeeded } from './workspace-data-migration.js';
import { resetWorkspaceDataConfigDir } from './workspace-data-root.js';

let workspacePath: string;
let configDir: string;
const WS_ID = 'ws-mig';

beforeEach(async () => {
  workspacePath = await fs.mkdtemp(path.join(os.tmpdir(), 'dogear-mig-ws-'));
  configDir = await fs.mkdtemp(path.join(os.tmpdir(), 'dogear-mig-cfg-'));
  resetWorkspaceDataConfigDir();
  process.env.DOGEAR_CONFIG_DIR = configDir;
  await fs.mkdir(path.join(configDir, 'workspaces'), { recursive: true });
  await fs.writeFile(
    path.join(configDir, 'workspaces', 'workspaces.json'),
    JSON.stringify({ version: 1, workspaces: [{ id: WS_ID, name: 'mig', path: workspacePath, additionalPaths: [], isDefault: true, createdAt: '2026-01-01T00:00:00.000Z' }] }),
    'utf-8',
  );
});

afterEach(async () => {
  delete process.env.DOGEAR_CONFIG_DIR;
  resetWorkspaceDataConfigDir();
});

function legacyRoot(): string {
  return path.join(workspacePath, '.dogear');
}

function targetRoot(): string {
  return path.join(configDir, 'workspaces', WS_ID);
}

test('旧 tasks.json 与 articles 搬入 configDir，空 .dogear 删除', async () => {
  await fs.mkdir(path.join(legacyRoot(), 'articles', 'a1'), { recursive: true });
  await fs.writeFile(path.join(legacyRoot(), 'tasks.json'), '{"version":3,"tasks":[]}', 'utf-8');
  await fs.writeFile(path.join(legacyRoot(), 'articles', 'a1', 'meta.json'), '{}', 'utf-8');

  await migrateWorkspaceDataIfNeeded();

  expect(await fs.readFile(path.join(targetRoot(), 'tasks.json'), 'utf-8')).toBe('{"version":3,"tasks":[]}');
  await fs.access(path.join(targetRoot(), 'articles', 'a1', 'meta.json'));
  await expect(fs.access(legacyRoot())).rejects.toThrow();
});

test('目标已存在：保留目标，旧位置改名 .migrated-留档，非空 .dogear 保留', async () => {
  await fs.mkdir(path.join(legacyRoot(), 'articles'), { recursive: true });
  await fs.writeFile(path.join(legacyRoot(), 'tasks.json'), '{"old":true}', 'utf-8');
  await fs.writeFile(path.join(legacyRoot(), 'keep.txt'), '无关文件', 'utf-8');
  await fs.mkdir(targetRoot(), { recursive: true });
  await fs.writeFile(path.join(targetRoot(), 'tasks.json'), '{"new":true}', 'utf-8');

  await migrateWorkspaceDataIfNeeded();

  expect(await fs.readFile(path.join(targetRoot(), 'tasks.json'), 'utf-8')).toBe('{"new":true}');
  const legacyEntries = await fs.readdir(legacyRoot());
  expect(legacyEntries).toContain('keep.txt');
  const migrated = legacyEntries.find((n) => n.startsWith('tasks.json.migrated-'));
  expect(migrated).toBeTruthy();
  expect(await fs.readFile(path.join(legacyRoot(), migrated!), 'utf-8')).toBe('{"old":true}');
});

test('幂等：重复执行无副作用，不留第二份 .migrated', async () => {
  await fs.mkdir(path.join(legacyRoot(), 'articles'), { recursive: true });
  await fs.writeFile(path.join(legacyRoot(), 'tasks.json'), '{"version":3,"tasks":[]}', 'utf-8');

  await migrateWorkspaceDataIfNeeded();
  await migrateWorkspaceDataIfNeeded();
  await migrateWorkspaceDataIfNeeded();

  const legacyEntries = await fs.readdir(legacyRoot()).catch(() => [] as string[]);
  expect(legacyEntries.filter((n) => n.startsWith('tasks.json.migrated-'))).toHaveLength(0);
  expect(await fs.readdir(targetRoot()).catch(() => [])).toContain('tasks.json');
});

test('无旧数据：不创建目标目录，无副作用', async () => {
  await migrateWorkspaceDataIfNeeded();
  await expect(fs.access(targetRoot())).rejects.toThrow();
});
