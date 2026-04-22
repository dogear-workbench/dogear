import type { Message } from './types';

/**
 * 从 message 提取预览文本(去 markdown 符号和 XML 标签),保留软换行
 * CSS 层用 line-clamp-3 封顶 3 行显示
 */
export function extractMessagePreview(msg: Message): string {
  let text = '';

  if (msg.role === 'user' && msg.content) {
    text = msg.content
      .replace(/<referenced_articles>[\s\S]*?<\/referenced_articles>/g, '')
      .replace(/<quoted_snippet[^>]*>[\s\S]*?<\/quoted_snippet>/g, '')
      .replace(/<command-[a-z-]+>[\s\S]*?<\/command-[a-z-]+>/g, '')
      .replace(/^\n+/, '').trim();
  } else if (msg.role === 'assistant') {
    if (msg.contentBlocks) {
      const textBlock = msg.contentBlocks.find(b => b.type === 'text');
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      text = (textBlock as any)?.content || (textBlock as any)?.text || '';
    } else {
      text = msg.content || '';
    }
  }

  // 去 markdown 符号,但保留换行(让 CSS 软换行)
  text = text
    .replace(/[#*_`~[\]()]/g, '')
    .replace(/[ \t]+/g, ' ') // 只合并连续空格/tab,保留 \n
    .trim();
  // 截到 180 字符(足够 3 行 line-clamp)
  return text.length > 180 ? text.substring(0, 180) + '...' : text;
}
