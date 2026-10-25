import { test, expect, mock } from 'bun:test';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import AdmZip from 'adm-zip';

process.env.DOGEAR_CONFIG_DIR = await fsp.mkdtemp(path.join(tmpdir(), 'dogear-src-sig-'));

mock.module('electron', () => ({
  default: { app: { getPath: () => tmpdir() }, nativeTheme: {} },
  app: { getPath: () => tmpdir() },
  nativeTheme: {},
}));

const { computeSourceSignature } = await import('./source-signature.js');
const { resolveSourceEntries } = await import('./zip-pack.js');
const { collectPackFiles } = await import('./zip-pack-core.js');
const { backupSourcesFor } = await import('../data-registry.js');
const { packSources } = await import('./zip-pack.js');

const cfg = (...segs: string[]) => path.join(process.env.DOGEAR_CONFIG_DIR!, ...segs);

async function seedFixtures(): Promise<string[]> {
  await fsp.mkdir(cfg('notes'), { recursive: true });
  await fsp.writeFile(cfg('notes', 'a.md'), 'aaa', 'utf8');
  await fsp.writeFile(cfg('notes', 'b.md'), 'bbbb', 'utf8');
  await fsp.writeFile(cfg('settings.json'), '{"k":1}', 'utf8');
  await fsp.mkdir(cfg('workspaces', 'ws-x'), { recursive: true });
  await fsp.writeFile(cfg('workspaces', 'ws-x', 'tasks.json'), '{"tasks":[]}', 'utf8');
  return [cfg('notes'), cfg('settings.json'), cfg('workspaces', 'ws-x', 'tasks.json'), cfg('missing.txt')];
}

test('computeSourceSignature：稳定且不含不存在源；全部无效 → null', async () => {
  const sources = await seedFixtures();
  const sig1 = await computeSourceSignature(sources);
  const sig2 = await computeSourceSignature(sources);
  expect(sig1).toMatch(/^[0-9a-f]{40}$/);
  expect(sig1).toBe(sig2);
  expect(await computeSourceSignature([cfg('missing.txt'), cfg('nope-dir')])).toBeNull();
  expect(await computeSourceSignature([])).toBeNull();
});

test('签名遍历与 packSources 打包文件集合一致（含工作区子树、跳过不存在源）', async () => {
  const sources = await seedFixtures();
  const outZip = cfg('out.zip');
  expect(await packSources(sources, outZip)).toBeGreaterThan(0);
  const zip = new AdmZip(outZip);
  const zipFiles = new Set(zip.getEntries().filter((e) => !e.isDirectory).map((e) => e.entryName));
  const collected = new Set((await collectPackFiles(await resolveSourceEntries(sources))).map((f) => f.entryPath));
  expect(collected).toEqual(zipFiles);
  expect(collected.has('workspaces/ws-x/tasks.json')).toBe(true);
});

test('签名对 mtime 变化敏感', async () => {
  const sources = await seedFixtures();
  const base = await computeSourceSignature(sources);
  const target = cfg('notes', 'a.md');
  const st = await fsp.stat(target);
  await fsp.utimes(target, st.atime, new Date(st.mtimeMs - 10 * 60 * 1000));
  expect(await computeSourceSignature(sources)).not.toBe(base);
});

test('签名对 size 变化敏感', async () => {
  const sources = await seedFixtures();
  const base = await computeSourceSignature(sources);
  await fsp.writeFile(cfg('notes', 'a.md'), 'aaaaaaaaa', 'utf8');
  expect(await computeSourceSignature(sources)).not.toBe(base);
});

test('签名对新增/删除文件敏感', async () => {
  const sources = await seedFixtures();
  const base = await computeSourceSignature(sources);
  await fsp.writeFile(cfg('notes', 'c.md'), 'c', 'utf8');
  const added = await computeSourceSignature(sources);
  expect(added).not.toBe(base);
  await fsp.unlink(cfg('notes', 'a.md'));
  await fsp.unlink(cfg('notes', 'b.md'));
  await fsp.unlink(cfg('notes', 'c.md'));
  expect(await computeSourceSignature(sources)).not.toBe(added);
});

test('签名遍历真实 registry 源（app-config×global）', async () => {
  await seedFixtures();
  const sources = await backupSourcesFor('app-config', 'global');
  const sig = await computeSourceSignature(sources);
  expect(sig).toMatch(/^[0-9a-f]{40}$/);
  await fsp.writeFile(cfg('plans.json'), '{"plans":[]}', 'utf8');
  expect(await computeSourceSignature(sources)).not.toBe(sig);
});
