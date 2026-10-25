import { test, expect, beforeEach, afterEach } from 'bun:test';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { migrateCustomResourcesIfNeeded } from './custom-resources-migration.js';

let configDir: string;

beforeEach(async () => {
  configDir = await fs.mkdtemp(path.join(os.tmpdir(), 'dogear-custom-mig-'));
});

afterEach(async () => {
  await fs.rm(configDir, { recursive: true, force: true });
});

test('skills/ 整目录迁入 custom/skills/，旧目录删除', async () => {
  await fs.mkdir(path.join(configDir, 'skills', 'my-skill'), { recursive: true });
  await fs.writeFile(path.join(configDir, 'skills', 'my-skill', 'SKILL.md'), '---\nname: my-skill\n---\nbody', 'utf-8');

  await migrateCustomResourcesIfNeeded(configDir);

  expect(await fs.readFile(path.join(configDir, 'custom', 'skills', 'my-skill', 'SKILL.md'), 'utf-8')).toContain('my-skill');
  await expect(fs.access(path.join(configDir, 'skills'))).rejects.toThrow();
});

test('custom/prompts/state-extract-prompt.md 死文件启动即删（消费方已退役）', async () => {
  await fs.mkdir(path.join(configDir, 'custom', 'prompts'), { recursive: true });
  await fs.writeFile(path.join(configDir, 'custom', 'prompts', 'state-extract-prompt.md'), '<!-- topic-state-extract v2 -->\n自定义', 'utf-8');

  await migrateCustomResourcesIfNeeded(configDir);

  await expect(fs.access(path.join(configDir, 'custom', 'prompts', 'state-extract-prompt.md'))).rejects.toThrow();
});

test('custom 已有同名 skill：旧侧改名 .legacy 留档，双方内容保留', async () => {
  await fs.mkdir(path.join(configDir, 'skills', 'dup'), { recursive: true });
  await fs.writeFile(path.join(configDir, 'skills', 'dup', 'SKILL.md'), 'old', 'utf-8');
  await fs.mkdir(path.join(configDir, 'custom', 'skills', 'dup'), { recursive: true });
  await fs.writeFile(path.join(configDir, 'custom', 'skills', 'dup', 'SKILL.md'), 'new', 'utf-8');

  await migrateCustomResourcesIfNeeded(configDir);

  expect(await fs.readFile(path.join(configDir, 'custom', 'skills', 'dup', 'SKILL.md'), 'utf-8')).toBe('new');
  expect(await fs.readFile(path.join(configDir, 'skills', 'dup.legacy', 'SKILL.md'), 'utf-8')).toBe('old');
});

test('死文件删除幂等：重复执行不报错，custom/prompts 目录保留', async () => {
  await fs.mkdir(path.join(configDir, 'custom', 'prompts'), { recursive: true });
  await fs.writeFile(path.join(configDir, 'custom', 'prompts', 'state-extract-prompt.md'), 'old-prompt', 'utf-8');
  await fs.writeFile(path.join(configDir, 'custom', 'prompts', 'user-note.md'), 'user content', 'utf-8');

  await migrateCustomResourcesIfNeeded(configDir);
  await migrateCustomResourcesIfNeeded(configDir);

  await expect(fs.access(path.join(configDir, 'custom', 'prompts', 'state-extract-prompt.md'))).rejects.toThrow();
  expect(await fs.readFile(path.join(configDir, 'custom', 'prompts', 'user-note.md'), 'utf-8')).toBe('user content');
});

test('幂等：无旧资产时仅保证 custom 子目录就位，重复执行无副作用', async () => {
  await fs.mkdir(path.join(configDir, 'skills'), { recursive: true });
  await fs.writeFile(path.join(configDir, 'skills', 'a.txt'), 'x', 'utf-8');

  await migrateCustomResourcesIfNeeded(configDir);
  await migrateCustomResourcesIfNeeded(configDir);

  expect(await fs.readFile(path.join(configDir, 'custom', 'skills', 'a.txt'), 'utf-8')).toBe('x');
  await expect(fs.access(path.join(configDir, 'skills'))).rejects.toThrow();
  await fs.access(path.join(configDir, 'custom', 'prompts'));
  await fs.access(path.join(configDir, 'custom', 'browser-extensions'));
});

test('README.md 首次写入，已存在（含用户修改）不覆盖', async () => {
  await migrateCustomResourcesIfNeeded(configDir);
  const readme = path.join(configDir, 'custom', 'README.md');
  expect(await fs.readFile(readme, 'utf-8')).toContain('mcp.json');

  await fs.writeFile(readme, 'my notes', 'utf-8');
  await migrateCustomResourcesIfNeeded(configDir);
  expect(await fs.readFile(readme, 'utf-8')).toBe('my notes');
});

test('无任何旧资产：custom 子目录仍创建，无异常', async () => {
  await migrateCustomResourcesIfNeeded(configDir);

  await fs.access(path.join(configDir, 'custom', 'skills'));
  await fs.access(path.join(configDir, 'custom', 'prompts'));
});
