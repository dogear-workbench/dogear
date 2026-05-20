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
  const result: ParsedUserMessage = {
    articleRefs: [],
    snippetRefs: [],
    fileRefs: [],
    conversationRefs: [],
    userMessage: content,
  };

  // 匹配 <referenced_articles>...</referenced_articles>
  const xmlArticleRegex = /<referenced_articles>\s*([\s\S]*?)\s*<\/referenced_articles>/;
  const xmlArticleMatch = content.match(xmlArticleRegex);
  if (xmlArticleMatch) {
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

  // 匹配 <referenced_files>...</referenced_files>
  const xmlFileRegex = /<referenced_files>\s*([\s\S]*?)\s*<\/referenced_files>/;
  const xmlFileMatch = content.match(xmlFileRegex);
  if (xmlFileMatch) {
    const fileTagRegex = /<file\s+name="([^"]+)"\s+path="([^"]+)"\s*\/>/g;
    let tagMatch;
    while ((tagMatch = fileTagRegex.exec(xmlFileMatch[1])) !== null) {
      result.fileRefs.push({
        name: tagMatch[1],
        path: tagMatch[2],
      });
    }
    content = content.replace(xmlFileMatch[0], '');
  }

  // 匹配 <referenced_conversations>...</referenced_conversations>
  const xmlConvRegex = /<referenced_conversations>\s*([\s\S]*?)\s*<\/referenced_conversations>/;
  const xmlConvMatch = content.match(xmlConvRegex);
  if (xmlConvMatch) {
    const convTagRegex = /<conversation\s+title="([^"]+)"\s+conversationId="([^"]+)"(?:\s+sdkSessionId="([^"]+)")?\s*\/>/g;
    let tagMatch;
    while ((tagMatch = convTagRegex.exec(xmlConvMatch[1])) !== null) {
      result.conversationRefs.push({
        title: tagMatch[1],
        conversationId: tagMatch[2],
        sdkSessionId: tagMatch[3] || undefined,
      });
    }
    content = content.replace(xmlConvMatch[0], '');
  }

  // 匹配 <quoted_snippet source="...">...</quoted_snippet>
  const xmlSnippetRegex = /<quoted_snippet\s+source="([^"]+)">\s*([\s\S]*?)\s*<\/quoted_snippet>/g;
  let snippetTagMatch;
  while ((snippetTagMatch = xmlSnippetRegex.exec(content)) !== null) {
    result.snippetRefs.push({
      articleTitle: snippetTagMatch[1],
      text: snippetTagMatch[2].trim(),
    });
  }
  content = content.replace(/<quoted_snippet\s+source="[^"]+">[\s\S]*?<\/quoted_snippet>/g, '');

  // 检测 <local-command-stdout>Set model to xxx</local-command-stdout>
  const stdoutMatch = content.match(/<local-command-stdout>([\s\S]*?)<\/local-command-stdout>/);
  if (stdoutMatch) {
    result.localCommandStdout = stdoutMatch[1].trim();
    const modelSetMatch = result.localCommandStdout.match(/^Set model to\s+(\S+)/i);
    if (modelSetMatch) {
      result.modelSwitch = modelSetMatch[1];
    }
    content = content.replace(stdoutMatch[0], '');
  }

  // 检测 /model xxx 命令（裸文本，非 SDK <command-name> 格式）
  const trimmed = content.replace(/^\n+/, '').trim();
  const modelCmdMatch = trimmed.match(/^\/model\s+(\S+)\s*$/);
  if (modelCmdMatch) {
    result.modelSwitch = result.modelSwitch || modelCmdMatch[1];
    content = '';
  }

  result.userMessage = content.replace(/^\n+/, '').trim();

  return result;
}

/**
 * 提取用户消息中"可被搜索/可被高亮"的纯文本,与 MessageItem 渲染用的
 * parseUserMessageReferences().userMessage 保持 offset 完全一致
 *
 * 若消息是 SDK 斜杠命令(<command-name> 格式),返回空串—— MessageItem 会渲染
 * 成命令芯片,正文不参与搜索
 */
export function getUserMessageSearchableText(content: string): string {
  const slash = parseSlashCommandMessage(content);
  if (slash.isCommand) return '';
  return parseUserMessageReferences(content).userMessage;
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
