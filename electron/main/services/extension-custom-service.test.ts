import { test, expect, beforeEach, afterEach } from 'bun:test';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {
  copyExtensionToCustom,
  customExtensionDir,
  getExtensionTarget,
  resetExtensionCustom,
} from './extension-custom-service.js';

let configDir: string;
let builtinDir: string;

beforeEach(async () => {
  configDir = await fs.mkdtemp(path.join(os.tmpdir(), 'dogear-ext-custom-cfg-'));
  builtinDir = await fs.mkdtemp(path.join(os.tmpdir(), 'dogear-ext-custom-builtin-'));
  await fs.writeFile(path.join(builtinDir, 'manifest.json'), JSON.stringify({ version: '0.5.1' }), 'utf-8');
  await fs.writeFile(path.join(builtinDir, 'bg.js'), 'builtin', 'utf-8');
});

afterEach(async () => {
  await fs.rm(configDir, { recursive: true, force: true });
  await fs.rm(builtinDir, { recursive: true, force: true });
});

test('无副本时指向内置目录，source=builtin 且不落后', async () => {
  const target = await getExtensionTarget(configDir, builtinDir);
  expect(target).toEqual({ path: builtinDir, source: 'builtin', outdated: false });
});

test('内置目录也缺失时 path 为 null', async () => {
  const target = await getExtensionTarget(configDir, path.join(builtinDir, 'nope'));
  expect(target).toEqual({ path: null, source: 'builtin', outdated: false });
});

test('复制后指向自定义副本且内容一致，outdated=false', async () => {
  const target = await copyExtensionToCustom(configDir, builtinDir);
  expect(target.source).toBe('custom');
  expect(target.path).toBe(customExtensionDir(configDir));
  expect(target.outdated).toBe(false);
  expect(await fs.readFile(path.join(target.path!, 'bg.js'), 'utf-8')).toBe('builtin');
});

test('副本版本落后于内置时 outdated=true，覆盖复制后回到一致', async () => {
  await copyExtensionToCustom(configDir, builtinDir);
  await fs.writeFile(path.join(builtinDir, 'manifest.json'), JSON.stringify({ version: '0.6.0' }), 'utf-8');

  const stale = await getExtensionTarget(configDir, builtinDir);
  expect(stale.outdated).toBe(true);

  const updated = await copyExtensionToCustom(configDir, builtinDir);
  expect(updated.outdated).toBe(false);
  expect(await fs.readFile(path.join(customExtensionDir(configDir), 'manifest.json'), 'utf-8')).toContain('0.6.0');
});

test('副本 manifest 缺失视为落后', async () => {
  await copyExtensionToCustom(configDir, builtinDir);
  await fs.rm(path.join(customExtensionDir(configDir), 'manifest.json'));
  const target = await getExtensionTarget(configDir, builtinDir);
  expect(target.source).toBe('custom');
  expect(target.outdated).toBe(true);
});

test('内置目录缺失时复制被拒绝且不产生副本', async () => {
  await expect(copyExtensionToCustom(configDir, path.join(builtinDir, 'nope'))).rejects.toThrow('内置扩展目录不存在');
  await expect(fs.access(customExtensionDir(configDir))).rejects.toThrow();
});

test('恢复默认删除副本，回指内置目录', async () => {
  await copyExtensionToCustom(configDir, builtinDir);
  const target = await resetExtensionCustom(configDir, builtinDir);
  expect(target).toEqual({ path: builtinDir, source: 'builtin', outdated: false });
  await expect(fs.access(customExtensionDir(configDir))).rejects.toThrow();
});

test('无副本时恢复默认是无害空操作', async () => {
  const target = await resetExtensionCustom(configDir, builtinDir);
  expect(target.source).toBe('builtin');
});
