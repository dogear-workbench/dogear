import { describe, expect, test } from 'bun:test';
import { createMessageConverter } from './message-converter';
import type { PiHarnessAgentEvent } from './pi-harness-adapter';

type Change = {
  type: string;
  contentIndex: number;
  delta?: string;
  block?: { type: string; text?: string; thinking?: string };
};

function updateEvent(changes: Change[]): PiHarnessAgentEvent {
  return {
    type: 'message_update',
    usage: undefined,
    changes,
  } as unknown as PiHarnessAgentEvent;
}

function messageEndEvent(kind: 'pi.assistant' | 'pi.tool-result' = 'pi.assistant'): PiHarnessAgentEvent {
  return {
    type: 'message_end',
    entry: { kind, model: [] },
  } as unknown as PiHarnessAgentEvent;
}

function texts(messages: Array<{ type: string; content?: string }>, type: 'text' | 'thinking'): string {
  return messages.filter((m) => m.type === type).map((m) => m.content ?? '').join('');
}

describe('createMessageConverter', () => {
  test('纯增量流：delta 按序透传', () => {
    const c = createMessageConverter();
    const out = [
      ...c.convert(updateEvent([{ type: 'thinking_delta', contentIndex: 0, delta: '思' }])),
      ...c.convert(updateEvent([{ type: 'thinking_delta', contentIndex: 0, delta: '考' }])),
      ...c.convert(updateEvent([{ type: 'text_delta', contentIndex: 1, delta: '正文' }])),
    ];
    expect(texts(out, 'thinking')).toBe('思考');
    expect(texts(out, 'text')).toBe('正文');
  });

  test('首块快照（text_start 带首段）+ 后续 delta：全文无重复', () => {
    const c = createMessageConverter();
    const out = [
      ...c.convert(updateEvent([{ type: 'text_start', contentIndex: 0, block: { type: 'text', text: '# 标题' } }])),
      ...c.convert(updateEvent([{ type: 'text_delta', contentIndex: 0, delta: '正文内容' }])),
    ];
    expect(texts(out, 'text')).toBe('# 标题正文内容');
  });

  test('signature 场景：text 开始后收到等量 thinking 块快照，不重发（碎块化根因回归）', () => {
    const c = createMessageConverter();
    const out = [
      ...c.convert(updateEvent([{ type: 'thinking_start', contentIndex: 0, block: { type: 'thinking', thinking: '' } }])),
      ...c.convert(updateEvent([{ type: 'thinking_delta', contentIndex: 0, delta: '已发思考全文' }])),
      // durable 同批：text 块创建 + signature set 触发的 thinking 整块快照
      ...c.convert(updateEvent([
        { type: 'text_start', contentIndex: 1, block: { type: 'text', text: '# 正文开头' } },
        { type: 'block', contentIndex: 0, block: { type: 'thinking', thinking: '已发思考全文' } },
      ])),
      ...c.convert(updateEvent([{ type: 'text_delta', contentIndex: 1, delta: '后续正文' }])),
    ];
    expect(texts(out, 'thinking')).toBe('已发思考全文');
    expect(texts(out, 'text')).toBe('# 正文开头后续正文');
    // 关键断言：text 块已开始后不再出现 thinking 消息（否则前端会错插块打碎 append）
    const lastThinkingIdx = out.map((m) => m.type).lastIndexOf('thinking');
    const firstTextIdx = out.findIndex((m) => m.type === 'text');
    expect(lastThinkingIdx).toBeLessThan(firstTextIdx);
  });

  test('中段块快照超前已发送：只补差量', () => {
    const c = createMessageConverter();
    const out = [
      ...c.convert(updateEvent([{ type: 'text_delta', contentIndex: 0, delta: '0123456789' }])),
      ...c.convert(updateEvent([{ type: 'block', contentIndex: 0, block: { type: 'text', text: '0123456789abcdef' } }])),
    ];
    expect(texts(out, 'text')).toBe('0123456789abcdef');
  });

  test('快照短于或等于已发送：不发（防御非 append 变更）', () => {
    const c = createMessageConverter();
    const out = [
      ...c.convert(updateEvent([{ type: 'text_delta', contentIndex: 0, delta: '0123456789' }])),
      ...c.convert(updateEvent([{ type: 'block', contentIndex: 0, block: { type: 'text', text: '01234' } }])),
      ...c.convert(updateEvent([{ type: 'block', contentIndex: 0, block: { type: 'text', text: '0123456789' } }])),
    ];
    expect(texts(out, 'text')).toBe('0123456789');
  });

  test('同批乱序：text_start(idx1) 先于 block(idx0)，输出按 contentIndex 排序（批内顺序根因回归）', () => {
    const c = createMessageConverter();
    const out = [
      ...c.convert(updateEvent([{ type: 'thinking_delta', contentIndex: 0, delta: '已发思考' }])),
      ...c.convert(updateEvent([
        { type: 'text_start', contentIndex: 1, block: { type: 'text', text: '# 标题' } },
        { type: 'block', contentIndex: 0, block: { type: 'thinking', thinking: '已发思考+尾' } },
      ])),
    ];
    // 差量 3ch 修正到 text 之前发出，前端不会在 text 后错插 thinking
    expect(out.map((m) => m.type)).toEqual(['thinking', 'thinking', 'text']);
    expect(texts(out, 'thinking')).toBe('已发思考+尾');
    expect(texts(out, 'text')).toBe('# 标题');
  });

  test('message_end 终态兑底：流式尾部缺块（零 partial 或尾批丢失）时按终态 entry 补差量', () => {
    const c = createMessageConverter();
    const out = [
      ...c.convert(updateEvent([{ type: 'thinking_delta', contentIndex: 0, delta: '思考前半' }])),
      ...c.convert(updateEvent([{ type: 'text_delta', contentIndex: 1, delta: '正文前半' }])),
      ...c.convert({
        type: 'message_end',
        entry: {
          kind: 'pi.assistant',
          model: [{ role: 'assistant', content: [
            { type: 'thinking', thinking: '思考前半+后半' },
            { type: 'text', text: '正文前半+后半' },
          ] }],
        },
      } as unknown as PiHarnessAgentEvent),
    ];
    expect(texts(out, 'thinking')).toBe('思考前半+后半');
    expect(texts(out, 'text')).toBe('正文前半+后半');
  });

  test('零 partial：流式零增量，message_end 终态全文兑底', () => {
    const c = createMessageConverter();
    const out = [
      ...c.convert({
        type: 'message_end',
        entry: {
          kind: 'pi.assistant',
          model: [{ role: 'assistant', content: [
            { type: 'thinking', thinking: '全文思考' },
            { type: 'text', text: '全文正文' },
          ] }],
        },
      } as unknown as PiHarnessAgentEvent),
    ];
    expect(texts(out, 'thinking')).toBe('全文思考');
    expect(texts(out, 'text')).toBe('全文正文');
  });

  test('message_end 重置记账：下一 entry 的首块快照全量发出（工具轮后新 assistant）', () => {
    const c = createMessageConverter();
    const out = [
      ...c.convert(updateEvent([{ type: 'text_delta', contentIndex: 0, delta: '第一轮已发' }])),
      ...c.convert(messageEndEvent('pi.assistant')),
      ...c.convert(messageEndEvent('pi.tool-result')),
      ...c.convert(updateEvent([{ type: 'text_start', contentIndex: 0, block: { type: 'text', text: '第二轮全文' } }])),
    ];
    expect(texts(out, 'text')).toBe('第一轮已发第二轮全文');
  });

  test('run_start 重置记账', () => {
    const c = createMessageConverter();
    const out = [
      ...c.convert(updateEvent([{ type: 'text_delta', contentIndex: 0, delta: '旧轮' }])),
      ...c.convert({ type: 'run_start' } as unknown as PiHarnessAgentEvent),
      ...c.convert(updateEvent([{ type: 'block', contentIndex: 0, block: { type: 'text', text: '新轮全文' } }])),
    ];
    expect(texts(out, 'text')).toBe('旧轮新轮全文');
  });

  test('message 整体替换（retry）：丢弃该 change，同批其他增量照发', () => {
    const c = createMessageConverter();
    const out = c.convert(updateEvent([
      { type: 'message', contentIndex: 0, block: { type: 'text' } },
      { type: 'text_delta', contentIndex: 0, delta: '同批增量' },
    ]));
    expect(out.length).toBe(1);
    expect(texts(out, 'text')).toBe('同批增量');
  });

  test('tool_execution_start/end：独立消息不受记账影响', () => {
    const c = createMessageConverter();
    const start = c.convert({
      type: 'tool_execution_start',
      toolName: 'bash',
      toolCallId: 'call-1',
      args: { command: 'ls' },
    } as unknown as PiHarnessAgentEvent);
    const end = c.convert({
      type: 'tool_execution_end',
      toolCallId: 'call-1',
      entry: { kind: 'pi.tool-result', model: [{ role: 'toolResult', toolCallId: 'call-1', content: [{ type: 'text', text: 'done' }], isError: false }] },
    } as unknown as PiHarnessAgentEvent);
    expect(start[0].type).toBe('tool_use');
    expect(end[0].type).toBe('tool_result');
    expect(end[0].toolOutput).toBe('done');
    expect(end[0].isError).toBe(false);
  });
});
