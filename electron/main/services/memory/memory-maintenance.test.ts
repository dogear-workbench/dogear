import { test, expect, mock } from 'bun:test';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';

process.env.DOGEAR_CONFIG_DIR = await fsp.mkdtemp(path.join(tmpdir(), 'dogear-mem-maint-'));

mock.module('electron', () => ({
  default: { app: { getPath: () => tmpdir() }, nativeTheme: {} },
  app: { getPath: () => tmpdir() },
  nativeTheme: {},
}));

const {
  isMemorySyncRelPath,
  parseMemoryRepairTarget,
  repairMemoryPathsNow,
} = await import('./memory-maintenance.js');
const { readIndex } = await import('./memory-indexer.js');

const cfgDir = () => process.env.DOGEAR_CONFIG_DIR!;

function topicFile(slug: string, title: string, updated: string): string {
  return [`---`, `title: ${title}`, `slug: ${slug}`, `keywords: [k-${slug}]`, `created: ${updated}`, `updated: ${updated}`, `---`, '', `正文 ${slug}`, ''].join('\n');
}

async function makeWorkspaceMemory(wsId: string, indexSlugs: string[], diskSlugs: string[], garbage: string[] = []): Promise<void> {
  const topicsDir = path.join(cfgDir(), 'workspaces', wsId, 'memory', 'topics');
  await fsp.mkdir(topicsDir, { recursive: true });
  for (const slug of diskSlugs) {
    await fsp.writeFile(path.join(topicsDir, `${slug}.md`), topicFile(slug, `主题 ${slug}`, '2026-10-01T00:00:00.000Z'));
  }
  for (const g of garbage) {
    await fsp.writeFile(path.join(topicsDir, g), 'garbage');
  }
  const index = {
    version: 1,
    updated: '2026-10-01T00:00:00.000Z',
    topics: indexSlugs.map((slug) => ({ slug, title: `主题 ${slug}`, keywords: [`k-${slug}`], updated: '2026-10-01T00:00:00.000Z' })),
  };
  await fsp.writeFile(path.join(cfgDir(), 'workspaces', wsId, 'memory', 'index.json'), JSON.stringify(index, null, 2));
}

test('relPath 解析：memory 前缀与 workspaces/{wsid}/memory 命中，其余不命中', () => {
  expect(isMemorySyncRelPath('memory/topics/a.md')).toBe(true);
  expect(isMemorySyncRelPath('workspaces/ws1/memory/index.json')).toBe(true);
  expect(isMemorySyncRelPath('workspaces/ws1/notes/a.md')).toBe(false);
  expect(isMemorySyncRelPath('agent.md')).toBe(false);
  expect(parseMemoryRepairTarget('memory/topics/a.md')).toEqual({ scope: 'global', workspaceId: '' });
  expect(parseMemoryRepairTarget('workspaces/ws1/memory/topics/a.md')).toEqual({ scope: 'workspace', workspaceId: 'ws1' });
  expect(parseMemoryRepairTarget('custom/skills/x.md')).toBeNull();
});

test('repairMemoryPathsNow：孤儿文件重建索引 + 垃圾清理，幂等无扰动', async () => {
  await makeWorkspaceMemory(
    'ws1',
    ['a'],
    ['a', 'b'],
    ['c.md.bak', 'd.md.conflict-4cc497-20261006-120000-ab12', 'index.json.tmp'],
  );

  const first = await repairMemoryPathsNow(['workspaces/ws1/memory/topics/b.md']);
  expect(first.outcomes).toHaveLength(1);
  expect(first.outcomes[0].rebuiltIndex).toBe(true);
  expect(first.outcomes[0].garbageRemoved.length).toBe(3);

  const index = await readIndex('ws1', 'workspace');
  expect(index.topics.map((t) => t.slug).sort()).toEqual(['a', 'b']);

  const topicsDir = path.join(cfgDir(), 'workspaces', 'ws1', 'memory', 'topics');
  const remaining = await fsp.readdir(topicsDir);
  expect(remaining.sort()).toEqual(['a.md', 'b.md']);

  const second = await repairMemoryPathsNow(['workspaces/ws1/memory/topics/b.md']);
  // 第一轮 rebuild 的 safe-write 会留下新的 index.json.bak，第二轮顺带清掉（rebuiltIndex 应为 false）
  expect(second.outcomes).toHaveLength(1);
  expect(second.outcomes[0].rebuiltIndex).toBe(false);
  expect(second.outcomes[0].garbageRemoved).toEqual(['workspace:ws1/index.json.bak']);

  const third = await repairMemoryPathsNow(['workspaces/ws1/memory/topics/b.md']);
  expect(third.outcomes).toHaveLength(0);
});

test('repairMemoryPathsNow：全局 memory 目录同样可修，非 memory 路径空操作', async () => {
  const globalTopics = path.join(cfgDir(), 'memory', 'topics');
  await fsp.mkdir(globalTopics, { recursive: true });
  await fsp.writeFile(path.join(globalTopics, 'g1.md'), topicFile('g1', '全局主题', '2026-10-01T00:00:00.000Z'));
  await fsp.writeFile(path.join(globalTopics, 'g1.md.bak'), 'bak');

  const summary = await repairMemoryPathsNow(['memory/topics/g1.md']);
  expect(summary.outcomes).toHaveLength(1);
  expect(summary.outcomes[0].target.scope).toBe('global');
  const index = await readIndex('', 'global');
  expect(index.topics.map((t) => t.slug)).toEqual(['g1']);
  expect(await fsp.readdir(globalTopics)).toEqual(['g1.md']);

  const noop = await repairMemoryPathsNow(['custom/skills/x.md']);
  expect(noop.outcomes).toHaveLength(0);
});
