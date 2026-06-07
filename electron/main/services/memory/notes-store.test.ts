import { test, expect } from 'bun:test';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { readNotesFrom, saveNotesTo } from './notes-store.ts';

test('空目录读 → 空串', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'notes-'));
  expect(await readNotesFrom(dir)).toBe('');
});

test('save 后 read 往返', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'notes-'));
  await saveNotesTo(dir, '# 速记\n买牛奶');
  expect(await readNotesFrom(dir)).toBe('# 速记\n买牛奶');
});
