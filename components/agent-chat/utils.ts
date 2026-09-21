import type { ParsedUserMessage, ParsedSlashCommand, ParsedTaskExecution, ParsedShuntRef, InjectionTag } from './types';
import { isFailoverContinueMessage } from '@/lib/failover-markers';

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
    sharedFileRefs: [],
    noteRefs: [],
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
    const fileTagRegex = /<file\s+name="([^"]+)"\s+path="([^"]+)"(?:\s+type="([^"]+)")?\s*\/>/g;
    let tagMatch;
    while ((tagMatch = fileTagRegex.exec(xmlFileMatch[1])) !== null) {
      result.fileRefs.push({
        name: tagMatch[1],
        path: tagMatch[2],
        type: tagMatch[3] === 'folder' ? 'folder' : undefined,
      });
    }
    content = content.replace(xmlFileMatch[0], '');
  }

  // 匹配 <referenced_conversations>...</referenced_conversations>
  const xmlConvRegex = /<referenced_conversations>\s*([\s\S]*?)\s*<\/referenced_conversations>/;
  const xmlConvMatch = content.match(xmlConvRegex);
  if (xmlConvMatch) {
    const convTagRegex = /<conversation\s+title="([^"]+)"\s+conversationId="([^"]+)"(?:\s+sessionId="([^"]*)")?(?:\s+workspaceId="([^"]*)")?\s*\/>/g;
    let tagMatch;
    while ((tagMatch = convTagRegex.exec(xmlConvMatch[1])) !== null) {
      result.conversationRefs.push({
        title: tagMatch[1],
        conversationId: tagMatch[2],
        sessionId: tagMatch[3] || undefined,
        workspaceId: tagMatch[4] || undefined,
      });
    }
    content = content.replace(xmlConvMatch[0], '');
    // 发送端在跨工作区引用时紧跟块后注入的中文提示，取稳定前缀匹配，后缀措辞变化不影响
    content = content.replace(/\n?（注：引用的会话可能属于其他工作区[^\n]*/g, '');
  }

  // 匹配 <referenced_shared_files>...</referenced_shared_files>
  const xmlSharedFileRegex = /<referenced_shared_files>\s*([\s\S]*?)\s*<\/referenced_shared_files>/;
  const xmlSharedFileMatch = content.match(xmlSharedFileRegex);
  if (xmlSharedFileMatch) {
    const sharedFileTagRegex = /<shared_file\s+group_id="([^"]+)"\s+rel_path="([^"]+)"\s+abs_path="([^"]+)"\s*\/>/g;
    let tagMatch;
    while ((tagMatch = sharedFileTagRegex.exec(xmlSharedFileMatch[1])) !== null) {
      result.sharedFileRefs.push({
        groupId: tagMatch[1],
        relPath: tagMatch[2],
        absPath: tagMatch[3],
      });
    }
    // 属性不全的条目被严格正则跳过；只要存在跳过的条目就不剥外层，避免信息静默丢失
    const tagCount = (xmlSharedFileMatch[1].match(/<shared_file\b/g) || []).length;
    if (result.sharedFileRefs.length === tagCount) {
      content = content.replace(xmlSharedFileMatch[0], '');
    }
  }

  // 匹配 <referenced_notes>...</referenced_notes>
  const xmlNoteRegex = /<referenced_notes>\s*([\s\S]*?)\s*<\/referenced_notes>/;
  const xmlNoteMatch = content.match(xmlNoteRegex);
  if (xmlNoteMatch) {
    const noteTagRegex = /<note\s+noteId="([^"]+)"\s+title="([^"]*)"\s+workspacePath="([^"]*)"\s*\/>/g;
    let tagMatch;
    while ((tagMatch = noteTagRegex.exec(xmlNoteMatch[1])) !== null) {
      result.noteRefs.push({
        noteId: tagMatch[1],
        title: tagMatch[2] || '（无标题）',
        workspacePath: tagMatch[3],
      });
    }
    // 属性不全的条目被严格正则跳过；只要存在跳过的条目就不剥外层，避免信息静默丢失
    const tagCount = (xmlNoteMatch[1].match(/<note\b/g) || []).length;
    if (result.noteRefs.length === tagCount) {
      content = content.replace(xmlNoteMatch[0], '');
    }
  }

  // 匹配分流操作气泡注入的 <shunt action="..." summary="...">用户补充</shunt>；属性反转义后进 shuntRef，正文留在 userMessage
  const xmlShuntRegex = /<shunt\s+action="(new-session|new-topic|note)"\s+summary="([^"]*)">([\s\S]*?)<\/shunt>/;
  const xmlShuntMatch = content.match(xmlShuntRegex);
  if (xmlShuntMatch) {
    result.shuntRef = {
      action: xmlShuntMatch[1] as ParsedShuntRef['action'],
      summary: xmlShuntMatch[2]
        .replace(/&quot;/g, '"')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&amp;/g, '&'),
    };
    content = content.replace(xmlShuntMatch[0], xmlShuntMatch[3].trim());
  }

  // 匹配 <sender kind="..." session_id="..." name="..." delivery="..." tag="..."/>
  const senderRegex = /<sender\s+kind="([^"]+)"(?:\s+session_id="([^"]*)")?(?:\s+name="([^"]*)")?(?:\s+delivery="(true|false)")?(?:\s+tag="([a-z-]+)")?\s*\/>/;
  const senderMatch = content.match(senderRegex);
  if (senderMatch) {
    const kind = senderMatch[1];
    if (kind === 'agent' || kind === 'human') {
      result.senderKind = kind;
      if (senderMatch[2]) result.senderSessionId = senderMatch[2];
      if (senderMatch[3]) {
        // 反转义 XML 属性
        result.senderDisplayName = senderMatch[3]
          .replace(/&quot;/g, '"')
          .replace(/&gt;/g, '>')
          .replace(/&lt;/g, '<')
          .replace(/&amp;/g, '&');
      }
      if (senderMatch[4]) result.senderIsDelivery = senderMatch[4] === 'true';
      if (senderMatch[5] && INJECTION_TAG_SET.has(senderMatch[5] as InjectionTag)) {
        result.senderTag = senderMatch[5] as InjectionTag;
      }
    }
    content = content.replace(senderMatch[0], '');
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
  if (isFailoverContinueMessage(content)) return '';
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

const INJECTION_TAG_SET: ReadonlySet<InjectionTag> = new Set(['delivery', 'reply', 'terminal', 'resume', 'task-execution', 'failover', 'dispatch']);

const TERMINAL_HINT_RE = /终止|失败|耗尽|quota/i;

/**
 * 判断 user 消息是否为「跨会话注入」类（sender 标签 / task-execution 包裹 / failover 哨兵）。
 * turns.ts 与 MessageItem 共用的统一口径。
 */
export function isInjectedUserMessage(content: string): boolean {
  if (!content) return false;
  if (isFailoverContinueMessage(content)) return true;
  if (/<sender\s+kind="/.test(content)) return true;
  if (content.includes('<task-execution>')) return true;
  return false;
}

/**
 * 解析 <task-execution> 包裹的任务执行提示（行格式与 task-queue.ts buildExecutionPrompt 对齐），
 * 字段缺失视为非标准结构返回 null，由调用方走普通注入卡。
 */
export function parseTaskExecution(content: string): ParsedTaskExecution | null {
  const match = content.match(/<task-execution>\s*\n([\s\S]*?)\n\s*<\/task-execution>/);
  if (!match) return null;
  const inner = match[1];
  const readField = (label: string): string => {
    const m = inner.match(new RegExp(`^${label}(.*)$`, 'm'));
    return m ? m[1].trim() : '';
  };
  const title = readField('任务标题：');
  const taskId = readField('任务 ID：');
  const planPath = readField('计划文档：');
  if (!title || !taskId) return null;
  const body = inner
    .split('\n')
    .filter((line) => !/^\s*(任务标题：|任务 ID：|计划文档：)/.test(line))
    .join('\n')
    .trim();
  return { title, taskId, planPath, body };
}

/**
 * 推断注入消息的 tag：新消息直接用 sender 标签 tag 属性；旧历史无 tag 时按
 * delivery 属性 → 绿、终态文案关键词 → 红橙、兜底蓝的顺序推断。
 */
export function resolveInjectionTag(parsed: ParsedUserMessage): InjectionTag {
  if (parsed.senderTag) return parsed.senderTag;
  if (parsed.senderIsDelivery) return 'delivery';
  if (TERMINAL_HINT_RE.test(parsed.userMessage)) return 'terminal';
  return 'reply';
}

/**
 * 判断 user 消息是否为「SDK 系统注入」类（命令调用、命令输出等）。
 * 这类消息不是真实用户输入，渲染时应作为系统指示而非用户气泡，
 * 同时不应进入 Minimap 的轮次计算。
 */
export function isSdkInjectedUserMessage(content: string): boolean {
  if (!content) return false;
  if (isFailoverContinueMessage(content)) return true;
  // <command-name>/xxx</command-name>
  if (/<command-name>/.test(content)) return true;
  // <local-command-stdout>...</local-command-stdout>
  if (/<local-command-stdout>/.test(content)) return true;
  // 裸文本 /model xxx（运行时用户在输入框敲的）
  if (/^\s*\/model\s+\S+/.test(content)) return true;
  return false;
}
