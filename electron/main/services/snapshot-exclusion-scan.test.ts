import { test, expect, beforeAll, afterAll } from 'bun:test';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { scanWorkspaceExcludedPaths } from './snapshot-exclusion-scan.js';

let root = '';

beforeAll(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'dogear-scan-'));
});

afterAll(async () => {
  if (root) await fs.rm(root, { recursive: true, force: true });
});

test('顶层与嵌套名单目录全找到，命中即剪枝，排序且正斜杠', async () => {
  await fs.mkdir(path.join(root, 'node_modules', 'pkg'), { recursive: true });
  await fs.mkdir(path.join(root, 'a', 'node_modules', 'deep', 'node_modules'), { recursive: true });
  await fs.mkdir(path.join(root, 'a', 'dist'), { recursive: true });
  await fs.mkdir(path.join(root, '.git', 'objects'), { recursive: true });
  await fs.mkdir(path.join(root, 'src', 'utils'), { recursive: true });
  expect(await scanWorkspaceExcludedPaths(root)).toEqual(['.git', 'a/dist', 'a/node_modules', 'node_modules']);
});

test('普通目录按段路径深入，未被名单覆盖的深层名单目录仍列出', async () => {
  await fs.mkdir(path.join(root, 'src', 'tmp'), { recursive: true });
  expect(await scanWorkspaceExcludedPaths(root)).toContain('src/tmp');
});

test('不存在路径与空目录返回空数组', async () => {
  expect(await scanWorkspaceExcludedPaths(path.join(root, 'no-such-dir'))).toEqual([]);
  const empty = await fs.mkdtemp(path.join(os.tmpdir(), 'dogear-scan-empty-'));
  try {
    expect(await scanWorkspaceExcludedPaths(empty)).toEqual([]);
  } finally {
    await fs.rm(empty, { recursive: true, force: true });
  }
});
