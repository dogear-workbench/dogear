import type { Message, InjectionTag } from './types';
import { isInjectedUserMessage, parseUserMessageReferences, resolveInjectionTag, parseTaskExecution } from './utils';
import { isFailoverContinueMessage, stripFailoverContinueSentinel } from '@/lib/failover-markers';

/**
 * 从 message 提取预览文本(去 markdown 符号和 XML 标签),保留软换行
 * CSS 层用 line-clamp-3 封顶 3 行显示
 */
export function extractMessagePreview(msg: Message): string {
  let text = '';

  if (msg.role === 'user' && msg.content) {
    text = isFailoverContinueMessage(msg.content)
      ? stripFailoverContinueSentinel(msg.content)
      : msg.content;
    text = text
      .replace(/<referenced_articles>[\s\S]*?<\/referenced_articles>/g, '')
      .replace(/<quoted_snippet[^>]*>[\s\S]*?<\/quoted_snippet>/g, '')
      .replace(/<command-[a-z-]+>[\s\S]*?<\/command-[a-z-]+>/g, '')
      .replace(/<sender\s[^>]*\/>/g, '')
      .replace(/<task-execution>[\s\S]*?<\/task-execution>/g, '')
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

const INJECTED_PREVIEW_PREFIXES: Record<InjectionTag, string> = {
  delivery: '↩ 交付',
  reply: '↩ 回复',
  terminal: '⚠ 子会话终止',
  resume: '↻ 续跑',
  'task-execution': '▣ 任务执行',
  failover: '⇄ 切换',
  dispatch: '↗ 派出',
};

/**
 * 跨会话注入消息的成员预览前缀；tag 判定与 MessageItem 渲染分支同口径（task-execution
 * 包裹优先，其余走 resolveInjectionTag 统一推断），非注入消息返回 null。
 */
export function injectedPreviewPrefix(content: string): string | null {
  if (!isInjectedUserMessage(content)) return null;
  if (isFailoverContinueMessage(content)) return INJECTED_PREVIEW_PREFIXES.failover;
  if (parseTaskExecution(content) || content.includes('<task-execution>')) {
    return INJECTED_PREVIEW_PREFIXES['task-execution'];
  }
  return INJECTED_PREVIEW_PREFIXES[resolveInjectionTag(parseUserMessageReferences(content))];
}
