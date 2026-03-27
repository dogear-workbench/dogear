import type { ParsedUserMessage, ParsedSlashCommand } from './types';

/**
 * 格式化模型名称为简短显示
 * 例如：'claude-sonnet-4-5-20250929' -> 'Sonnet 4.5'
 *       'anthropic/claude-opus-4.6' -> 'Opus 4.6'
 */
export function formatModelName(model: string): string {
  const name = model.includes('/') ? model.split('/').pop()! : model;
  if (name.includes('opus')) {
    const v = name.match(/opus[.-](\d+(?:\.\d+)?)/);
    return `Opus ${v?.[1] || '4'}`;
  }
  if (name.includes('sonnet-4-5') || name.includes('sonnet-4.5')) return 'Sonnet 4.5';
  if (name.includes('sonnet-4')) return 'Sonnet 4';
  if (name.includes('sonnet-3-5') || name.includes('sonnet-3.5')) return 'Sonnet 3.5';
  if (name.includes('haiku')) return 'Haiku';
  return name.length > 15 ? name.substring(0, 15) + '...' : name;
}

export function parseUserMessageReferences(content: string): ParsedUserMessage {
  const result: ParsedUserMessage = { articleRefs: [], snippetRefs: [], userMessage: content };

  // ===== 新格式：XML 标签 =====

  // 匹配 <referenced_articles>...</referenced_articles>
  const xmlArticleRegex = /<referenced_articles>\s*([\s\S]*?)\s*<\/referenced_articles>/;
  const xmlArticleMatch = content.match(xmlArticleRegex);
  if (xmlArticleMatch) {
    // 解析 <article title="..." articleId="..." site="..." />
    const articleTagRegex = /<article\s+title="([^"]+)"\s+articleId="([^"]+)"(?:\s+site="([^"]+)")?\s*\/>/g;
    let tagMatch;
    while ((tagMatch = articleTagRegex.exec(xmlArticleMatch[1])) !== null) {
      result.articleRefs.push({
        title: tagMatch[1],
        articleId: tagMatch[2],
        siteName: tagMatch[3] || undefined,
      });
    }
    content = content.replace(xmlArticleMatch[0], '');
  }

  // 匹配 <quoted_snippet source="...">...</quoted_snippet>（可能有多个）
  const xmlSnippetRegex = /<quoted_snippet\s+source="([^"]+)">\s*([\s\S]*?)\s*<\/quoted_snippet>/g;
  let snippetTagMatch;
  while ((snippetTagMatch = xmlSnippetRegex.exec(content)) !== null) {
    result.snippetRefs.push({
      articleTitle: snippetTagMatch[1],
      text: snippetTagMatch[2].trim(),
    });
  }
  content = content.replace(/<quoted_snippet\s+source="[^"]+">[\s\S]*?<\/quoted_snippet>/g, '');

  // 剩余的就是用户实际消息（去掉前导换行）
  result.userMessage = content.replace(/^\n+/, '').trim();

  return result;
}

/**
 * 检测用户消息是否为 SDK 斜杠命令格式
 * SDK 存储格式:
 *   <command-name>/xxx</command-name>
 *   <command-message>xxx</command-message>
 *   <command-args>xxx</command-args>
 */
export function parseSlashCommandMessage(content: string): ParsedSlashCommand {
  const match = content.match(/<command-name>\/?(\w[\w-]*)<\/command-name>/);
  if (!match) return { isCommand: false };

  const commandName = match[1];
  const argsMatch = content.match(/<command-args>([\s\S]*?)<\/command-args>/);
  const commandArgs = argsMatch?.[1]?.trim() || undefined;

  return { isCommand: true, commandName, commandArgs: commandArgs || undefined };
}
