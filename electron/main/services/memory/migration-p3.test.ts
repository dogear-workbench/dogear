import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { migrateSmartCategories } from './migration-p3.ts';
import type { ConversationIndex } from '../conversation-service.js';

let dir: string;

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'migration-p3-test-'));
});

afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true });
});

function wsPath(wsId: string): string {
  return path.join(dir, 'workspaces', wsId, 'smart-categories.json');
}

const convs = [
  { id: 'conv-1', groupId: 'group-1' },
  { id: 'conv-2', groupId: 'group-2' },
] as unknown as ConversationIndex[];

describe('migrateSmartCategories', () => {
  test('旧格式：conversationIds 正常映射为 groupIds', async () => {
    await fs.mkdir(path.dirname(wsPath('ws1')), { recursive: true });
    await fs.writeFile(wsPath('ws1'), JSON.stringify({
      categories: [
        { id: 'cat1', name: 'A', anchorTags: [], conversationIds: ['conv-1', 'conv-2', 'conv-x'] },
      ],
      recentDecisions: [],
    }), 'utf-8');

    await migrateSmartCategories(dir, 'ws1', convs);

    const data = JSON.parse(await fs.readFile(wsPath('ws1'), 'utf-8'));
    expect(data.schemaVersion).toBe(2);
    expect(data.categories[0].groupIds).toEqual(['group-1', 'group-2']);
    expect(data.categories[0].conversationIds).toBeUndefined();
  });

  test('新格式无 schemaVersion：迁移不得清空现有 groupIds', async () => {
    await fs.mkdir(path.dirname(wsPath('ws2')), { recursive: true });
    await fs.writeFile(wsPath('ws2'), JSON.stringify({
      categories: [
        { id: 'cat1', name: 'A', anchorTags: [], groupIds: ['group-1', 'group-9'] },
      ],
      recentDecisions: [],
    }), 'utf-8');

    await migrateSmartCategories(dir, 'ws2', convs);

    const data = JSON.parse(await fs.readFile(wsPath('ws2'), 'utf-8'));
    expect(data.schemaVersion).toBe(2);
    expect(data.categories[0].groupIds).toEqual(['group-1', 'group-9']);
  });

  test('旧格式残留 groupIds 与映射结果合并去重', async () => {
    await fs.mkdir(path.dirname(wsPath('ws3')), { recursive: true });
    await fs.writeFile(wsPath('ws3'), JSON.stringify({
      categories: [
        { id: 'cat1', name: 'A', anchorTags: [], conversationIds: ['conv-1'], groupIds: ['group-2'] },
      ],
      recentDecisions: [],
    }), 'utf-8');

    await migrateSmartCategories(dir, 'ws3', convs);

    const data = JSON.parse(await fs.readFile(wsPath('ws3'), 'utf-8'));
    expect(data.categories[0].groupIds).toEqual(['group-2', 'group-1']);
  });

  test('已有 schemaVersion: 2：跳过不重写', async () => {
    await fs.mkdir(path.dirname(wsPath('ws4')), { recursive: true });
    const original = { schemaVersion: 2, categories: [], recentDecisions: [] };
    await fs.writeFile(wsPath('ws4'), JSON.stringify(original), 'utf-8');

    await migrateSmartCategories(dir, 'ws4', convs);

    const raw = await fs.readFile(wsPath('ws4'), 'utf-8');
    expect(JSON.parse(raw)).toEqual(original);
  });

  test('文件不存在：无操作不报错', async () => {
    await migrateSmartCategories(dir, 'ws-not-exist', convs);
  });
});
