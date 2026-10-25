import { describe, expect, test } from 'bun:test';
import { z } from 'zod';
import { defineTool, toHarnessTools } from './tool-adapter.js';

describe('toHarnessTools 注册元数据透传', () => {
  test('缺省三字段时不产出 undefined 键，仅透传 deferred', () => {
    const def = defineTool('plain', '简述', '描述', z.object({ q: z.string() }), async () => ({
      content: [{ type: 'text', text: 'ok' }],
    }));
    const [reg] = toHarnessTools([def]) as Array<Record<string, unknown>>;
    expect(reg.replay).toBeUndefined();
    expect(reg.outputLimits).toBeUndefined();
    expect(reg.prepareArguments).toBeUndefined();
    expect(reg.deferred).toBeUndefined();
  });

  test('replay/outputLimits/prepareArguments/deferred 全量透传', () => {
    const def = defineTool(
      'searchable',
      '简述',
      '描述',
      z.object({ tags: z.array(z.string()) }),
      async () => ({ content: [{ type: 'text', text: 'ok' }] }),
      {
        replay: 'safe',
        outputLimits: { maxBytes: 256 * 1024, retain: 'tail' },
        prepareArguments: (args) => {
          const raw = args as { tags?: unknown };
          return typeof raw.tags === 'string' ? { tags: [raw.tags] } : args;
        },
      },
    );
    const [reg] = toHarnessTools([{ ...def, deferred: true }]);
    expect(reg.replay).toBe('safe');
    expect(reg.outputLimits).toEqual({ maxBytes: 256 * 1024, retain: 'tail' });
    expect(reg.prepareArguments).toBeTypeOf('function');
    expect(reg.deferred).toBe(true);
  });

  test('execute 透传 handler 返回的 control.addTools 到结果', async () => {
    const def = defineTool('loader', '简述', '描述', z.object({ q: z.string() }), async () => ({
      content: [{ type: 'text', text: 'loaded' }],
      control: { addTools: ['tool_a', 'tool_b'] },
    }));
    const [reg] = toHarnessTools([def]);
    const result = await reg.execute({ q: 'x' }, undefined as never, undefined as never);
    expect(result.control).toEqual({ addTools: ['tool_a', 'tool_b'] });
  });

  test('handler 未返回 control 时 execute 结果不产出 control 键', async () => {
    const def = defineTool('plain', '简述', '描述', z.object({ q: z.string() }), async () => ({
      content: [{ type: 'text', text: 'ok' }],
    }));
    const [reg] = toHarnessTools([def]);
    const result = await reg.execute({ q: 'x' }, undefined as never, undefined as never);
    expect('control' in result).toBe(false);
  });

  test('prepareArguments 在 execute 前由调用方应用：string 归一为 array 后 schema 校验通过', async () => {
    const def = defineTool(
      'tagger',
      '简述',
      '描述',
      z.object({ tags: z.array(z.string()) }),
      async ({ tags }) => ({ content: [{ type: 'text', text: tags.join(',') }] }),
      {
        prepareArguments: (args) => {
          const raw = args as { tags?: unknown };
          return typeof raw.tags === 'string' ? { tags: [raw.tags] } : args;
        },
      },
    );
    const [reg] = toHarnessTools([def]);
    const prepared = reg.prepareArguments!({ tags: 'solo' }) as { tags: string[] };
    expect(prepared.tags).toEqual(['solo']);
    const result = await reg.execute(prepared, undefined as never, undefined as never);
    expect(result.output).toEqual([{ type: 'text', text: 'solo' }]);
  });
});
