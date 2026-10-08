import { describe, test, expect } from 'bun:test';
import { splitContentBlocks } from './content-blocks.js';
import type { ContentBlockParam } from '@anthropic-ai/sdk/resources/messages.mjs';

describe('splitContentBlocks — 用户消息图片链路转换', () => {
  test('tipc 层构建的 base64 image 块转 pi-ai ImageContent', () => {
    const blocks = [
      { type: 'text', text: '引用上下文' },
      { type: 'text', text: '看这张图' },
      {
        type: 'image',
        source: { type: 'base64', media_type: 'image/png', data: 'aGVsbG8=' },
      },
    ] as unknown as ContentBlockParam[];

    const { text, images } = splitContentBlocks(blocks);
    expect(text).toBe('引用上下文\n看这张图');
    expect(images).toEqual([{ type: 'image', data: 'aGVsbG8=', mimeType: 'image/png' }]);
  });

  test('多图保序透传', () => {
    const blocks = [
      { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: 'aaa' } },
      { type: 'image', source: { type: 'base64', media_type: 'image/webp', data: 'bbb' } },
    ] as unknown as ContentBlockParam[];

    const { text, images } = splitContentBlocks(blocks);
    expect(text).toBe('');
    expect(images.map((i) => i.mimeType)).toEqual(['image/jpeg', 'image/webp']);
    expect(images.map((i) => i.data)).toEqual(['aaa', 'bbb']);
  });

  test('url 形状与非文本块静默丢弃', () => {
    const blocks = [
      { type: 'image', source: { type: 'url', url: 'https://example.com/a.png' } },
      { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: 'zzz' } },
      null,
      {},
    ] as unknown as ContentBlockParam[];

    const { text, images } = splitContentBlocks(blocks);
    expect(text).toBe('');
    expect(images).toEqual([]);
  });

  test('纯文本多块 join 换行（引用块机制回归）', () => {
    const blocks = [
      { type: 'text', text: '<referenced_files>…</referenced_files>' },
      { type: 'text', text: '用户消息' },
    ] as ContentBlockParam[];

    expect(splitContentBlocks(blocks).text).toBe('<referenced_files>…</referenced_files>\n用户消息');
  });
});
