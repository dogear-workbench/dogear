import { describe, expect, mock, test } from 'bun:test';
import fsp from 'node:fs/promises';
import fs from 'node:fs';
import path from 'path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { BACKGROUND_CONTEXT } from '@earendil-works/chord/context';

process.env.DOGEAR_CONFIG_DIR = await fsp.mkdtemp(path.join(tmpdir(), 'dogear-session-search-'));

mock.module('electron', () => ({
  default: { app: { getPath: () => tmpdir(), on: () => {} }, nativeTheme: {} },
  app: { getPath: () => tmpdir(), on: () => {} },
  nativeTheme: {},
  ipcMain: { handle: () => {}, on: () => {} },
}));

const { searchSessions } = await import('./session-search-service.js');
const { getPiSessionRepository } = await import('../agents/pi-session/pi-session-repository.js');

const WS = 'ws-search-test';
const configDir = process.env.DOGEAR_CONFIG_DIR!;
const wsDir = path.join(configDir, 'workspaces', WS);

interface SeedMessage {
  role: 'user' | 'assistant' | 'toolResult';
  content: unknown;
  ts: number;
}

async function seedSession(messages: SeedMessage[]): Promise<string> {
  const repo = getPiSessionRepository();
  const { storage, info } = await repo.create(WS, randomUUID());
  try {
    const writes = await Promise.all(messages.map(async (m, i) => ({
      type: 'entry' as const,
      value: {
        id: await storage.mintId(),
        conversationId: info.conversationId,
        kind: m.role === 'user' ? 'pi.user' : m.role === 'assistant' ? 'pi.assistant' : 'pi.tool-result',
        model: [{ ...m, timestamp: m.ts }],
        ...(m.role === 'toolResult' ? { data: { diagnostics: [] } } : {}),
      },
    })));
    for (let i = 0; i < writes.length; i += 100) {
      await storage.commit(writes.slice(i, i + 100), BACKGROUND_CONTEXT);
    }
  } finally {
    await storage.close(BACKGROUND_CONTEXT);
  }
  return info.id;
}

interface SeedConversation {
  id: string;
  sessionId?: string;
  groupId?: string;
  role?: 'main' | 'sub';
  title?: string;
  updatedAt: string;
}

async function seedConversations(convs: SeedConversation[]): Promise<void> {
  await fsp.mkdir(wsDir, { recursive: true });
  const file = {
    version: 2,
    conversations: Object.fromEntries(convs.map((c) => [c.id, {
      id: c.id,
      title: c.title ?? `会话 ${c.id}`,
      sessionId: c.sessionId ?? null,
      workspaceId: WS,
      parentConversationId: null,
      forkMessageSdkUuid: null,
      modelSelection: null,
      groupId: c.groupId,
      role: c.role ?? 'main',
      createdAt: c.updatedAt,
      updatedAt: c.updatedAt,
    }])),
  };
  await fsp.writeFile(path.join(wsDir, 'conversations.json'), JSON.stringify(file), 'utf8');
}

async function seedGroups(groups: Array<{ id: string; title?: string; archivedAt?: number }>): Promise<void> {
  await fsp.mkdir(wsDir, { recursive: true });
  const now = Date.now();
  await fsp.writeFile(path.join(wsDir, 'groups.json'), JSON.stringify({
    version: 2,
    groups: groups.map((g) => ({
      id: g.id,
      ...(g.title !== undefined ? { title: g.title } : {}),
      createdAt: now,
      updatedAt: now,
      ...(g.archivedAt !== undefined ? { archivedAt: g.archivedAt } : {}),
    })),
  }), 'utf8');
}

async function seedSharedFile(groupId: string, relPath: string, content: string, mtimeMs?: number): Promise<string> {
  const abs = path.join(wsDir, 'groups', groupId, 'shared', relPath);
  await fsp.mkdir(path.dirname(abs), { recursive: true });
  await fsp.writeFile(abs, content, 'utf8');
  if (mtimeMs !== undefined) await fsp.utimes(abs, new Date(mtimeMs), new Date(mtimeMs));
  return abs;
}

const text = (t: string) => [{ type: 'text', text: t }];

describe('searchSessions', () => {
  test('queries 每词校验：过短、全空、超 5 个抛错', async () => {
    await expect(searchSessions(WS, { queries: ['a'] })).rejects.toThrow('至少');
    await expect(searchSessions(WS, { queries: ['   '] })).rejects.toThrow('至少');
    await expect(searchSessions(WS, { queries: [] })).rejects.toThrow('至少');
    await expect(searchSessions(WS, { queries: ['词一词一', '词二词二', '词三词三', '词四词四', '词五词五', '词六词六'] })).rejects.toThrow('最多');
  });

  test('命中 user/assistant 文本；thinking 与 toolResult 不参与匹配；matchedTerms 标注', async () => {
    const sid = await seedSession([
      { role: 'user', content: '今天讨论琥珀色主题的落地', ts: 1000 },
      { role: 'assistant', content: [
        { type: 'thinking', thinking: '用户提到琥珀色，我理解为颜色方案' },
        { type: 'text', text: '好的，琥珀色方案记下了' },
      ], ts: 1001 },
      { role: 'user', content: text('run tool'), ts: 1002 },
      { role: 'assistant', content: [{ type: 'toolCall', id: 'tc1', name: 'read', arguments: {} }], ts: 1003 },
      { role: 'toolResult', content: text('工具输出里提到琥珀色但不应命中'), ts: 1004 },
    ]);
    await seedConversations([{ id: 'conv-a', sessionId: sid, groupId: 'g1', updatedAt: '2026-10-18T10:00:00.000Z' }]);

    const r = await searchSessions(WS, { queries: ['琥珀色'] });
    expect(r.sessionHits).toHaveLength(1);
    expect(r.sessionHits[0].sessionId).toBe(sid);
    expect(r.sessionHits[0].matchedTerms).toEqual(['琥珀色']);
    expect(r.sessionHits[0].matches).toHaveLength(2);
    expect(r.sessionHits[0].matches[0]).toMatchObject({ role: 'user' });
    expect(r.sessionHits[0].matches[1]).toMatchObject({ role: 'assistant' });
    expect(r.sessionHits[0].titleMatched).toBe(false);
    expect(r.stoppedBy).toBe('completed');
    expect(r.totalCandidates).toBe(1);
    expect(r.scanned).toBe(1);
  });

  test('多词 OR：任一词命中即候选，各 hit 标注各自命中的词', async () => {
    const sidA = await seedSession([{ role: 'user', content: '聊聊荔枝的保鲜方法', ts: 1000 }]);
    const sidB = await seedSession([{ role: 'user', content: '龙眼的上市季节研究', ts: 1000 }]);
    await seedConversations([
      { id: 'conv-or1', sessionId: sidA, updatedAt: '2026-10-18T10:00:00.000Z' },
      { id: 'conv-or2', sessionId: sidB, updatedAt: '2026-10-18T09:00:00.000Z' },
    ]);

    const r = await searchSessions(WS, { queries: ['荔枝', '龙眼'] });
    expect(r.sessionHits).toHaveLength(2);
    const byConv = new Map(r.sessionHits.map((h) => [h.conversationId, h]));
    expect(byConv.get('conv-or1')?.matchedTerms).toEqual(['荔枝']);
    expect(byConv.get('conv-or2')?.matchedTerms).toEqual(['龙眼']);
  });

  test('同会话命中多词：matchedTerms 全列，snippet 用最早出现的词定位；排序词数多优先', async () => {
    const sidBoth = await seedSession([{ role: 'user', content: '先说配色，再聊琥珀色的历史', ts: 1000 }]);
    const sidOne = await seedSession([{ role: 'user', content: '琥珀色单独讨论', ts: 1000 }]);
    await seedConversations([
      { id: 'conv-one', sessionId: sidOne, updatedAt: '2026-10-18T11:00:00.000Z' },
      { id: 'conv-both', sessionId: sidBoth, updatedAt: '2026-10-18T10:00:00.000Z' },
    ]);

    const r = await searchSessions(WS, { queries: ['琥珀色', '配色'] });
    expect(r.sessionHits).toHaveLength(2);
    expect(r.sessionHits[0].conversationId).toBe('conv-both');
    expect(r.sessionHits[0].matchedTerms).toEqual(['琥珀色', '配色']);
    expect(r.sessionHits[0].matches[0].snippet).toContain('配色');
    expect(r.sessionHits[1].conversationId).toBe('conv-one');
    expect(r.sessionHits[1].matchedTerms).toEqual(['琥珀色']);
  });

  test('剥注入块：引用块里的关键词不命中，正文命中', async () => {
    const sid = await seedSession([
      { role: 'user', content: '<referenced_files>\n琥珀色出现在引用的文件内容里\n</referenced_files>\n今天聊聊琥珀色配色', ts: 1000 },
    ]);
    await seedConversations([{ id: 'conv-b', sessionId: sid, groupId: 'g1', updatedAt: '2026-10-18T10:00:00.000Z' }]);

    const r = await searchSessions(WS, { queries: ['琥珀色配色'] });
    expect(r.sessionHits).toHaveLength(1);
    expect(r.sessionHits[0].matches[0].snippet).not.toContain('referenced_files');
  });

  test('ASCII 大小写不敏感，中文按原样', async () => {
    const sid = await seedSession([{ role: 'user', content: 'review 一下 todo list 和 待办事项', ts: 1000 }]);
    await seedConversations([{ id: 'conv-c', sessionId: sid, updatedAt: '2026-10-18T10:00:00.000Z' }]);

    expect((await searchSessions(WS, { queries: ['TODO'] })).sessionHits).toHaveLength(1);
    expect((await searchSessions(WS, { queries: ['待办'] })).sessionHits).toHaveLength(1);
    expect((await searchSessions(WS, { queries: ['不存在的词'] })).sessionHits).toHaveLength(0);
  });

  test('单会话最多 3 条命中；limit 只截断输出，扫描继续完成', async () => {
    const sidFive = await seedSession([1, 2, 3, 4, 5].map((n) => ({ role: 'user' as const, content: `第${n}次提到风筝`, ts: 1000 + n })));
    const sidMore = await seedSession([{ role: 'user' as const, content: '风筝的第二场讨论', ts: 2000 }]);
    await seedConversations([
      { id: 'conv-d1', sessionId: sidFive, updatedAt: '2026-10-18T10:00:00.000Z' },
      { id: 'conv-d2', sessionId: sidMore, updatedAt: '2026-10-18T09:00:00.000Z' },
    ]);

    const r = await searchSessions(WS, { queries: ['风筝'], limit: 1 });
    expect(r.sessionHits).toHaveLength(1);
    expect(r.sessionHits[0].matches).toHaveLength(3);
    expect(r.scanned).toBe(2);
    expect(r.stoppedBy).toBe('completed');
  });

  test('sub 会话纳入检索；无 sessionId 排除；groupId 过滤与归档态标注', async () => {
    const sidActive = await seedSession([{ role: 'user', content: '聊聊路由懒加载', ts: 1000 }]);
    const sidSub = await seedSession([{ role: 'user', content: '子会话也聊路由懒加载', ts: 1000 }]);
    const sidOther = await seedSession([{ role: 'user', content: '归档组里也聊路由懒加载', ts: 1000 }]);
    await seedConversations([
      { id: 'conv-e', sessionId: sidActive, groupId: 'g-active', updatedAt: '2026-10-18T12:00:00.000Z' },
      { id: 'conv-f', sessionId: sidSub, groupId: 'g-active', role: 'sub', updatedAt: '2026-10-18T11:00:00.000Z' },
      { id: 'conv-g', sessionId: sidOther, groupId: 'g-archived', updatedAt: '2026-10-18T13:00:00.000Z' },
      { id: 'conv-h', updatedAt: '2026-10-18T14:00:00.000Z' },
    ]);
    await seedGroups([{ id: 'g-active' }, { id: 'g-archived', archivedAt: Date.now() }]);

    const all = await searchSessions(WS, { queries: ['路由懒加载'] });
    expect(all.totalCandidates).toBe(3);
    expect(all.sessionHits.map((h) => h.conversationId)).toEqual(['conv-g', 'conv-e', 'conv-f']);
    expect(all.sessionHits.find((h) => h.conversationId === 'conv-g')?.archived).toBe(true);
    expect(all.sessionHits.find((h) => h.conversationId === 'conv-e')?.archived).toBe(false);
    expect(all.sessionHits.find((h) => h.conversationId === 'conv-f')?.kind).toBe('session');

    const scoped = await searchSessions(WS, { queries: ['路由懒加载'], groupId: 'g-active' });
    expect(scoped.totalCandidates).toBe(2);
    expect(scoped.sessionHits.map((h) => h.conversationId)).toEqual(['conv-e', 'conv-f']);
  });

  test('tailPreview 取最后一条非空 assistant 文本头 200 字', async () => {
    const longTail = `最终结论是采用方案B。${'补充说明'.repeat(80)}`;
    const sid = await seedSession([
      { role: 'user', content: '开始讨论方案选型', ts: 1000 },
      { role: 'assistant', content: text('中间过程略'), ts: 1001 },
      { role: 'assistant', content: [{ type: 'toolCall', id: 'tc9', name: 'read', arguments: {} }], ts: 1002 },
      { role: 'assistant', content: text(longTail), ts: 1003 },
    ]);
    await seedConversations([{ id: 'conv-tail', sessionId: sid, updatedAt: '2026-10-18T10:00:00.000Z' }]);

    const r = await searchSessions(WS, { queries: ['方案选型'] });
    expect(r.sessionHits[0].tailPreview).not.toBeNull();
    expect(r.sessionHits[0].tailPreview!.startsWith('最终结论是采用方案B。')).toBe(true);
    expect(r.sessionHits[0].tailPreview!.length).toBeLessThanOrEqual(200);
  });

  test('排序分层：标题命中插队 > 正文词数 > recency', async () => {
    const sidRecent = await seedSession([{ role: 'user', content: '单说配色', ts: 1000 }]);
    const sidTitle = await seedSession([{ role: 'user', content: '琥珀色的起源', ts: 1000 }]);
    const sidBoth = await seedSession([{ role: 'user', content: '琥珀色与配色都谈', ts: 1000 }]);
    await seedConversations([
      { id: 'conv-r1', sessionId: sidRecent, updatedAt: '2026-10-18T12:00:00.000Z' },
      { id: 'conv-r2', sessionId: sidTitle, title: '琥珀色讨论', updatedAt: '2026-10-18T10:00:00.000Z' },
      { id: 'conv-r3', sessionId: sidBoth, updatedAt: '2026-10-18T09:00:00.000Z' },
    ]);

    const r = await searchSessions(WS, { queries: ['琥珀色', '配色'] });
    expect(r.sessionHits.map((h) => h.conversationId)).toEqual(['conv-r2', 'conv-r3', 'conv-r1']);
    expect(r.sessionHits[0].titleMatched).toBe(true);
    expect(r.sessionHits[1].titleMatched).toBe(false);
    expect(r.sessionHits[2].titleMatched).toBe(false);
  });

  test('共享文件命中：md/txt 纳入，json 不扫；返回 relPath/groupTitle/content/matchedTerms', async () => {
    const sidMiss = await seedSession([{ role: 'user', content: '随便聊聊', ts: 1000 }]);
    await seedConversations([{ id: 'conv-fm', sessionId: sidMiss, updatedAt: '2026-10-18T10:00:00.000Z' }]);
    await seedGroups([{ id: 'g-file', title: '检索升级话题' }]);
    await seedSharedFile('g-file', 'notes/report.md', '# 报告\n检索预算三闸已经拍板');
    await seedSharedFile('g-file', 'todo.txt', '待办：复核时间安排');
    await seedSharedFile('g-file', 'data.json', '{"text": "检索预算出现在 json 里"}');

    const r = await searchSessions(WS, { queries: ['检索预算', '待办'] });
    expect(r.fileHits).toHaveLength(2);
    const report = r.fileHits.find((f) => f.relPath === 'notes/report.md');
    expect(report).toBeDefined();
    expect(report!.groupId).toBe('g-file');
    expect(report!.groupTitle).toBe('检索升级话题');
    expect(report!.content).toContain('三闸已经拍板');
    expect(report!.truncated).toBe(false);
    expect(report!.matchedTerms).toEqual(['检索预算']);
    expect(r.fileHits.map((f) => f.relPath)).toContain('todo.txt');
    expect(r.totalCandidates).toBe(3);
    expect(r.scanned).toBe(3);
  });

  test('文件首行源指针解析回填 sourceSessionId；无指针存量文件不填', async () => {
    await seedGroups([{ id: 'g-pointer' }]);
    const sid = '01a15696-dcd0-778a-a9eb-521127aedf02';
    await seedSharedFile('g-pointer', 'with-pointer.md', `<!-- source-session: ${sid} -->\n# 交付报告\n结论先行`);
    await seedSharedFile('g-pointer', 'legacy.md', '# 存量报告\n无指针的结论先期沉淀');

    const r = await searchSessions(WS, { queries: ['结论先', '结论先期'] });
    expect(r.fileHits).toHaveLength(2);
    const withPointer = r.fileHits.find((f) => f.relPath === 'with-pointer.md')!;
    const legacy = r.fileHits.find((f) => f.relPath === 'legacy.md')!;
    expect(withPointer.sourceSessionId).toBe(sid);
    expect(legacy.sourceSessionId).toBeUndefined();
  });

  test('文件内容超 8K 字符截断并标注', async () => {
    await seedGroups([{ id: 'g-big' }]);
    await seedSharedFile('g-big', 'big.md', `结论在此${'x'.repeat(9000)}`);

    const r = await searchSessions(WS, { queries: ['结论在此'] });
    expect(r.fileHits).toHaveLength(1);
    expect(r.fileHits[0].truncated).toBe(true);
    expect(r.fileHits[0].content.length).toBe(8192);
    expect(r.fileHits[0].content.startsWith('结论在此')).toBe(true);
  });

  test('时间过滤 after/before：会话按 updatedAt，文件按 mtime', async () => {
    const sidOld = await seedSession([{ role: 'user', content: '十月上旬聊检索预算', ts: 1000 }]);
    const sidNew = await seedSession([{ role: 'user', content: '十月中旬聊检索预算', ts: 1000 }]);
    await seedConversations([
      { id: 'conv-old', sessionId: sidOld, updatedAt: '2026-10-05T10:00:00.000Z' },
      { id: 'conv-new', sessionId: sidNew, updatedAt: '2026-10-15T10:00:00.000Z' },
    ]);
    await seedGroups([{ id: 'g-time' }]);
    await seedSharedFile('g-time', 'old.md', '检索预算的旧结论', Date.parse('2026-10-02T00:00:00.000Z'));
    await seedSharedFile('g-time', 'new.md', '检索预算的新结论', Date.parse('2026-10-12T00:00:00.000Z'));

    const after = await searchSessions(WS, { queries: ['检索预算'], after: '2026-10-10' });
    expect(after.sessionHits.map((h) => h.conversationId)).toEqual(['conv-new']);
    expect(after.fileHits.map((f) => f.relPath)).toEqual(['new.md']);

    const before = await searchSessions(WS, { queries: ['检索预算'], before: '2026-10-10' });
    expect(before.sessionHits.map((h) => h.conversationId)).toEqual(['conv-old']);
    expect(before.fileHits.map((f) => f.relPath)).toEqual(['old.md']);

    await expect(searchSessions(WS, { queries: ['检索预算'], after: 'not-a-date' })).rejects.toThrow('时间格式无效');
  });

  test('snippet 取命中点前后各 120 字符并折叠空白', async () => {
    const longText = `${'前'.repeat(200)}风筝${'后'.repeat(200)}`.replace(/(..)/g, '$1 ');
    const sid = await seedSession([{ role: 'user', content: longText, ts: 1000 }]);
    await seedConversations([{ id: 'conv-i', sessionId: sid, updatedAt: '2026-10-18T10:00:00.000Z' }]);

    const r = await searchSessions(WS, { queries: ['风筝'] });
    const snippet = r.sessionHits[0].matches[0].snippet;
    expect(snippet.startsWith('…')).toBe(true);
    expect(snippet.endsWith('…')).toBe(true);
    expect(snippet).toContain('风筝');
    expect(snippet.length).toBeLessThan(300);
    expect(snippet).not.toMatch(/\n/);
  });

  test('索引残留（无会话文件）的候选跳过且不计入 scanned', async () => {
    await seedGroups([]);
    await seedConversations([{ id: 'conv-j', sessionId: '00000000-0000-4000-8000-000000000000', updatedAt: '2026-10-18T10:00:00.000Z' }]);
    const r = await searchSessions(WS, { queries: ['随便什么词'] });
    expect(r.totalCandidates).toBe(1);
    expect(r.scanned).toBe(0);
    expect(r.sessionHits).toHaveLength(0);
    expect(r.fileHits).toHaveLength(0);
    expect(r.stoppedBy).toBe('completed');
  });
});

test('listSessionFiles 只收合法会话文件名', async () => {
  const files = await getPiSessionRepository().listSessionFiles(WS);
  expect(files.length).toBeGreaterThanOrEqual(5);
  for (const f of files) {
    expect(f.sessionId).toMatch(/^[0-9a-f-]+$/);
    expect(f.sizeBytes).toBeGreaterThan(0);
    expect(fs.existsSync(f.filePath)).toBe(true);
  }
});
