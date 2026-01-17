/**
 * 对话 Skill
 * 提供基础的对话功能
 *
 * 这是 Agent Worker 中使用的对话 Skill
 * 使用 @anthropic-ai/claude-agent-sdk 的 query 函数与 Claude 交互
 */

import { createTaskLogger } from '../logger.js';
import { query } from '@anthropic-ai/claude-agent-sdk';

/**
 * 对话 Skill 参数
 */
export interface ChatSkillParams {
  messages: Array<{
    role: 'user' | 'assistant' | 'system';
    content: string;
  }>;
  context?: {
    bookId?: string;
    chapterId?: string;
    selectedText?: string;
  };
}

/**
 * 对话 Skill 结果
 */
export interface ChatSkillResult {
  response: string;
  timestamp: number;
}

/**
 * 构建系统提示词
 * 根据上下文信息构建系统提示词
 */
function buildSystemPrompt(context?: ChatSkillParams['context']): string {
  if (!context) {
    return '你是一个帮助用户阅读和分析电子书的 AI 助手。';
  }

  const contextInfo = [];
  if (context.bookId) contextInfo.push(`书籍ID: ${context.bookId}`);
  if (context.chapterId) contextInfo.push(`章节ID: ${context.chapterId}`);
  if (context.selectedText) contextInfo.push(`选中文本: ${context.selectedText}`);

  return `你是一个帮助用户阅读和分析电子书的 AI 助手。

当前上下文:
${contextInfo.join('\n')}

请根据上述上下文提供有针对性的帮助。`;
}

/**
 * 执行对话 Skill
 * @param params 对话参数
 * @returns 对话结果
 */
export async function executeChatSkill(params: ChatSkillParams): Promise<ChatSkillResult> {
  const logger = createTaskLogger('chat-skill');

  logger.info('执行对话 Skill,消息数量:', params.messages.length);

  try {
    // 构建用户提示词(使用最后一条消息)
    const lastMessage = params.messages[params.messages.length - 1];
    if (!lastMessage || lastMessage.role !== 'user') {
      throw new Error('最后一条消息必须是用户消息');
    }

    // 使用 Claude Agent SDK 的 query 函数
    const agentQuery = query({
      prompt: lastMessage.content,
      options: {
        systemPrompt: buildSystemPrompt(params.context),
        // 可以根据需要添加其他选项
        // model: 'claude-sonnet-4-5-20250929',
        // temperature: 0.7,
        // maxTokens: 2000,
      }
    });

    // 收集所有消息,提取最终结果
    let fullResponse = '';
    for await (const message of agentQuery) {
      if (message.type === 'assistant') {
        // 累积助手响应
        // message.message.content 可能是字符串或内容块数组
        const content = message.message.content;
        if (typeof content === 'string') {
          fullResponse = content;
        } else if (Array.isArray(content)) {
          // 处理内容块数组 (例如 [{type: 'text', text: '...'}])
          fullResponse = content
            .map(block => {
              if (typeof block === 'string') return block;
              if (block.type === 'text') return block.text;
              return '';
            })
            .join('');
        }
      } else if (message.type === 'result') {
        // 任务完成
        logger.info('对话任务完成');
        break;
      }
    }

    return {
      response: fullResponse,
      timestamp: Date.now()
    };
  } catch (error) {
    logger.error('对话 Skill 执行失败:', error);
    throw error;
  }
}

/**
 * 创建流式对话响应
 * @param params 对话参数
 * @returns 异步生成器,逐步产生响应
 */
export async function* streamChatSkill(params: ChatSkillParams): AsyncGenerator<string, void, unknown> {
  const logger = createTaskLogger('chat-skill-stream');

  logger.info('执行流式对话 Skill');

  try {
    const lastMessage = params.messages[params.messages.length - 1];
    if (!lastMessage || lastMessage.role !== 'user') {
      throw new Error('最后一条消息必须是用户消息');
    }

    // 使用 Claude Agent SDK 的 query 函数(流式)
    const agentQuery = query({
      prompt: lastMessage.content,
      options: {
        systemPrompt: buildSystemPrompt(params.context),
        includePartialMessages: true, // 启用部分消息
      }
    });

    // 流式输出
    for await (const message of agentQuery) {
      if (message.type === 'assistant') {
        // 输出助手消息
        // message.message.content 可能是字符串或内容块数组
        const content = message.message.content || '';
        if (typeof content === 'string') {
          yield content;
        } else if (Array.isArray(content)) {
          // 处理内容块数组
          const text = content
            .map(block => {
              if (typeof block === 'string') return block;
              if (block.type === 'text') return block.text;
              return '';
            })
            .join('');
          yield text;
        } else {
          yield '';
        }
      } else if (message.type === 'stream_event') {
        // 输出流式事件(部分消息)
        // 这里可以根据需要处理流式事件
        yield '';
      } else if (message.type === 'result') {
        // 完成
        break;
      }
    }
  } catch (error) {
    logger.error('流式对话 Skill 执行失败:', error);
    throw error;
  }
}
