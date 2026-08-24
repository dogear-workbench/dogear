import { test, expect } from 'bun:test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { DEFAULT_CATEGORIZE_PROMPT, loadCategorizePrompt, saveCategorizePrompt } from './categorize-prompt.ts';

test('默认提示词包含决策原则与工具说明', () => {
  expect(DEFAULT_CATEGORIZE_PROMPT).toContain('dogear__SaveCategoryJoin');
  expect(DEFAULT_CATEGORIZE_PROMPT).toContain('dogear__SaveCategoryNew');
  expect(DEFAULT_CATEGORIZE_PROMPT).toContain('分类宁可宽不要窄');
  expect(DEFAULT_CATEGORIZE_PROMPT).toContain('atLimit'); // 上限以 dogear__ListCategories 返回值为准
  expect(DEFAULT_CATEGORIZE_PROMPT).toContain('调 dogear__ListCategories'); // 流程第一步
});

test('loadCategorizePrompt 首次缺失自动播种', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'categorize-prompt-test-'));
  try {
    const content = await loadCategorizePrompt(dir);
    expect(content).toBe(DEFAULT_CATEGORIZE_PROMPT);
    // 文件确实被写入
    const onDisk = await fs.readFile(path.join(dir, 'categorize-prompt.md'), 'utf-8');
    expect(onDisk).toBe(DEFAULT_CATEGORIZE_PROMPT);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test('saveCategorizePrompt + loadCategorizePrompt round-trip（含哨兵的自定义内容原样返回）', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'categorize-prompt-test-'));
  try {
    const custom = `自定义提示词开头

一个组只能在一个分类里
（自定义正文）
`;
    await saveCategorizePrompt(dir, custom);
    const content = await loadCategorizePrompt(dir);
    expect(content).toBe(custom);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test('不含哨兵的旧版内容会被重播种为最新默认', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'categorize-prompt-test-'));
  try {
    await saveCategorizePrompt(dir, '旧版内容，没有哨兵句');
    expect(await loadCategorizePrompt(dir)).toBe(DEFAULT_CATEGORIZE_PROMPT);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});
