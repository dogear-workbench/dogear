/**
 * 用户消息图片链路的纯转换层：tipc 层传来的 Anthropic 形状 ContentBlockParam[]
 * 在此拆成 pi harness 需要的 { text, images }。独立成模块以便单测覆盖。
 */

import type { ContentBlockParam } from '@anthropic-ai/sdk/resources/messages.mjs';
import type { ImageContent } from '@earendil-works/pi-ai';

export function splitContentBlocks(blocks: ContentBlockParam[]): { text: string; images: ImageContent[] } {
  const texts: string[] = [];
  const images: ImageContent[] = [];
  for (const block of blocks) {
    if (!block || typeof block !== 'object' || !('type' in block)) continue;
    if (block.type === 'text') {
      texts.push((block as { text: string }).text);
    } else if (block.type === 'image' && block.source.type === 'base64') {
      images.push({ type: 'image', data: block.source.data, mimeType: block.source.media_type });
    }
  }
  return { text: texts.join('\n'), images };
}
