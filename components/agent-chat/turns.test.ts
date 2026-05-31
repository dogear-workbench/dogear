import { test, expect } from 'bun:test';
import { buildTurns } from './turns.ts';
import type { Message } from './types.ts';

const u = (content: string, extra: Partial<Message> = {}): Message =>
  ({ role: 'user', content, ...extra } as Message);
const a = (content = 'reply', extra: Partial<Message> = {}): Message =>
  ({ role: 'assistant', content, ...extra } as Message);

test('单轮：user + assistant', () => {
  const { turns, turnByIndex } = buildTurns([u('hi'), a()], { collapsed: false });
  expect(turns).toEqual([{ turnId: 0, headerIdx: 0, memberIdxs: [0, 1] }]);
  expect(turnByIndex.get(0)).toBe(0);
  expect(turnByIndex.get(1)).toBe(0);
});

test('多轮：每条 user 开新轮', () => {
  const { turns } = buildTurns([u('q1'), a(), u('q2'), a(), a()], { collapsed: false });
  expect(turns).toEqual([
    { turnId: 0, headerIdx: 0, memberIdxs: [0, 1] },
    { turnId: 1, headerIdx: 2, memberIdxs: [2, 3, 4] },
  ]);
});

test('插话：isQueued 的 user 照常另起一轮', () => {
  const msgs = [u('q1'), a(), u('打断一下', { isQueued: true } as Partial<Message>), a()];
  const { turns } = buildTurns(msgs, { collapsed: false });
  expect(turns.map(t => t.headerIdx)).toEqual([0, 2]);
  expect(turns[1].memberIdxs).toEqual([2, 3]);
});

test('开头是 assistant：形成无头轮', () => {
  const { turns } = buildTurns([a('恢复的回复'), u('q1'), a()], { collapsed: false });
  expect(turns[0]).toEqual({ turnId: 0, headerIdx: null, memberIdxs: [0] });
  expect(turns[1]).toEqual({ turnId: 1, headerIdx: 1, memberIdxs: [1, 2] });
});

test('注入消息（/model）不作 header，附着当前轮', () => {
  const msgs = [u('q1'), a(), u('/model sonnet'), a()];
  const { turns } = buildTurns(msgs, { collapsed: false });
  expect(turns).toHaveLength(1);
  expect(turns[0].memberIdxs).toEqual([0, 1, 2, 3]);
});

test('meta 消息不作 header，附着当前轮', () => {
  const msgs = [u('q1'), { role: 'assistant', content: 'm', isMeta: true } as Message, a()];
  const { turns } = buildTurns(msgs, { collapsed: false });
  expect(turns).toHaveLength(1);
  expect(turns[0].memberIdxs).toEqual([0, 1, 2]);
});

test('折叠：最后一个 boundary 之前的消息被隐藏，boundary 入无头轮', () => {
  const msgs = [
    u('old-q'), a('old-a'),
    { role: 'assistant', content: '', isCompactBoundary: true } as Message,
    u('new-q'), a('new-a'),
  ];
  const { turns, turnByIndex } = buildTurns(msgs, { collapsed: true });
  // 下标 0、1 被隐藏，不出现在任何 turn
  expect(turnByIndex.has(0)).toBe(false);
  expect(turnByIndex.has(1)).toBe(false);
  // boundary(2) 是首个可见且非 header → 无头轮
  expect(turns[0]).toEqual({ turnId: 0, headerIdx: null, memberIdxs: [2] });
  expect(turns[1]).toEqual({ turnId: 1, headerIdx: 3, memberIdxs: [3, 4] });
});

test('未折叠：boundary 之前的轮正常保留', () => {
  const msgs = [
    u('old-q'), a('old-a'),
    { role: 'assistant', content: '', isCompactBoundary: true } as Message,
    u('new-q'), a('new-a'),
  ];
  const { turns } = buildTurns(msgs, { collapsed: false });
  expect(turns[0]).toEqual({ turnId: 0, headerIdx: 0, memberIdxs: [0, 1, 2] });
  expect(turns[1]).toEqual({ turnId: 1, headerIdx: 3, memberIdxs: [3, 4] });
});
