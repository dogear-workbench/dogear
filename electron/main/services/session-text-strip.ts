/**
 * 会话消息文本的注入块剥离（referenced_* / quoted_snippet / sender 标签等）。
 * 消费方：topic-digest-service（轮次提取）与 session-search-service（检索匹配）——
 * 引用的文章/文件/会话内容不是讨论本身，提炼与检索都必须剥掉防误命中。
 * 剥离口径对齐前端 parseUserMessageReferences + extractMessagePreview。
 */

export const STRIPPED_BLOCK_PATTERNS: RegExp[] = [
  /<referenced_articles>[\s\S]*?<\/referenced_articles>/g,
  /<referenced_files>[\s\S]*?<\/referenced_files>/g,
  /<referenced_conversations>[\s\S]*?<\/referenced_conversations>/g,
  /<referenced_shared_files>[\s\S]*?<\/referenced_shared_files>/g,
  /<referenced_notes>[\s\S]*?<\/referenced_notes>/g,
  /<quoted_snippet\s+source="[^"]*">[\s\S]*?<\/quoted_snippet>/g,
  /<sender\s+kind="[^"]*"[^>]*\/>/g,
  /<local-command-stdout>[\s\S]*?<\/local-command-stdout>/g,
  /<command-[a-z-]+>[\s\S]*?<\/command-[a-z-]+>/g,
  /<task-execution>[\s\S]*?<\/task-execution>/g,
  /\n?（注：引用的会话可能属于其他工作区[^\n]*/g,
  /\n?（引用提示：[^\n]*/g,
];

export function stripInjectedBlocks(content: string): string {
  let text = content;
  for (const pattern of STRIPPED_BLOCK_PATTERNS) {
    text = text.replace(pattern, '');
  }
  return text.replace(/^\n+/, '').trim();
}
