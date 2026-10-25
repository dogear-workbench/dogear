import { test, expect, mock } from 'bun:test';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';

process.env.DOGEAR_CONFIG_DIR = await fsp.mkdtemp(path.join(tmpdir(), 'dogear-site-knowledge-'));
mock.module('electron', () => ({
  default: { app: { getPath: () => tmpdir() } },
  app: { getPath: () => tmpdir() },
}));

const { listSiteKnowledge, readSiteKnowledge } = await import('./site-knowledge-service.js');

const knowledgeDir = () => path.join(process.env.DOGEAR_CONFIG_DIR!, 'site-knowledge');

async function writeProfile(domain: string, content: string): Promise<void> {
  await fsp.mkdir(knowledgeDir(), { recursive: true });
  await fsp.writeFile(path.join(knowledgeDir(), `${domain}.md`), content, 'utf-8');
}

test('listSiteKnowledge：两区条目计数（正式地图/探索发现各数 `- ` 行，占位文字不算）', async () => {
  await writeProfile('example.com', [
    '# example.com 站点档案',
    '',
    '## 正式地图（已验证）',
    '- /articles 列表页',
    '- /detail/:id 详情页',
    '（暂无，由人工或主会话审核「探索发现」后合并至此）',
    '',
    '## 探索发现（未验证，由会话追加）',
    '- [2026-10-11 · abc12345] 评论接口分页参数是 offset',
    '- [2026-10-12 · abc12345] 详情页有登录墙',
    '',
  ].join('\n'));
  await writeProfile('empty.org', [
    '# empty.org 站点档案',
    '',
    '## 正式地图（已验证）',
    '（暂无）',
    '',
    '## 探索发现（未验证，由会话追加）',
    '',
  ].join('\n'));

  const entries = listSiteKnowledge();
  const example = entries.find((e) => e.domain === 'example.com')!;
  expect(example.verifiedCount).toBe(2);
  expect(example.discoveryCount).toBe(2);
  const empty = entries.find((e) => e.domain === 'empty.org')!;
  expect(empty.verifiedCount).toBe(0);
  expect(empty.discoveryCount).toBe(0);
});

test('readSiteKnowledge：存在读全文，不存在 exists:false', async () => {
  const r = await Promise.resolve(readSiteKnowledge('example.com'));
  expect(r.exists).toBe(true);
  expect(r.content).toContain('正式地图');
  expect(readSiteKnowledge('no-such.example').exists).toBe(false);
});

test('listSiteKnowledge：目录不存在返回空数组', async () => {
  process.env.DOGEAR_CONFIG_DIR = await fsp.mkdtemp(path.join(tmpdir(), 'dogear-site-knowledge-empty-'));
  expect(listSiteKnowledge()).toEqual([]);
});
