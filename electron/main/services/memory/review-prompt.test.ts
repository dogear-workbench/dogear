import { test, expect } from 'bun:test';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { loadReviewPrompt, saveReviewPrompt, DEFAULT_REVIEW_PROMPT } from './review-prompt.ts';

async function tmpDir() {
  return await fs.mkdtemp(path.join(os.tmpdir(), 'review-prompt-'));
}

test('首次加载播种默认提示词', async () => {
  const dir = await tmpDir();
  const p = await loadReviewPrompt(dir);
  expect(p).toBe(DEFAULT_REVIEW_PROMPT);
  const onDisk = await fs.readFile(path.join(dir, 'review-prompt.md'), 'utf-8');
  expect(onDisk).toBe(DEFAULT_REVIEW_PROMPT);
});

test('save 后 load 往返一致', async () => {
  const dir = await tmpDir();
  await saveReviewPrompt(dir, '自定义复盘提示词');
  expect(await loadReviewPrompt(dir)).toBe('自定义复盘提示词');
});
