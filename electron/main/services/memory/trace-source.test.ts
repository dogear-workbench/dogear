import { test, expect } from 'bun:test';
import { traceSourceFromLines, extractDialogue } from './trace-source.ts';

const lines = [
  JSON.stringify({ type: 'user', uuid: 'u1', timestamp: 't1', message: { role: 'user', content: '问题一' } }),
  JSON.stringify({ type: 'assistant', uuid: 'a1', timestamp: 't2', message: { content: [{ type: 'text', text: '回答一' }] } }),
  // 工具结果 user 行：content 是数组 → 应跳过
  JSON.stringify({ type: 'user', uuid: 'ur', message: { content: [{ type: 'tool_result', tool_use_id: 'x', content: '结果体' }] } }),
  JSON.stringify({ type: 'user', uuid: 'u2', message: { role: 'user', content: '问题二' } }),
  // assistant 含 thinking + text → 只取 text
  JSON.stringify({ type: 'assistant', uuid: 'a2', message: { content: [{ type: 'thinking', thinking: '想' }, { type: 'text', text: '回答二' }] } }),
  // isMeta 行 → 跳过
  JSON.stringify({ type: 'user', uuid: 'meta', isMeta: true, message: { role: 'user', content: 'skill 内容' } }),
];

test('按 uuid 定位并返回前后上下文窗口', () => {
  const r = traceSourceFromLines(lines, 'a1', 1);
  expect(r.found).toBe(true);
  expect(r.messages.map((m) => m.uuid)).toEqual(['u1', 'a1', 'u2']);
});

test('找不到 uuid 返回 found:false', () => {
  const r = traceSourceFromLines(lines, 'nope', 2);
  expect(r.found).toBe(false);
  expect(r.messages).toEqual([]);
});

test('extractDialogue 跳过工具结果行与 isMeta，assistant 只取 text', () => {
  const d = extractDialogue(lines);
  expect(d.map((m) => m.uuid)).toEqual(['u1', 'a1', 'u2', 'a2']);
  expect(d.find((m) => m.uuid === 'a2')!.text).toBe('回答二');
});

test('窗口在边界处截断', () => {
  const r = traceSourceFromLines(lines, 'u1', 2);
  expect(r.messages.map((m) => m.uuid)).toEqual(['u1', 'a1', 'u2']);
});
