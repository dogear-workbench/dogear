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

test('save 后 load 往返一致（含哨兵的自定义内容原样返回）', async () => {
  const dir = await tmpDir();
  const custom = `自定义复盘提示词

## 沉淀契约
（自定义正文）
`;
  await saveReviewPrompt(dir, custom);
  expect(await loadReviewPrompt(dir)).toBe(custom);
});

test('不含哨兵的旧版内容会被重播种为最新默认', async () => {
  const dir = await tmpDir();
  await saveReviewPrompt(dir, '旧版内容，没有沉淀契约段落');
  expect(await loadReviewPrompt(dir)).toBe(DEFAULT_REVIEW_PROMPT);
});
