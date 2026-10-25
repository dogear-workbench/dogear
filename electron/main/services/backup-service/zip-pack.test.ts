import { test, expect, mock } from 'bun:test';
import fsp from 'node:fs/promises';
import fs from 'node:fs';
import path from 'node:path';
import { tmpdir } from 'node:os';
import AdmZip from 'adm-zip';

process.env.DOGEAR_CONFIG_DIR = await fsp.mkdtemp(path.join(tmpdir(), 'dogear-zip-pack-'));

mock.module('electron', () => ({
  default: { app: { getPath: () => tmpdir() }, nativeTheme: {} },
  app: { getPath: () => tmpdir() },
  nativeTheme: {},
}));

const { packSources } = await import('./zip-pack.js');

const configDir = () => process.env.DOGEAR_CONFIG_DIR!;
const cfg = (...segs: string[]) => path.join(configDir(), ...segs);

async function seedFixtures(): Promise<{ sources: string[] }> {
  await fsp.mkdir(cfg('notes'), { recursive: true });
  await fsp.writeFile(cfg('notes', 'todo.md'), 'todo-content', 'utf8');
  await fsp.writeFile(cfg('settings.json'), '{"k":1}', 'utf8');
  await fsp.mkdir(cfg('sessions', 'conv-a'), { recursive: true });
  await fsp.writeFile(cfg('sessions', 'conv-a', 's1.json'), '{"id":1}', 'utf8');
  await fsp.writeFile(cfg('sessions', 'conv-a', 's2.json'), '{"id":2}', 'utf8');
  await fsp.mkdir(cfg('workspaces', 'ws-x'), { recursive: true });
  await fsp.writeFile(cfg('workspaces', 'ws-x', 'tasks.json'), '{"tasks":[]}', 'utf8');
  return {
    sources: [
      cfg('notes', 'todo.md'),
      cfg('sessions'),
      cfg('settings.json'),
      cfg('workspaces', 'ws-x', 'tasks.json'),
      cfg('missing.txt'),
    ],
  };
}

test('packSources：普通源 + 工作区子树 + 不存在源跳过（worker 不可用时回退主进程分片）', async () => {
  const { sources } = await seedFixtures();
  const outZip = cfg('out.zip');
  const count = await packSources(sources, outZip);
  expect(count).toBe(6);

  const zip = new AdmZip(outZip);
  const names = zip.getEntries().map((e) => e.entryName).sort();
  expect(names).toContain('notes/todo.md');
  expect(names).toContain('settings.json');
  expect(names).toContain('sessions/conv-a/s1.json');
  expect(names).toContain('sessions/conv-a/s2.json');
  expect(names).toContain('workspaces/ws-x/tasks.json');
  expect(zip.readAsText('notes/todo.md')).toBe('todo-content');
  expect(zip.readAsText('workspaces/ws-x/tasks.json')).toBe('{"tasks":[]}');
});

test('packSources：全部源无效返回 0 且不写盘', async () => {
  const outZip = cfg('empty.zip');
  const count = await packSources([cfg('missing.txt'), cfg('nope-dir')], outZip);
  expect(count).toBe(0);
  expect(fs.existsSync(outZip)).toBe(false);
});

test('packSources：空源列表返回 0 且不写盘', async () => {
  const outZip = cfg('none.zip');
  expect(await packSources([], outZip)).toBe(0);
  expect(fs.existsSync(outZip)).toBe(false);
});
