import { test, expect } from 'bun:test';
import { serializeDigestCard, parseDigestCard, type DigestCard } from './digest-store.ts';

const sample: DigestCard = {
  sessionId: 'ec9b2c05-e277-48db-8d7b-a66f969aa023',
  conversationId: 'conv-1',
  title: '测试任务清单功能',
  createdAt: '2026-06-03T10:00:00.000Z',
  sourceMtime: 1717400000123,
  turnCount: 26,
  summary: '这次会话做了 2 件事：检查任务清单代码；实测状态流转。',
  items: [
    { kind: '决策', text: '任务清单复用 SDK 的 Task* 工具', uuid: 'd079cafd-7402-4414-9e49-9d6f86b8c8b4' },
    { kind: '想法', text: '可以加 task_summary 虚拟块', uuid: '7f79caf8-504d-4694-9a5f-d9cda94fe242' },
    { kind: '搁置', text: '小地图聚合暂不动', uuid: '7922c400-88d3-4794-975f-de860ddbf4bb' },
  ],
};

test('serialize → parse round-trip 保持等价', () => {
  const raw = serializeDigestCard(sample);
  const back = parseDigestCard(raw);
  expect(back).not.toBeNull();
  expect(back!).toEqual(sample);
});

test('items 顺序 / kind / uuid 保留', () => {
  const back = parseDigestCard(serializeDigestCard(sample))!;
  expect(back.items.map((i) => i.kind)).toEqual(['决策', '想法', '搁置']);
  expect(back.items.map((i) => i.uuid)).toEqual(sample.items.map((i) => i.uuid));
});

test('conversationId 缺省时 round-trip 为 undefined', () => {
  const noConv: DigestCard = { ...sample, conversationId: undefined };
  const back = parseDigestCard(serializeDigestCard(noConv))!;
  expect(back.conversationId).toBeUndefined();
});

test('数字字段以数字类型恢复', () => {
  const back = parseDigestCard(serializeDigestCard(sample))!;
  expect(back.sourceMtime).toBe(1717400000123);
  expect(back.turnCount).toBe(26);
  expect(typeof back.sourceMtime).toBe('number');
});

test('tags round-trip 保持等价', () => {
  const card: DigestCard = {
    ...sample,
    tags: {
      primary: '产品-Dashboard',
      secondary: ['UI重构', '用户反馈'],
      scores: { '产品-Dashboard': 0.85, 'UI重构': 0.6, '用户反馈': 0.4 },
    },
  };
  const back = parseDigestCard(serializeDigestCard(card))!;
  expect(back.tags).toEqual(card.tags);
});

test('旧卡无 tags 字段，解析后 tags 为 undefined', () => {
  const back = parseDigestCard(serializeDigestCard(sample))!;
  expect(back.tags).toBeUndefined();
});

test('tagsJson 损坏时 tags 解析为 undefined（不抛错）', () => {
  // 手工构造一个 tagsJson 损坏的 markdown
  const broken = `---\nsessionId: test\ntitle: t\ncreatedAt: 2026-01-01T00:00:00.000Z\nsourceMtime: "0"\nturnCount: "0"\ntagsJson: "not-json-{"\n---\n\n## 概述\n空\n\n## 想法 / 注意 / 决策\n`;
  const back = parseDigestCard(broken)!;
  expect(back).not.toBeNull();
  expect(back.tags).toBeUndefined();
});
