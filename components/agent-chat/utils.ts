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

  // 匹配 [引用文章] 头部，贪婪捕获到第一个空行（\n\n）之前的全部内容
  const articleBlockRegex = /^\[引用文章\] 以下文章已引用，可使用 ReadArticle 工具读取完整内容：\n([\s\S]+?)(?=\n\n|$)/;
  const articleBlockMatch = content.match(articleBlockRegex);

  if (articleBlockMatch) {
    // 逐行解析文章引用
    const articleLineRegex = /^- 《(.+?)》\(articleId: (.+?)\)(?:\s*-\s*(.+))?$/gm;
    let lineMatch;
    while ((lineMatch = articleLineRegex.exec(articleBlockMatch[1])) !== null) {
      result.articleRefs.push({
        title: lineMatch[1],
        articleId: lineMatch[2],
        siteName: lineMatch[3]?.trim() || undefined,
      });
    }
    // 移除已解析的 [引用文章] 区块
    content = content.slice(articleBlockMatch[0].length);
  }

  // 匹配 [引用片段] 区块，空行后跟 "来自《" 说明还在区块内，否则区块结束
  const snippetBlockRegex = /^\[引用片段\]\n([\s\S]+?)(?=\n\n(?!来自《)|$)/;
  // 先去掉可能的前导换行
  content = content.replace(/^\n+/, '');
  const snippetBlockMatch = content.match(snippetBlockRegex);

  if (snippetBlockMatch) {
    // 逐条解析片段引用：来自《title》:\n> text
    const snippetRegex = /来自《(.+?)》:\n> ([\s\S]+?)(?=\n\n来自《|$)/g;
    let snippetMatch;
    while ((snippetMatch = snippetRegex.exec(snippetBlockMatch[1])) !== null) {
      result.snippetRefs.push({
        articleTitle: snippetMatch[1],
        text: snippetMatch[2].trim(),
      });
    }
    // 移除已解析的 [引用片段] 区块
    content = content.slice(snippetBlockMatch[0].length);
  }

  // 剩余的就是用户实际消息（去掉前导换行）
  result.userMessage = content.replace(/^\n+/, '');

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
