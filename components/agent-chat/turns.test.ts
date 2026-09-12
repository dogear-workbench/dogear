import { test, expect, beforeEach } from 'bun:test';
import { buildTurns } from './turns.ts';
import type { Message } from './types.ts';

let seq = 0;
beforeEach(() => { seq = 0; });

const u = (content: string, extra: Partial<Message> = {}): Message =>
  ({ role: 'user', content, id: `u${++seq}`, ...extra } as Message);
const a = (content = 'reply', extra: Partial<Message> = {}): Message =>
  ({ role: 'assistant', content, id: `a${++seq}`, ...extra } as Message);
const injected = (content: string): Message => u(`<sender kind="agent" name="子会话" delivery="true"/>\n${content}`);

test('单轮：user + assistant', () => {
  const { turns, byMessageId } = buildTurns([u('hi'), a()], { collapsed: false });
  expect(turns).toEqual([{ turnId: 'turn-u1', headerId: 'u1', headerInjected: false, memberIds: ['u1', 'a2'] }]);
  expect(byMessageId.get('u1')).toBe('turn-u1');
  expect(byMessageId.get('a2')).toBe('turn-u1');
});

test('多轮：每条 user 开新轮', () => {
  const msgs = [u('q1'), a(), u('q2'), a(), a()];
  const { turns } = buildTurns(msgs, { collapsed: false });
  expect(turns).toEqual([
    { turnId: 'turn-u1', headerId: 'u1', headerInjected: false, memberIds: ['u1', 'a2'] },
    { turnId: 'turn-u3', headerId: 'u3', headerInjected: false, memberIds: ['u3', 'a4', 'a5'] },
  ]);
});

test('插话：isQueued 的 user 照常另起一轮', () => {
  const msgs = [u('q1'), a(), u('打断一下', { isQueued: true } as Partial<Message>), a()];
  const { turns } = buildTurns(msgs, { collapsed: false });
  expect(turns.map(t => t.headerId)).toEqual(['u1', 'u3']);
  expect(turns[1].memberIds).toEqual(['u3', 'a4']);
});

test('开头是 assistant：形成无头轮', () => {
  const { turns } = buildTurns([a('恢复的回复'), u('q1'), a()], { collapsed: false });
  expect(turns[0]).toEqual({ turnId: 'turn-a1', headerId: null, headerInjected: false, memberIds: ['a1'] });
  expect(turns[1]).toEqual({ turnId: 'turn-u2', headerId: 'u2', headerInjected: false, memberIds: ['u2', 'a3'] });
});

test('注入消息（/model）不作 header，附着当前轮', () => {
  const msgs = [u('q1'), a(), u('/model sonnet'), a()];
  const { turns } = buildTurns(msgs, { collapsed: false });
  expect(turns).toHaveLength(1);
  expect(turns[0].memberIds).toEqual(['u1', 'a2', 'u3', 'a4']);
});

test('meta 消息不作 header，附着当前轮', () => {
  const msgs = [u('q1'), { role: 'assistant', content: 'm', id: 'm2', isMeta: true } as Message, a()];
  const { turns } = buildTurns(msgs, { collapsed: false });
  expect(turns).toHaveLength(1);
  expect(turns[0].memberIds).toEqual(['u1', 'm2', 'a2']);
});

test('有人值守：真人头后的交付注入并入当前轮', () => {
  const msgs = [u('q1'), a('派了子会话'), injected('step1 交付'), a('验收')];
  const { turns } = buildTurns(msgs, { collapsed: false });
  expect(turns).toHaveLength(1);
  expect(turns[0]).toEqual({ turnId: 'turn-u1', headerId: 'u1', headerInjected: false, memberIds: ['u1', 'a2', 'u3', 'a4'] });
});

test('无人值守：task-execution 开轮，后续交付注入各开新轮', () => {
  const msgs = [
    u('<task-execution>\n任务标题：会话渲染优化\n任务 ID：t1\n</task-execution>'),
    a('开工'),
    injected('step1 交付'),
    a('验收 step1'),
    injected('step2 交付'),
    a('验收 step2'),
  ];
  const { turns } = buildTurns(msgs, { collapsed: false });
  expect(turns.map(t => [t.headerId, t.headerInjected])).toEqual([
    ['u1', true],
    ['u3', true],
    ['u5', true],
  ]);
  expect(turns[0].memberIds).toEqual(['u1', 'a2']);
  expect(turns[1].memberIds).toEqual(['u3', 'a4']);
});

test('无人值守转有人：用户介入后开真人轮，后续注入并入', () => {
  const msgs = [
    u('<task-execution>\n任务标题：x\n任务 ID：t1\n</task-execution>'),
    a('开工'),
    injected('step1 交付'),
    u('我来看看'),
    a('继续'),
    injected('step2 交付'),
  ];
  const { turns } = buildTurns(msgs, { collapsed: false });
  expect(turns.map(t => [t.headerId, t.headerInjected])).toEqual([
    ['u1', true],
    ['u3', true],
    ['u4', false],
  ]);
  expect(turns[2].memberIds).toEqual(['u4', 'a5', 'u6']);
});

test('首条即注入（resume 开场）：注入开轮，后续注入续开新轮', () => {
  const msgs = [
    u('<sender kind="agent" name="系统" tag="resume"/>\n续跑提示'),
    a('继续干活'),
    injected('step 交付'),
  ];
  const { turns } = buildTurns(msgs, { collapsed: false });
  expect(turns.map(t => [t.headerId, t.headerInjected])).toEqual([
    ['u1', true],
    ['u3', true],
  ]);
});

test('无头 assistant 轮后的注入并入当前轮（开场杂项语义）', () => {
  const msgs = [a('恢复的回复'), injected('交付'), a('验收')];
  const { turns } = buildTurns(msgs, { collapsed: false });
  expect(turns).toHaveLength(1);
  expect(turns[0]).toEqual({ turnId: 'turn-a1', headerId: null, headerInjected: false, memberIds: ['a1', 'u2', 'a3'] });
});

test('折叠：最后一个 boundary 之前的消息被隐藏，boundary 入无头轮', () => {
  const msgs = [
    u('old-q'), a('old-a'),
    { role: 'assistant', content: '', id: 'b3', isCompactBoundary: true } as Message,
    u('new-q'), a('new-a'),
  ];
  const { turns, byMessageId } = buildTurns(msgs, { collapsed: true });
  expect(byMessageId.has('u1')).toBe(false);
  expect(byMessageId.has('a2')).toBe(false);
  expect(turns[0]).toEqual({ turnId: 'turn-b3', headerId: null, headerInjected: false, memberIds: ['b3'] });
  expect(turns[1]).toEqual({ turnId: 'turn-u3', headerId: 'u3', headerInjected: false, memberIds: ['u3', 'a4'] });
});

test('未折叠：boundary 之前的轮正常保留', () => {
  const msgs = [
    u('old-q'), a('old-a'),
    { role: 'assistant', content: '', id: 'b3', isCompactBoundary: true } as Message,
    u('new-q'), a('new-a'),
  ];
  const { turns } = buildTurns(msgs, { collapsed: false });
  expect(turns[0]).toEqual({ turnId: 'turn-u1', headerId: 'u1', headerInjected: false, memberIds: ['u1', 'a2', 'b3'] });
  expect(turns[1]).toEqual({ turnId: 'turn-u3', headerId: 'u3', headerInjected: false, memberIds: ['u3', 'a4'] });
});

test('折叠/展开切换后同一消息的 turnId 不变', () => {
  const msgs = [
    u('old-q'), a('old-a'),
    { role: 'assistant', content: '', id: 'b3', isCompactBoundary: true } as Message,
    u('new-q'), a('new-a'), u('new-q2'), a(),
  ];
  const collapsedRes = buildTurns(msgs, { collapsed: true });
  const expandedRes = buildTurns(msgs, { collapsed: false });
  // boundary 之后的轮次不受折叠隐藏区影响，turnId 逐一相等
  for (const id of ['u3', 'a4', 'u5', 'a6']) {
    expect(collapsedRes.byMessageId.get(id)).toBe(expandedRes.byMessageId.get(id));
  }
  // 收益验证：折叠/展开切换后 turn 的 React key 不因编号重排而全变（避免 remount）
  const collapsedIds = collapsedRes.turns.map(t => t.turnId);
  const expandedIds = expandedRes.turns.map(t => t.turnId);
  expect(collapsedIds).toEqual(['turn-b3', 'turn-u3', 'turn-u5']);
  expect(expandedIds.slice(1)).toEqual(['turn-u3', 'turn-u5']);
});

test('indexById 反查：id → 原始扁平下标', () => {
  const msgs = [u('q1'), a(), u('q2'), a()];
  const { indexById } = buildTurns(msgs, { collapsed: false });
  expect(indexById.get('u1')).toBe(0);
  expect(indexById.get('a2')).toBe(1);
  expect(indexById.get('u3')).toBe(2);
});

test('无 id 消息兜底：idx- 前缀仍唯一可用', () => {
  const msgs = [
    { role: 'user', content: 'q' } as Message,
    { role: 'assistant', content: 'r' } as Message,
  ];
  const { turns, byMessageId } = buildTurns(msgs, { collapsed: false });
  expect(turns[0].turnId).toBe('turn-idx-0');
  expect(byMessageId.get('idx-1')).toBe('turn-idx-0');
});
