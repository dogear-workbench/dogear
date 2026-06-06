import { test, expect } from 'bun:test';
import { serializeReviewCard, parseReviewCard, type ReviewCard } from './review-store.ts';

const sample: ReviewCard = {
  reviewedAt: '2026-06-06T10:00:00.000Z',
  coveredCount: 12,
  items: [
    {
      kind: '反复出现',
      text: '复盘卡应该单张滚动（出现 3 次）',
      refs: [
        { sessionId: 'ec9b2c05-e277-48db-8d7b-a66f969aa023', uuid: 'd079cafd-7402-4414-9e49-9d6f86b8c8b4' },
        { sessionId: '38aa040a-7efa-4385-a6c8-8d633658a5d2', uuid: '7f79caf8-504d-4694-9a5f-d9cda94fe242' },
      ],
    },
    {
      kind: '悬而未决',
      text: 'TraceSource 读哪个源（挂了一轮）',
      refs: [
        { sessionId: '38aa040a-7efa-4385-a6c8-8d633658a5d2', uuid: '7922c400-88d3-4794-975f-de860ddbf4bb' },
      ],
    },
  ],
};

test('serialize → parse round-trip 保持等价', () => {
  const raw = serializeReviewCard(sample);
  const back = parseReviewCard(raw);
  expect(back).not.toBeNull();
  expect(back!).toEqual(sample);
});

test('多 refs / 单 ref 都正确恢复', () => {
  const back = parseReviewCard(serializeReviewCard(sample))!;
  expect(back.items[0].refs).toHaveLength(2);
  expect(back.items[1].refs).toHaveLength(1);
  expect(back.items[0].refs[1]).toEqual({
    sessionId: '38aa040a-7efa-4385-a6c8-8d633658a5d2',
    uuid: '7f79caf8-504d-4694-9a5f-d9cda94fe242',
  });
});

test('coveredCount 以数字类型恢复', () => {
  const back = parseReviewCard(serializeReviewCard(sample))!;
  expect(back.coveredCount).toBe(12);
  expect(typeof back.coveredCount).toBe('number');
});

test('空 items round-trip 为空数组', () => {
  const empty: ReviewCard = { reviewedAt: '2026-06-06T10:00:00.000Z', coveredCount: 0, items: [] };
  const back = parseReviewCard(serializeReviewCard(empty))!;
  expect(back.items).toEqual([]);
  expect(back.coveredCount).toBe(0);
});

test('kind 与顺序保留', () => {
  const back = parseReviewCard(serializeReviewCard(sample))!;
  expect(back.items.map((i) => i.kind)).toEqual(['反复出现', '悬而未决']);
});
